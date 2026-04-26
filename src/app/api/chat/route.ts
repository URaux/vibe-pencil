import type { AgentBackend, CustomApiConfig } from '@/lib/agent-runner'
import { agentRunner } from '@/lib/agent-runner-instance'
import { ensureCanvasChatScaffold } from '@/lib/cc-native-scaffold'
import { extractAgentText } from '@/lib/agent-output'
import { buildSystemContext } from '@/lib/context-engine'
import type { Locale } from '@/lib/i18n'
import type { SessionPhase } from '@/lib/store'
import { streamChat } from '@/lib/llm-client'
import { getPersistentAgent } from '@/lib/persistent-agent'
import { compressHistory } from '@/lib/history-compressor'
import { readIrFile } from '@/lib/ir/persist'
import type { Ir } from '@/lib/ir'
import {
  readBrainstormState,
  updateBrainstormState,
  createInitialBrainstormState,
  formatStateForPrompt,
  parseAssistantControlComments,
  applyAssistantControl,
  type BrainstormState,
} from '@/lib/brainstorm/state'
import type { ChatRequest, FormSubmission } from './types'
import { runOrchestratorTurn } from './orchestrator-turn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/* ------------------------------------------------ brainstorm-state plumbing --- */

/**
 * Load or initialize brainstorm state for this turn. Returns `null` when
 * disabled (missing sessionId, non-brainstorm phase) or when reading the file
 * fails — callers should treat null as "skip brainstorm-state path entirely".
 */
async function loadOrInitBrainstormState(payload: ChatRequest): Promise<BrainstormState | null> {
  if (payload.phase !== 'brainstorm') return null
  const sessionId = payload.sessionId?.trim()
  if (!sessionId) return null
  try {
    const existing = await readBrainstormState(process.cwd(), sessionId)
    return existing ?? createInitialBrainstormState(sessionId)
  } catch (err) {
    console.warn('[chat] brainstorm-state load failed; skipping:', err)
    return null
  }
}

/**
 * Parse control comments out of the streamed assistant response and persist
 * the updated brainstorm state. Best-effort: failures log but never throw,
 * so persistence problems can't break the user-visible chat stream.
 *
 * Serialized per sessionId via `updateBrainstormState` — concurrent requests
 * (double-submit, retry, multiple tabs) are chained so no turn's events are
 * silently overwritten by a stale-snapshot last-write-wins race.
 */
async function persistBrainstormStateFromResponse(
  state: BrainstormState | null,
  fullText: string,
): Promise<void> {
  if (!state) return
  try {
    const control = parseAssistantControlComments(fullText)
    await updateBrainstormState(process.cwd(), state.sessionId, (current) => {
      // If another writer raced ahead, rebase our delta on top of their
      // state rather than the stale `state` captured at request start.
      const base = current ?? state
      return applyAssistantControl(base, control)
    })
  } catch (err) {
    console.warn('[chat] brainstorm-state persist failed:', err)
  }
}

/**
 * Compress-aware history formatter.
 *
 * Delegates to `compressHistory` which:
 *   - Leaves short histories untouched.
 *   - For long histories, uses a cheap LLM (direct API config) to summarize
 *     older messages and keeps the last N turns verbatim.
 *   - Falls back to a deterministic head-tail slice if no LLM config is set.
 */
async function formatHistory(history: ChatMessage[] | undefined, signal?: AbortSignal) {
  const result = await compressHistory(history, {
    llmConfig: getDirectApiConfig() ?? undefined,
    signal,
  })
  if (result.compressed) {
    console.log(
      '[chat] history compressed:',
      result.originalTokens,
      '→',
      result.compressedTokens,
      'tokens (≈' + Math.round((1 - result.compressedTokens / result.originalTokens) * 100) + '% reduction)',
    )
  }
  return result.formatted
}

