# Context Engineering + Markdown Chat Rendering Plan

> Unified prompt context layer with locale-aware generation + proper markdown rendering in ChatPanel.

---

## Current State Analysis

### Problems

1. **Prompts are English-only** -- `prompt-templates.ts` hardcodes English persona, task descriptions, and canvas action instructions. When locale=zh, the LLM still replies in English.
2. **Canvas action instructions duplicated** -- identical (but diverged) `CANVAS_ACTION_INSTRUCTIONS` blocks exist in both `prompt-templates.ts` (lines 13-19) and `chat/route.ts` (lines 22-34). The chat route version is more detailed.
3. **No locale flow** -- API routes (`chat/route.ts`, `project/import/route.ts`, `agent/spawn/route.ts`) never receive locale from the frontend. `ChatPanel.tsx` reads `locale` from store but never sends it.
4. **Chat renders raw text** -- `ChatPanel.tsx` line 720: `<div className="whitespace-pre-wrap break-words">` renders assistant responses as plain text. No markdown, no code highlighting.
5. **No skill injection point** -- prompt construction has no hook for skill content (SKILL-SYSTEM-PLAN.md describes this need).
6. **Title generation prompt is ad-hoc** -- `ChatPanel.tsx` lines 604-641 builds a title-gen prompt inline with no persona or locale control.

### Files Involved

| File | Role | Key Issue |
|------|------|-----------|
| `src/lib/prompt-templates.ts` | Build prompts (buildAll, buildNode, etc.) | English-only, duplicated canvas actions |
| `src/app/api/chat/route.ts` | Chat API | Own `buildPrompt`, own `CANVAS_ACTION_INSTRUCTIONS`, no locale |
| `src/app/api/project/import/route.ts` | Import API | Own `buildPrompt`, no locale |
| `src/app/api/agent/spawn/route.ts` | Build spawn API | Passthrough only, no locale handling |
| `src/hooks/useBuildActions.ts` | Build prompt generation | Uses prompt-templates, no locale |
| `src/components/ChatPanel.tsx` | Chat UI | Raw text rendering, no locale in API calls |
| `src/lib/i18n.ts` | Locale system | Has zh/en translations, working correctly |
| `src/lib/store.ts` | App state | Has `locale` in state, working correctly |
| `src/lib/skill-loader.ts` | Skill system | Has `mergeSkills`, needs integration point |

---

## Phase 1: Context Engine (Core Context Builder)

### Create `src/lib/context-engine.ts`

A single module that all prompt construction flows through.

#### Types

```typescript
import type { Locale } from './i18n'

export type AgentRole = 'chat' | 'import' | 'build' | 'title-gen'

export interface ContextOptions {
  locale: Locale
  role: AgentRole
  skillContent?: string  // Pre-merged skill markdown (from skill-loader)
}
```

#### `buildSystemContext(options: ContextOptions): string`

Returns the combined system-level instructions:

```typescript
export function buildSystemContext(options: ContextOptions): string {
  const { locale, role, skillContent } = options

  const sections: string[] = []

  // 1. Persona (role-specific)
  sections.push(getPersona(role))

  // 2. Language directive
  sections.push(getLanguageDirective(locale))

  // 3. Canvas action instructions (only for roles that modify canvas)
  if (role === 'chat' || role === 'import') {
    sections.push(CANVAS_ACTION_INSTRUCTIONS)
  }

  // 4. Skill content injection slot
  if (skillContent) {
    sections.push('# Skills\n\n' + skillContent)
  }

  return sections.filter(Boolean).join('\n\n')
}
```

#### Persona definitions

