# Streaming Output Fix: ANSI Leakage, Duplication, stderr Mixing

## Root Causes

### P1: Gemini ANSI error in chat
- Gemini CLI outputs ANSI-colored error to stderr: `\x1b[31mError in...\x1b[0m`
- `agent-runner.ts` line 144-148: stderr is merged into `info.output` alongside stdout
- `extractAgentText()` has no ANSI stripping → raw escape codes shown as `[31m...[0m` in chat

### P2: Claude response duplication / thinking chain leakage
- Claude Code with `--output-format stream-json` emits JSON events including thinking/assistant events
- If a JSON line can't be parsed (incomplete due to 125ms polling boundary), it's treated as raw text
- Next poll successfully parses the complete JSON → same content appears twice (once as raw, once parsed)
- Thinking events may have `type: 'thinking'` which `extractTextFromEvent` doesn't explicitly filter out

## Fix 1: Strip ANSI escape codes

In `src/lib/agent-output.ts`, add ANSI stripping at the top of `extractAgentText()`:

```typescript
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

export function extractAgentText(output: string) {
  const result: string[] = []
  const lines = stripAnsi(output).split(/\r?\n/)
  // ... rest unchanged
}
```

## Fix 2: Separate stderr from stdout

In `src/lib/agent-runner.ts`, do NOT merge stderr into `info.output`. Instead, store it separately:

Change lines 144-148:
```typescript
// BEFORE (broken):
child.stderr?.on('data', (chunk: Buffer | string) => {
  const text = typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk)
  info.output += text          // ← This pollutes the response
  info.errorMessage = text
  this.emit('output', { agentId, nodeId, text })
})

// AFTER (fixed):
child.stderr?.on('data', (chunk: Buffer | string) => {
  const text = typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk)
  info.errorMessage = (info.errorMessage ?? '') + text
  // Do NOT append to info.output — stderr is not response content
})
```

Also update the `close` handler (around line 164-167):
```typescript
if (stderrRemainder) {
  info.errorMessage = (info.errorMessage ?? '') + stderrRemainder
  // Do NOT append to info.output
}
```

## Fix 3: Filter thinking events from Claude stream-json

In `src/lib/agent-output.ts`, `extractTextFromEvent()`, add early return for thinking events:

```typescript
function extractTextFromEvent(event: unknown): string {
  if (!isObject(event)) return ''

  // Skip thinking/internal events
  if (event.type === 'thinking' || event.type === 'content_block_start') return ''
  if (event.subtype === 'thinking') return ''

  // ... rest of existing logic
}
```

## Fix 4: Buffer incomplete JSON lines

In `extractAgentText()`, if a line starts with `{` but fails to parse AND is the LAST line in the output, it's likely an incomplete JSON line from a partially-received stream. Skip it instead of including it as raw text.

```typescript
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  const trimmed = line.trim()
  if (!trimmed || isIgnorableLogLine(line)) continue

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    result.push(line + '\n')
    continue
  }

  try {
    const event = JSON.parse(trimmed)
    const text = extractTextFromEvent(event)
    if (text) {
      result.push(text)
    } else if (typeof event.text === 'string') {
      result.push(event.text)
    } else if (!isObject(event)) {
      result.push(line + '\n')
    }
  } catch {
    // If this is the last line, it's likely incomplete — skip it
    if (i === lines.length - 1) continue

    const textMatch = trimmed.match(/"(?:text|content|result|output_text)"\s*:\s*"((?:[^"\\]|\\.)*)"/)
    if (textMatch) {
      try {
        result.push(JSON.parse(`"${textMatch[1]}"`))
      } catch {
        result.push(line + '\n')
      }
    } else {
      result.push(line + '\n')
    }
  }
}
```

## Fix 5: Handle process errors gracefully in chat

In `src/app/api/chat/route.ts`, when the agent finishes with an error status, send a user-friendly error message instead of dumping raw output:

In the streaming loop, after the agent finishes, check for error:
```typescript
if (status.status === 'error') {
  const errorMsg = status.errorMessage
    ? `Backend error: ${stripAnsi(status.errorMessage).slice(0, 200)}`
    : 'The AI backend encountered an error.'
  writer.write(encoder.encode(encodeEvent({ type: 'error', error: errorMsg })))
}
```

Import or inline `stripAnsi` in the route file.

## File Change Summary

| Action | File |
|--------|------|
| **Modify** | `src/lib/agent-output.ts` (ANSI strip, thinking filter, incomplete JSON buffer) |
| **Modify** | `src/lib/agent-runner.ts` (separate stderr from stdout) |
| **Modify** | `src/app/api/chat/route.ts` (graceful error display) |

## Acceptance Criteria

1. ANSI escape codes never appear in chat responses
2. stderr errors (like Gemini config errors) don't leak into chat text
3. Claude thinking chain content is not displayed
4. No duplicate text in responses
5. Process errors show a clean error message
6. `npm run build` passes
7. `npm test` passes