/**
 * Returns a direct HTTP LLM config from environment variables, if available.
 * When set, chat bypasses CLI subprocess entirely (no cold start).
 * Set VIBE_LLM_API_BASE + VIBE_LLM_API_KEY (and optionally VIBE_LLM_MODEL).
 */
function getDirectApiConfig(): { apiBase: string; apiKey: string; model: string } | null {
  const apiBase = process.env.VIBE_LLM_API_BASE
  const apiKey = process.env.VIBE_LLM_API_KEY
  if (!apiBase || !apiKey) return null
  return {
    apiBase,
    apiKey,
    model: process.env.VIBE_LLM_MODEL ?? 'claude-sonnet-4-6',
  }
}

function getBackend(backend?: AgentBackend): AgentBackend {
  if (backend === 'codex' || backend === 'claude-code' || backend === 'gemini' || backend === 'custom-api') {
    return backend
  }

  return (process.env.VIBE_CHAT_AGENT_BACKEND as AgentBackend) ?? 'codex'
}

/**
 * Attempt to load IR from disk. Returns null on any failure (missing file,
 * validation error, unexpected I/O) so the caller can fall back silently.
 */
async function tryLoadIr(): Promise<Ir | null> {
  try {
    return await readIrFile(process.cwd())
  } catch (err) {
    console.warn('[chat] IR load failed, falling back to in-memory canvas yaml:', err)
    return null
  }
}

/**
 * Build separated system context and user message.
 * System context goes into the system role; user message into user role.
 *
 * @param ir - Optional canonical IR from disk. When provided, replaces in-memory
 *             canvasYaml as the architecture source-of-truth inside buildSystemContext.
 *             Callers should load this via tryLoadIr() before invoking this function.
 */
async function buildSplitPrompt(
  payload: ChatRequest,
  signal?: AbortSignal,
  ir?: Ir | null,
  brainstormState?: BrainstormState | null,
  /**
   * When true, signals the caller delivers this prompt via a real `system`
   * role (direct-api / custom-api). Takes priority over the UI's backend
   * label for prompt-shape selection — a payload tagged `backend: 'codex'`
   * routed through VIBE_LLM_* direct API still gets the long API variant,
   * not the compact CLI one.
   */
  deliversAsSystemRole = false,
): Promise<{ system: string; user: string }> {
  const {
    message,
    history,
    nodeContext,
    selectedNodeId,
    codeContext,
    buildSummaryContext,
    architecture_yaml,
    locale,
    phase,
  } = payload

  const conversationHistory = await formatHistory(history, signal)

  const brainstormPrefix = brainstormState ? formatStateForPrompt(brainstormState) : ''

  const system = buildSystemContext({
    agentType: 'canvas',
    task: selectedNodeId ? 'discuss-node' : 'discuss',
    locale: locale ?? 'en',
    canvasYaml: architecture_yaml,
    selectedNodeContext: nodeContext ?? (selectedNodeId ? undefined : 'Global chat mode. No node is selected.'),
    conversationHistory,
    codeContext,
    buildSummaryContext,
    sessionPhase: phase,
    brainstormRound: phase === 'brainstorm'
      ? (history ?? []).filter(m => m.role === 'assistant').length + 1
      : undefined,
    // For api-role delivery, mask out the UI backend label so the prompt
    // builder picks the long variant (we have system-role control here).
    backend: deliversAsSystemRole ? undefined : payload.backend,
    ir,
  })

  const systemWithPrefix = brainstormPrefix
    ? `${brainstormPrefix}\n\n${system}`
    : system

  console.log('[chat] phase:', phase, '| system length:', systemWithPrefix.length, '| history entries:', payload.history?.length ?? 0, '| brainstorm-state:', brainstormPrefix ? 'on' : 'off')

  return { system: systemWithPrefix, user: message }
}