```typescript
const PERSONAS: Record<AgentRole, { en: string; zh: string }> = {
  chat: {
    en: 'You are the AI discussion panel for a software architecture canvas. Respond as a collaborative architecture assistant grounded in the provided canvas state.',
    zh: 'You are the AI discussion panel for a software architecture canvas. Respond as a collaborative architecture assistant grounded in the provided canvas state.',
  },
  import: {
    en: 'You are an AI architecture reverse-engineer. Analyze the given codebase and produce a structured architecture representation.',
    zh: 'You are an AI architecture reverse-engineer. Analyze the given codebase and produce a structured architecture representation.',
  },
  build: {
    en: "You are an AI architecture consultant. Use first-principles thinking, apply Occam's razor, and prefer practical choices over fashionable complexity.",
    zh: "You are an AI architecture consultant. Use first-principles thinking, apply Occam's razor, and prefer practical choices over fashionable complexity.",
  },
  'title-gen': {
    en: 'You are a concise title generator. Output only the title, nothing else.',
    zh: 'You are a concise title generator. Output only the title, nothing else.',
  },
}
```

Note: Persona text stays in English for all locales (LLMs understand English instructions better). The language directive controls output language.

#### Language directive

```typescript
function getLanguageDirective(locale: Locale): string {
  if (locale === 'zh') {
    return [
      '# Language Requirement',
      '回复必须使用中文。',
      '节点名称、描述、标签全部用中文。',
      '技术术语可保留英文原文（如 React, API Gateway），但解释用中文。',
    ].join('\n')
  }
  return '# Language Requirement\nRespond in English.'
}
```

#### Canonical canvas action instructions

Move the authoritative version from `chat/route.ts` (the more detailed one) into `context-engine.ts`:

```typescript
const CANVAS_ACTION_INSTRUCTIONS = [
  '# Canvas Action Instructions',
  '',
  'CRITICAL: If you need to modify the canvas, place ALL ```json:canvas-action blocks at the very START of your response.',
  'Do not provide a preamble. Output JSON first, then explain your reasoning.',
  'When you recommend canvas modifications, include a ```json:canvas-action block.',
  'Use one of these actions:',
  '- add-node container: {"action":"add-node","node":{"id?":"container-app","type":"container","position?":{"x":0,"y":0},"data":{"name":"Application Layer","color":"blue","collapsed":false},"style":{"width":400,"height":300}}}',
  '- add-node block: {"action":"add-node","node":{"id?":"block-web","type":"block","parentId?":"container-app","position?":{"x":24,"y":72},"data":{"name":"Web App","description":"User-facing app","status":"idle","techStack":"Next.js 16"}}}',
  '- update-node: {"action":"update-node","target_id":"node-id","data":{"name":"...","description":"...","techStack":"...","color":"green","collapsed":true}}',
  '- remove-node: {"action":"remove-node","target_id":"node-id"}',
  '- add-edge: {"action":"add-edge","edge":{"id?":"edge-1","source":"block-web","target":"block-api","type":"sync","label?":"HTTPS"}}',
  'Only create edges between block nodes.',
  'Keep normal prose AFTER the code block, and keep code blocks valid JSON.',
].join('\n')
```

#### Skill injection interface

```typescript
/**
 * Placeholder for skill system integration (see SKILL-SYSTEM-PLAN.md).
 * When the skill system is implemented, this function will resolve
 * and merge skills based on agent level and node context.
 *
 * For now, returns undefined (no skills injected).
 */
export function resolveSkillContent(
  _role: AgentRole,
  _nodeId?: string
): string | undefined {
  // TODO: Implement when skill system is built
  // return mergeSkills(resolveSkills(role, node))
  return undefined
}
```

### Verification

- Unit test: `buildSystemContext({ locale: 'zh', role: 'chat' })` contains the Chinese language directive
- Unit test: `buildSystemContext({ locale: 'en', role: 'build' })` does NOT contain canvas action instructions
- Unit test: `buildSystemContext({ locale: 'zh', role: 'import' })` contains canvas action instructions + Chinese directive

### Dependencies

None -- this is a new file with no upstream dependencies.

---

## Phase 2: Prompt Templates + API Routes (Wire Locale Through)

### 2.1 Update `src/lib/prompt-templates.ts`

**Changes:**

1. Add `locale` to `PromptTemplateInput`
2. Import `buildSystemContext` from context-engine
3. Replace hardcoded `PERSONA` and `CANVAS_ACTION_INSTRUCTIONS` with context-engine calls
4. Remove the local `PERSONA` and `CANVAS_ACTION_INSTRUCTIONS` constants

```typescript
import { buildSystemContext, type AgentRole } from './context-engine'
import type { Locale } from './i18n'

