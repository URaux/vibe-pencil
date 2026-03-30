function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

interface JsonLike {
  [key: string]: unknown
}

function isObject(value: unknown): value is JsonLike {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractTextBlocks(value: unknown): string {
  if (!Array.isArray(value)) {
    return ''
  }

  return value
    .map((entry) => {
      if (!isObject(entry)) {
        return ''
      }

      return typeof entry.text === 'string' ? entry.text : ''
    })
    .join('')
}

function extractTextFromEvent(event: unknown): string {
  if (!isObject(event)) {
    return ''
  }

  if (event.type === 'thinking' || event.type === 'content_block_start') return ''
  if (event.subtype === 'thinking') return ''

  if (typeof event.result === 'string') {
    return event.result
  }

  if (typeof event.output_text === 'string') {
    return event.output_text
  }

  if (typeof event.text === 'string' && (event.type === 'text' || event.role === 'assistant')) {
    return event.text
  }

  if (isObject(event.delta) && typeof event.delta.text === 'string') {
    return event.delta.text
  }

  if (isObject(event.content_block) && typeof event.content_block.text === 'string') {
    return event.content_block.text
  }

  if (isObject(event.message)) {
    const content = extractTextBlocks(event.message.content)

    if (content) {
      return content
    }
  }

  if (
    event.type === 'item.completed' &&
    isObject(event.item) &&
    (event.item.type === 'agent_message' || typeof event.item.type !== 'string')
  ) {
    if (typeof event.item.text === 'string') {
      return event.item.text
    }

    const content = extractTextBlocks(event.item.content)

    if (content) {
      return content
    }
  }

  return extractTextBlocks(event.content)
}

function isIgnorableLogLine(line: string) {
  const trimmed = line.trim()

  return (
    /^WARNING: proceeding, even though we could not update PATH:/i.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}T\S+\s+WARN\s+codex_[\w:.-]+:/i.test(trimmed)
  )
}

export function extractAgentText(output: string) {
  const result: string[] = []
  const lines = stripAnsi(output).split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || isIgnorableLogLine(line)) continue

    // If it doesn't look like JSON metadata, it's probably raw text
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      result.push(line + '\n')
      continue
    }

    // Try to parse as a JSON event
    try {
      const event = JSON.parse(trimmed)
      const text = extractTextFromEvent(event)
      if (text) {
        result.push(text)
      } else if (typeof event.text === 'string') {
        // Fallback for flat text field
        result.push(event.text)
      } else if (!isObject(event)) {
        // If it's a valid JSON but not an object we recognize, treat as raw
        result.push(line + '\n')
      }
    } catch {
      // If this is the last line, it's likely an incomplete JSON line — skip it
      if (i === lines.length - 1) continue

      // If parsing fails, it might be a multi-line JSON or a truncated one.
      // We'll peek if the next line or buffer helps, but for now,
      // if it contains recognizable text keys, try to extract manually.
      const textMatch = trimmed.match(/"(?:text|content|result|output_text)"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      if (textMatch) {
        try {
          // Unescape the captured JSON string
          result.push(JSON.parse(`"${textMatch[1]}"`))
        } catch {
          result.push(line + '\n')
        }
      } else {
        result.push(line + '\n')
      }
    }
  }

  return result.join('')
}

export function extractJsonObject(text: string) {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [fencedMatch?.[1], text.trim()]

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    try {
      return JSON.parse(candidate) as unknown
    } catch {
      continue
    }
  }

  return null
}