/** Legacy: single prompt string for CC CLI stdin fallback */
async function buildPrompt(
  payload: ChatRequest,
  signal?: AbortSignal,
  ir?: Ir | null,
  brainstormState?: BrainstormState | null,
): Promise<string> {
  const { system, user } = await buildSplitPrompt(payload, signal, ir, brainstormState)
  // CC backend ignores our system role in persistent-stream-json mode; it runs
  // its own loop using the scaffold's CLAUDE.md + skills. Prepend an explicit
  // phase marker + skill-invocation directive so the scaffold's phase-routing
  // rule fires on turn 1 instead of CC defaulting to conversational reply.
  const phaseMarker = payload.phase === 'brainstorm'
    ? '[Phase: brainstorm — invoke `archviber-brainstorm` skill immediately; follow v2 protocol]'
    : payload.phase === 'design' || payload.phase === 'iterate'
      ? `[Phase: ${payload.phase} — invoke \`archviber-canvas\` skill when editing the diagram]`
      : ''
  const parts = [system, '']
  if (phaseMarker) parts.push(phaseMarker, '')
  parts.push('Latest user message:', user)
  return parts.join('\n')
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function encodeEvent(payload: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}

async function handleDirectApiChat(
  request: Request,
  payload: ChatRequest,
  directConfig: { apiBase: string; apiKey: string; model: string },
  ir?: Ir | null,
  brainstormState?: BrainstormState | null,
) {
  const { system, user } = await buildSplitPrompt(payload, request.signal, ir, brainstormState, true)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let fullText = ''

      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }

      const push = (event: unknown) => {
        if (closed) return
        controller.enqueue(encodeEvent(event))
      }

      try {
        const gen = streamChat(system, [{ role: 'user', content: user }], directConfig, request.signal)
        for await (const chunk of gen) {
          fullText += chunk
          push({ type: 'chunk', text: chunk })
        }
        await persistBrainstormStateFromResponse(brainstormState ?? null, fullText)
        push({ type: 'done' })
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          push({ type: 'error', error: `Direct API error: ${err.message}` })
        }
      } finally {
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    },
  })
}

async function handleCustomApiChat(
  request: Request,
  payload: ChatRequest,
  ir?: Ir | null,
  brainstormState?: BrainstormState | null,
) {
  const apiBase = (payload.customApiBase ?? '').replace(/\/+$/, '')
  const apiKey = payload.customApiKey ?? ''
  const apiModel = payload.customApiModel || payload.model || 'gpt-4o'
  const { system, user } = await buildSplitPrompt(payload, request.signal, ir, brainstormState, true)

  if (!apiBase || !apiKey) {
    return Response.json({ error: 'Custom API base URL and key are required.' }, { status: 400 })
  }

  // Try multiple URL paths: some APIs use /chat/completions, others /v1/chat/completions
  const candidates = apiBase.endsWith('/v1')
    ? [`${apiBase}/chat/completions`]
    : [`${apiBase}/v1/chat/completions`, `${apiBase}/chat/completions`]

  const reqBody = JSON.stringify({
    model: apiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: true,
  })
  const reqHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  let upstreamResponse: Response | null = null
  let lastError = ''
  for (const url of candidates) {
    try {
      console.log(`[custom-api] trying POST ${url}`)
      const resp = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: reqBody,
        signal: request.signal,
      })
      if (resp.ok) {
        upstreamResponse = resp
        break
      }
      // 404 = wrong path, try next; other errors = real failure
      if (resp.status === 404 && candidates.length > 1) {
        lastError = `${url}: HTTP ${resp.status}`
        continue
      }
      const errText = await resp.text().catch(() => `HTTP ${resp.status}`)
      return Response.json({ error: `Custom API error: ${errText.slice(0, 300)}` }, { status: 502 })
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      continue
    }
  }

  if (!upstreamResponse) {
    return Response.json({ error: `Custom API request failed: ${lastError}` }, { status: 502 })
  }

  const reader = upstreamResponse.body?.getReader()
  if (!reader) {
    return Response.json({ error: 'No response body from custom API.' }, { status: 502 })
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const decoder = new TextDecoder()
      let buffer = ''
      let closed = false
      let fullText = ''

      const close = () => {
        if (closed) return
        closed = true
        controller.close()
      }

      const push = (event: unknown) => {
        if (closed) return
        controller.enqueue(encodeEvent(event))
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>
              }
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) {
                fullText += delta
                push({ type: 'chunk', text: delta })
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }

        await persistBrainstormStateFromResponse(brainstormState ?? null, fullText)
        push({ type: 'done' })
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          push({ type: 'error', error: `Stream error: ${err.message}` })
        }
      } finally {
        close()
      }
    },
    cancel() {
      reader.cancel().catch(() => undefined)
    },
  })

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    },
  })
}