interface PromptTemplateInput {
  architecture_yaml: string
  selected_nodes?: string[]
  project_context?: string
  user_feedback?: string
  locale?: Locale  // NEW -- defaults to 'en' if not provided
}

function buildPrompt(
  title: string,
  task: string,
  input: PromptTemplateInput,
  includeCanvasActions: boolean
) {
  const locale = input.locale ?? 'en'
  const role: AgentRole = includeCanvasActions ? 'build' : 'build'
  const systemContext = buildSystemContext({ locale, role })

  return [
    systemContext,
    '',
    `Task: ${title}`,
    task,
    '',
    formatContext(input),
  ]
    .filter(Boolean)
    .join('\n')
}
```

The `formatContext` helper stays unchanged.

All exported functions (`buildAll`, `buildNode`, `buildSubgraph`, `analyzeProject`, `refactorNode`) pass through `input` unchanged -- they automatically get locale support because `PromptTemplateInput` now carries it.

### 2.2 Update `src/app/api/chat/route.ts`

**Changes:**

1. Add `locale` to `ChatRequest` interface
2. Import `buildSystemContext` from context-engine
3. Replace local `CANVAS_ACTION_INSTRUCTIONS` and persona with `buildSystemContext` call
4. Delete the local `CANVAS_ACTION_INSTRUCTIONS` constant (lines 22-34)

```typescript
import { buildSystemContext } from '@/lib/context-engine'
import type { Locale } from '@/lib/i18n'

interface ChatRequest {
  message: string
  history?: ChatMessage[]
  nodeContext?: string
  architecture_yaml: string
  backend?: AgentBackend
  model?: string
  locale?: Locale  // NEW
}

function buildPrompt({ message, history, nodeContext, architecture_yaml, locale }: ChatRequest) {
  const systemContext = buildSystemContext({
    locale: locale ?? 'en',
    role: 'chat',
  })

  return [
    systemContext,
    '',
    'Architecture YAML:',
    architecture_yaml,
    '',
    'Selected node context:',
    nodeContext ?? 'Global chat mode. No node is selected.',
    '',
    'Conversation so far:',
    formatHistory(history),
    '',
    'Latest user message:',
    message,
  ].join('\n')
}
```

### 2.3 Update `src/app/api/project/import/route.ts`

**Changes:**

1. Add `locale` to `ImportProjectRequest`
2. Import `buildSystemContext` from context-engine
3. Update `buildPrompt` to accept and use locale
4. When locale=zh, the JSON example names should use Chinese (e.g., "Client Layer" -> "客户端层")

```typescript
import { buildSystemContext } from '@/lib/context-engine'
import type { Locale } from '@/lib/i18n'

interface ImportProjectRequest {
  dir: string
  backend?: 'claude-code' | 'codex' | 'gemini'
  locale?: Locale  // NEW
}