async function handlePersistentChat(
  request: Request,
  payload: ChatRequest,
  backend: 'claude-code' | 'codex' | 'gemini',
  ir?: Ir | null,
  brainstormState?: BrainstormState | null,
) {
  // For Claude Code, spawn inside a scratch dir that contains a CLAUDE.md +
  // archviber-canvas skill. CC loads them natively (no injected system
  // prompt), and the skill supplies the canvas-action contract only when
  // the user actually asks to edit the diagram.
  const reqId = `chat-${Date.now().toString(36).slice(-6)}`
  // Use process.stdout.write with explicit UTF-8 to avoid Windows GBK console
  // re-encoding Chinese characters from CC stderr into mojibake (Bug #2).
  const log = (stage: string, extra?: Record<string, unknown>) => {
    const line = `[chat] ${reqId} ${stage}${extra ? ' ' + JSON.stringify(extra) : ''}\n`
    process.stdout.write(Buffer.from(line, 'utf8'))
  }

  const workDir = backend === 'claude-code'
    ? await ensureCanvasChatScaffold()
    : process.cwd()
  log('scaffold-ready', { workDir })

  const agent = getPersistentAgent({
    backend,
    workDir,
    model: payload.model,
    resumeSessionId: payload.ccSessionId || undefined,
  })
  const prompt = agent.hasConversation()
    ? await buildPrompt({ ...payload, history: [] }, request.signal, ir, brainstormState)
    : await buildPrompt(payload, request.signal, ir, brainstormState)
  log('prompt-built', { promptChars: prompt.length, hasConversation: agent.hasConversation(), resumeSessionId: payload.ccSessionId ?? null })

  if (!agent.isAlive()) {
    log('agent-starting')
    const startedAt = Date.now()
    await agent.start()
    log('agent-started', { ms: Date.now() - startedAt })
  } else {
    log('agent-alive')
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let textAccumulated = ''
      let sentSessionId = false

      const close = () => {
        if (closed) return
        closed = true
        agent.removeListener('event', onEvent)
        agent.removeListener('response-done', onDone)
        controller.close()
      }

      // Fire-and-forget persistence on response-done. We snapshot
      // `textAccumulated` (the full assistant text) and let the I/O race
      // controller.close — failures are swallowed inside the helper.
      const persistAndCleanup = () => {
        void persistBrainstormStateFromResponse(brainstormState ?? null, textAccumulated)
      }

      const push = (event: unknown) => {
        if (closed) return
        controller.enqueue(encodeEvent(event))
      }

      let firstEventAt = 0
      // Track which assistant-message id -> longest text we've already emitted
      // for THAT message's text block. CC stream-json semantics: each unique
      // message (by `message.id`) owns its own text. Within a single message,
      // subsequent events of the same id may deliver cumulative snapshots —
      // so we emit only the delta inside a message. Across different messages
      // (e.g., after a tool round), text is additive — emit it all fresh.
      const messageTextSeen = new Map<string, number>()
      const onEvent = (event: Record<string, unknown>) => {
        if (closed) return
        if (firstEventAt === 0) {
          firstEventAt = Date.now()
          log('first-event', { type: event['type'], hasSessionId: typeof event['session_id'] === 'string' })
        }

        if (!sentSessionId && typeof event['session_id'] === 'string') {
          push({ type: 'session', ccSessionId: event['session_id'] })
          sentSessionId = true
        }

        // Claude stream-json: assistant messages carry content blocks with text.
        // A conversation can span multiple assistant messages (tool rounds, etc.);
        // each message has its own id and its own text payload. Key the delta
        // accounting per-message-id so later messages' text is always forwarded
        // instead of being swallowed by a smaller .length check against a global
        // accumulator.
        if (event['type'] === 'assistant') {
          const message = event['message'] as Record<string, unknown> | undefined
          const content = message?.['content']
          const messageId = typeof message?.['id'] === 'string' ? (message['id'] as string) : '__no_id__'
          if (Array.isArray(content)) {
            // Concatenate all text blocks within this message (CC may split a
            // single assistant turn into multiple text blocks interleaved with
            // tool_use). For text-only outputs this just returns the whole text.
            let messageText = ''
            for (const block of content as Array<Record<string, unknown>>) {
              if (block['type'] === 'text' && typeof block['text'] === 'string') {
                messageText += block['text'] as string
              }
            }
            if (messageText.length > 0) {
              const alreadySent = messageTextSeen.get(messageId) ?? 0
              if (messageText.length > alreadySent) {
                const delta = messageText.slice(alreadySent)
                push({ type: 'chunk', text: delta })
                textAccumulated += delta
                messageTextSeen.set(messageId, messageText.length)
              }
            }
          }
        }
      }

      const onDone = () => {
        log('response-done', { totalChars: textAccumulated.length, msSinceFirstEvent: firstEventAt ? Date.now() - firstEventAt : null })
        persistAndCleanup()
        push({ type: 'done' })
        close()
      }

      agent.on('event', onEvent)
      agent.on('response-done', onDone)

      request.signal.addEventListener(
        'abort',
        () => {
          close()
        },
        { once: true }
      )

      log('sending-to-agent', { promptChars: prompt.length })
      const sentAt = Date.now()

      // Resilience layer around agent.sendMessage covering two distinct
      // failure modes we've observed in the wild:
      //
      //   1. "No conversation found with session ID: X" — the stored
      //      ccSessionId points at a CC session that no longer exists
      //      (CC state wiped, process restart, cache cleanup). Needs a
      //      full agent reset without --resume + 'session-reset' event
      //      so the client clears its stored id.
      //
      //   2. Transient upstream failures surfaced as the CC result event's
      //      error text, e.g. "API Error: ... ECONNRESET", "fetch failed",
      //      504, "overloaded_error". A single retry usually works; the
      //      agent itself is fine, session id is fine.
      const isStaleResumeError = (msg: string) =>
        /no conversation found/i.test(msg) ||
        /session(?: id)?.*not found/i.test(msg)

      const isTransientUpstreamError = (msg: string) =>
        /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(msg) ||
        /API Error:/i.test(msg) ||
        /overloaded_error|rate_limit|503|504/i.test(msg) ||
        /fetch failed/i.test(msg)

      const sendWithRecovery = async () => {
        try {
          await agent.sendMessage(prompt)
          log('send-resolved', { ms: Date.now() - sentAt })
          return
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)

          if (isStaleResumeError(msg) && payload.ccSessionId) {
            log('stale-resume-detected', { staleSessionId: payload.ccSessionId })
            agent.kill()
            const freshAgent = getPersistentAgent({
              backend,
              workDir,
              model: payload.model,
              resumeSessionId: undefined,
            })
            freshAgent.on('event', onEvent)
            freshAgent.on('response-done', onDone)
            push({ type: 'session-reset', staleSessionId: payload.ccSessionId })
            await freshAgent.start()
            try {
              await freshAgent.sendMessage(prompt)
              log('send-resolved-after-reset', { ms: Date.now() - sentAt })
              return
            } catch (retryErr) {
              const rmsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
              log('send-error-after-reset', { err: rmsg })
              push({ type: 'error', error: `Failed to send message: ${rmsg}` })
              close()
              return
            }
          }

          if (isTransientUpstreamError(msg)) {
            // Back off briefly then retry once with the same agent + session.
            log('transient-upstream-retry', { firstError: msg })
            await new Promise((r) => setTimeout(r, 1500))
            try {
              await agent.sendMessage(prompt)
              log('send-resolved-after-retry', { ms: Date.now() - sentAt })
              return
            } catch (retryErr) {
              const rmsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
              log('send-error-after-retry', { err: rmsg, firstError: msg })
              push({ type: 'error', error: `Failed to send message: ${rmsg}` })
              close()
              return
            }
          }

          log('send-error', { err: msg })
          push({ type: 'error', error: `Failed to send message: ${msg}` })
          close()
        }
      }
      void sendWithRecovery()
    },
    cancel() {
      agent.removeListener('event', () => undefined)
      agent.removeListener('response-done', () => undefined)
    },
  })

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    },
  })
}

/**
 * Convert one or more structured FormSubmission(s) into the synthetic user
 * message the model will see. Kept deterministic so the model can detect
 * "this came from a UI form" and respond accordingly.
 *
 * - Single submission: same format as before (`[form-submission] …`).
 * - Multiple submissions: each card gets its own block, separated by a blank
 *   line, so the model sees all card answers in one user turn.
 */
function renderFormSubmission(sub: FormSubmission, fallbackMessage: string): string {
  const orderedTag = sub.ordered ? ' (ordered)' : ''
  const lines = [
    `[form-submission${orderedTag}]`,
    sub.questionId ? `question_id: ${sub.questionId}` : null,
    `selections: ${JSON.stringify(sub.selections)}`,
    fallbackMessage ? `note: ${fallbackMessage}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}

function renderFormSubmissions(subs: FormSubmission[], fallbackMessage: string): string {
  if (subs.length === 1) return renderFormSubmission(subs[0], fallbackMessage)
  return subs
    .map((sub, i) => {
      const orderedTag = sub.ordered ? ' (ordered)' : ''
      const lines = [
        `[form-submission${orderedTag} card:${i}]`,
        sub.questionId ? `question_id: ${sub.questionId}` : null,
        `selections: ${JSON.stringify(sub.selections)}`,
      ].filter(Boolean)
      return lines.join('\n')
    })
    .join('\n\n')
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatRequest

  // Materialize structured form submissions into a synthetic user message
  // BEFORE the empty-message guard, so multi-select cards can submit without
  // any chat-text payload.
  // `formSubmissions` (array) takes priority over singular `formSubmission`.
  if (Array.isArray(payload.formSubmissions) && payload.formSubmissions.length > 0) {
    payload.message = renderFormSubmissions(payload.formSubmissions, payload.message ?? '')
  } else if (payload.formSubmission && Array.isArray(payload.formSubmission.selections)) {
    payload.message = renderFormSubmission(payload.formSubmission, payload.message ?? '')
  }

  if (!payload.message?.trim()) {
    return Response.json({ error: 'Message cannot be empty.' }, { status: 400 })
  }

  const backend = getBackend(payload.backend)

  // Load canonical IR from disk once per request. Non-blocking: null on any failure.
  const ir = await tryLoadIr()

  if (process.env.ARCHVIBER_ORCHESTRATOR !== '0' && ir) {
    const orchestratorResponse = await runOrchestratorTurn({ payload, ir, request })
    if (orchestratorResponse) return orchestratorResponse
    // null → fall through to legacy path (handler returned not_implemented)
  }

  // Load (or initialize) per-session brainstorm state for novice/long-conversation
  // anchoring. Returns null when phase !== 'brainstorm' or sessionId missing.
  const brainstormState = await loadOrInitBrainstormState(payload)

  // Fast path: if VIBE_LLM_* env vars are set, use direct HTTP (no CLI subprocess, no cold start).
  // This takes priority over CLI backends but NOT over an explicitly chosen custom-api backend
  // (which may have its own base URL / key from the UI).
  const directConfig = backend !== 'custom-api' ? getDirectApiConfig() : null
  if (directConfig) {
    return handleDirectApiChat(request, payload, directConfig, ir, brainstormState)
  }

  if (backend === 'custom-api') {
    return handleCustomApiChat(request, payload, ir, brainstormState)
  }
  if (backend === 'claude-code') {
    try {
      return await handlePersistentChat(request, payload, backend, ir, brainstormState)
    } catch (err) {
      console.error('[chat] persistent Claude path failed, falling back to one-shot:', err)
    }
  }

  // Fallback: one-shot spawn (used for CC/codex/gemini)
  // CC CLI: combined prompt via stdin (--system-prompt conflicts with CC's own system prompt).
  // Context is embedded in the user message — CC treats it as user input and responds accordingly.
  // When resuming a CC session (--resume), skip history in the prompt — CC already has it from the
  // session cache. Sending it again would double-count and overflow context after ~3 rounds.
  // Only use session resume for CLI backends. The ccSessionId is stored generically on the
  // ChatSession — if the user switches backend mid-session, ignore the stale ID.
  const supportsResume = backend === 'claude-code' || backend === 'codex' || backend === 'gemini'
  const ccSessionId = supportsResume ? (payload.ccSessionId || undefined) : undefined
  const prompt = ccSessionId
    ? await buildPrompt({ ...payload, history: [] }, request.signal, ir, brainstormState)
    : await buildPrompt(payload, request.signal, ir, brainstormState)
  const spawnWorkDir = backend === 'claude-code'
    ? await ensureCanvasChatScaffold()
    : process.cwd()
  const agentId = agentRunner.spawnAgent(
    'chat',
    prompt,
    backend,
    spawnWorkDir,
    payload.model,
    undefined,
    ccSessionId
  )

  // Wait for agent to complete, then return full response as JSON.
  // Simple request-response — no SSE complexity for CLI spawn path.
  const finalStatus = await new Promise<ReturnType<typeof agentRunner.getStatus>>((resolve) => {
    const aborted = { value: false }
    request.signal.addEventListener('abort', () => {
      aborted.value = true
      agentRunner.stopAgent(agentId)
    }, { once: true })
    const intervalId = setInterval(() => {
      if (aborted.value) {
        clearInterval(intervalId)
        resolve(null)
        return
      }
      const status = agentRunner.getStatus(agentId)
      if (!status || status.status === 'done' || status.status === 'error') {
        clearInterval(intervalId)
        resolve(status)
      }
    }, 500)
  })

  if (!finalStatus) {
    return Response.json({ error: 'Chat agent not found or request aborted.' }, { status: 500 })
  }

  if (finalStatus.status === 'error') {
    const rawErr = finalStatus.errorMessage ? stripAnsi(finalStatus.errorMessage) : ''
    // Write via process.stderr with explicit UTF-8 to avoid Windows GBK mojibake on Chinese error text.
    process.stderr.write(Buffer.from(`[chat] CC agent error: ${rawErr.slice(0, 500)}\n`, 'utf8'))
    process.stderr.write(Buffer.from(`[chat] CC agent output: ${stripAnsi(finalStatus.output ?? '').slice(0, 500)}\n`, 'utf8'))
    const errorMsg = rawErr
      ? `Backend error: ${rawErr.slice(0, 200)}`
      : 'The AI backend encountered an error.'
    return Response.json({ error: errorMsg }, { status: 500 })
  }

  const fullText = extractAgentText(finalStatus.output)
  const sessionMatch = finalStatus.output.match(/"session_id"\s*:\s*"([0-9a-f-]{36})"/)

  await persistBrainstormStateFromResponse(brainstormState, fullText)

  return Response.json({
    content: fullText,
    ccSessionId: sessionMatch?.[1] ?? null,
  })
}