function buildPrompt(dir: string, locale: Locale = 'en') {
  const systemContext = buildSystemContext({
    locale,
    role: 'import',
  })

  // Use locale-appropriate example names
  const exampleContainerName = locale === 'zh' ? '客户端层' : 'Client Layer'
  const exampleBlockName = locale === 'zh' ? 'Web 应用' : 'Web App'
  const exampleBlockDesc = locale === 'zh' ? '用户交互界面' : 'User-facing application'

  return [
    systemContext,
    '',
    `Import source directory: ${dir}`,
    'Reverse-engineer the current codebase into a React Flow architecture canvas. Favor a compact but meaningful graph.',
    '',
    'Return structured JSON for React Flow and nothing else, unless you need a fenced ```json block.',
    'The preferred JSON shape is:',
    '{',
    '  "containers": [',
    '    {',
    `      "id": "container-client",`,
    `      "name": "${exampleContainerName}",`,
    '      "color": "blue",',
    '      "blocks": [',
    '        {',
    '          "id": "block-web",',
    `          "name": "${exampleBlockName}",`,
    `          "description": "${exampleBlockDesc}",`,
    // ... rest stays the same
  ].join('\n')
}
```

Update the POST handler to pass locale:

```typescript
export async function POST(request: Request) {
  const { dir, backend, locale } = (await request.json()) as ImportProjectRequest
  // ...
  const agentId = agentRunner.spawnAgent(
    'project-import',
    buildPrompt(dir, locale),
    getBackend(backend),
    dir
  )
  // ...
}
```

### 2.4 Update `src/app/api/agent/spawn/route.ts`

No changes needed. The spawn API receives pre-built prompts from `useBuildActions.ts`. Locale is injected at prompt construction time, not at spawn time.

### 2.5 Update title generation in `ChatPanel.tsx`

The inline title-gen prompt (lines 604-641) should use context-engine:

```typescript
// Replace the ad-hoc title prompt with:
const titleLocale = locale === 'zh' ? 'zh' : 'en'
const titleInstruction = titleLocale === 'zh'
  ? `根据以下对话生成一个简短标题（最多20字），只输出标题。\n\n用户: ${trimmedMessage}\nAI: ${visibleText.slice(0, 500)}`
  : `Generate a short title (max 20 chars) for this conversation. Output only the title.\n\nUser: ${trimmedMessage}\nAI: ${visibleText.slice(0, 500)}`
```

This is a lightweight fix -- no need to call context-engine for title gen since it's a one-shot fire-and-forget.

### Verification

- Send a chat message with locale=zh in the request body. Verify the system prompt includes the Chinese language directive.
- Import a project with locale=zh. Verify the generated container/block names are in Chinese.
- Run a build with locale=zh. Verify the prompt-templates output includes the language directive.

### Dependencies

Depends on Phase 1 (context-engine.ts must exist).

---

## Phase 3: Frontend Locale Passing

### 3.1 Update `ChatPanel.tsx` -- pass locale to chat API

**File:** `src/components/ChatPanel.tsx`

**Change 1:** Add `locale` to the chat API request body (line 549-555):

```typescript
body: JSON.stringify({
  message: trimmedMessage,
  history: nextHistory,
  nodeContext,
  architecture_yaml: canvasToYaml(nodes, edges, projectName),
  backend,
  model,
  locale,  // NEW -- already read from store on line 222
}),
```

**Change 2:** Also add locale to the title-gen request (line 611):

```typescript
body: JSON.stringify({
  message: titleInstruction,  // locale-aware instruction from Phase 2.5
  history: [],
  nodeContext: '',
  architecture_yaml: '',
  backend,
  model,
  locale,  // NEW
}),
```

### 3.2 Update ImportDialog -- pass locale to import API

**File:** Find the import dialog component that calls `/api/project/import`.

Search for the fetch call to `/api/project/import` in the frontend. Based on the codebase structure, this is likely in a dialog component or the ChatPanel itself.

Add `locale` to the request body:

```typescript
body: JSON.stringify({
  dir: projectDir,
  backend: config.agent,
  locale,  // NEW -- read from useAppStore
}),
```

### 3.3 Update `useBuildActions.ts` -- pass locale to prompt templates

**File:** `src/hooks/useBuildActions.ts`

**Change:** Read locale from store and pass to all prompt template calls.

```typescript
// Add to the destructured store values (around line 29):
const locale = useAppStore((state) => state.locale)

// In runBatchBuild, update the promptTemplate call (line 92):
const prompt = [
  promptTemplate({
    architecture_yaml: scopedYaml,
    selected_nodes: [targetName],
    project_context: [...],
    user_feedback: `...`,
    locale,  // NEW
  }),
  // ...
].join('\n')

// In runNodeBuild, update the buildNodePrompt call (line 183):
buildNodePrompt({
  architecture_yaml: canvasToYaml(nodes, edges, projectName),
  selected_nodes: [targetName],
  project_context: [...],
  user_feedback: `...`,
  locale,  // NEW
}),
```

### Verification

- Open app with locale=zh, send a chat message. Check network tab: request body has `locale: "zh"`.
- Import a project with locale=zh. Check the request body has `locale: "zh"`.
- Start a build with locale=zh. Inspect the prompt passed to spawn API -- should contain Chinese language directive.

### Dependencies

Depends on Phase 2 (API routes must accept locale).

---

## Phase 4: Markdown Chat Rendering

### 4.1 Install dependencies

```bash
npm install react-markdown remark-gfm rehype-highlight
```

- `react-markdown` -- Markdown to React components
- `remark-gfm` -- GitHub Flavored Markdown (tables, strikethrough, task lists)
- `rehype-highlight` -- Syntax highlighting for code blocks via highlight.js

Also install the highlight.js CSS (a dark theme):

```bash
npm install highlight.js
```

No additional type packages needed -- `react-markdown` includes its own types.

### 4.2 Create `src/components/ChatMarkdown.tsx`

A thin wrapper component for rendering assistant messages:

```tsx
'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface ChatMarkdownProps {
  content: string
}

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        // Customize rendered elements for chat styling
        pre({ children }) {
          return (
            <pre className="my-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-sm">
              {children}
            </pre>
          )
        },
        code({ children, className }) {
          // Inline code (no language class)
          if (!className) {
            return (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm text-slate-800">
                {children}
              </code>
            )
          }
          // Block code (handled by pre wrapper)
          return <code className={className}>{children}</code>
        },
        p({ children }) {
          return <p className="my-1.5 leading-relaxed">{children}</p>
        },
        ul({ children }) {
          return <ul className="my-1.5 list-disc pl-5">{children}</ul>
        },
        ol({ children }) {
          return <ol className="my-1.5 list-decimal pl-5">{children}</ol>
        },
        li({ children }) {
          return <li className="my-0.5">{children}</li>
        },
        h1({ children }) {
          return <h1 className="my-2 text-base font-bold">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="my-2 text-sm font-bold">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="my-1.5 text-sm font-semibold">{children}</h3>
        },
        table({ children }) {
          return (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          )
        },
        th({ children }) {
          return (
            <th className="border border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold">
              {children}
            </th>
          )
        },
        td({ children }) {
          return (
            <td className="border border-slate-200 px-2 py-1 text-xs">
              {children}
            </td>
          )
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-1.5 border-l-3 border-slate-300 pl-3 italic text-slate-500">
              {children}
            </blockquote>
          )
        },
        a({ href, children }) {
          return (
            <a href={href} className="text-blue-600 underline hover:text-blue-800" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          )
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
```

### 4.3 Import highlight.js theme

In `src/app/globals.css` (or layout.tsx), add:

```css
@import 'highlight.js/styles/github-dark.css';
```

Or in `src/app/layout.tsx`:

```typescript
import 'highlight.js/styles/github-dark.css'
```

### 4.4 Update `ChatPanel.tsx` -- use ChatMarkdown for assistant messages

**File:** `src/components/ChatPanel.tsx`

**Change:** Replace the raw text rendering for assistant messages (around line 720):

```tsx
// BEFORE:
<div className="whitespace-pre-wrap break-words">
  {entry.content || (entry.role === 'assistant' && actionBlocks.length > 0 ? '' : '...')}
</div>

// AFTER:
{entry.role === 'assistant' ? (
  <div className="prose-chat break-words">
    {entry.content ? (
      <ChatMarkdown content={entry.content} />
    ) : (
      actionBlocks.length > 0 ? null : <span>...</span>
    )}
  </div>
) : (
  <div className="whitespace-pre-wrap break-words">
    {entry.content || '...'}
  </div>
)}
```

Import at the top of ChatPanel.tsx:

```typescript
import { ChatMarkdown } from './ChatMarkdown'
```

User messages remain as plain text (whitespace-pre-wrap) -- no markdown rendering for user input.

### 4.5 Canvas action blocks -- no change to extraction logic

The existing `extractActionBlocks` and `extractVisibleChatText` functions (from `src/lib/chat-actions.ts`) already strip `json:canvas-action` blocks before the text reaches the UI. The visible text passed to `ChatMarkdown` will not contain action blocks. No changes needed here.

### Verification

- Send a chat message that produces markdown in the response (e.g., "List the components as a bullet list with code examples"). Verify:
  - Bullet lists render as styled `<ul>` / `<li>` elements
  - Code blocks have syntax highlighting with dark background
  - Inline code has a light background pill
  - Tables render with borders
- Verify user messages still render as plain text
- Verify canvas action blocks are still extracted and hidden (Apply to Canvas button appears)
- Verify streaming still works correctly (markdown re-renders as chunks arrive)

### Dependencies

None -- can be done in parallel with Phases 1-3.

---

## Phase 5: i18n Keys for New UI Text

No new i18n keys are needed for this change set. The context-engine operates entirely on the backend/prompt side. The ChatMarkdown component has no user-facing text. The `locale` is already available in the store and i18n system.

If in the future we add a "Rendered with markdown" indicator or a toggle, keys would be added then.

---

## File Change Summary

| File | Action | Phase | Description |
|------|--------|-------|-------------|
| `src/lib/context-engine.ts` | **CREATE** | 1 | Unified context builder with locale, role, skill slot |
| `src/lib/prompt-templates.ts` | MODIFY | 2 | Add `locale` to input, use context-engine instead of local constants |
| `src/app/api/chat/route.ts` | MODIFY | 2 | Add `locale` to request, use context-engine, delete local CANVAS_ACTION_INSTRUCTIONS |
| `src/app/api/project/import/route.ts` | MODIFY | 2 | Add `locale` to request, use context-engine, locale-aware example names |
| `src/app/api/agent/spawn/route.ts` | NO CHANGE | -- | Receives pre-built prompts, no locale needed |
| `src/components/ChatPanel.tsx` | MODIFY | 3+4 | Pass locale in API calls (P3), use ChatMarkdown for assistant messages (P4) |
| `src/hooks/useBuildActions.ts` | MODIFY | 3 | Read locale from store, pass to prompt templates |
| `src/components/ChatMarkdown.tsx` | **CREATE** | 4 | Markdown renderer component with code highlighting |
| `src/app/globals.css` or `layout.tsx` | MODIFY | 4 | Import highlight.js dark theme CSS |
| Import dialog component | MODIFY | 3 | Pass locale to import API request |
| `src/lib/i18n.ts` | NO CHANGE | -- | Already has locale system, no new keys needed |
| `src/lib/store.ts` | NO CHANGE | -- | Already has locale in state |
| `src/lib/skill-loader.ts` | NO CHANGE | -- | Skill injection is a stub in context-engine for now |

### New npm dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react-markdown` | ^9.x | Markdown to React |
| `remark-gfm` | ^4.x | GFM support (tables, task lists) |
| `rehype-highlight` | ^7.x | Code syntax highlighting |
| `highlight.js` | ^11.x | Highlight.js themes (CSS only, rehype-highlight includes the core) |

### Execution Order

```
Phase 1 ─────────────────────────┐
                                 ├─→ Phase 2 ─→ Phase 3
Phase 4 (parallel) ──────────────┘
```

Phase 4 (markdown rendering) has no dependency on Phases 1-3 and can be done in parallel.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| react-markdown bundle size increase | Low | react-markdown + remark-gfm + rehype-highlight adds ~40KB gzipped. Acceptable for a chat app. |
| Streaming markdown flicker | Medium | react-markdown handles partial markdown well. If flicker occurs, debounce rendering to 100ms intervals. |
| LLM ignores language directive | Low | DeepSeek and Claude both follow "respond in Chinese" instructions reliably. If edge cases appear, strengthen the directive. |
| Prompt length increase from context-engine | Low | Language directive adds ~100 tokens. Negligible vs. architecture YAML. |
| Breaking change to existing prompts | Medium | Existing prompt behavior is preserved -- context-engine wraps the same content. Test all 3 API flows manually. |
