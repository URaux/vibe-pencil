import type { AgentBackend, CustomApiConfig } from '@/lib/agent-runner'
import { agentRunner } from '@/lib/agent-runner-instance'
import { extractAgentText } from '@/lib/agent-output'
import { buildSystemContext } from '@/lib/context-engine'
import type { Locale } from '@/lib/i18n'
import type { SessionPhase } from '@/lib/store'
import { streamChat } from '@/lib/llm-client'
import { getPersistentAgent } from '@/lib/persistent-agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  message: string
  history?: ChatMessage[]
  nodeContext?: string
  selectedNodeId?: string
  codeContext?: string
  buildSummaryContext?: string
  architecture_yaml: string
  backend?: AgentBackend
  model?: string
  locale?: Locale
  phase?: SessionPhase
  customApiBase?: string
  customApiKey?: string
  customApiModel?: string
}

function formatHistory(history: ChatMessage[] | undefined) {
  if (!history?.length) {
    return 'No prior conversation.'
  }

  return history
    .map((entry) => `<${entry.role}>\n${entry.content}\n</${entry.role}>`)
    .join('\n\n')
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

  return (process.env.VIBE_CHAT_AGENT_BACKEND as AgentBackend) ?? 'claude-code'
}

function buildPrompt({
  message,
  history,
  nodeContext,
  selectedNodeId,
  codeContext,
  buildSummaryContext,
  architecture_yaml,
  locale,
  phase,
}: ChatRequest) {
  const systemContext = buildSystemContext({
    agentType: 'canvas',
    task: selectedNodeId ? 'discuss-node' : 'discuss',
    locale: locale ?? 'en',
    canvasYaml: architecture_yaml,
    selectedNodeContext: nodeContext ?? (selectedNodeId ? undefined : 'Global chat mode. No node is selected.'),
    conversationHistory: formatHistory(history),
    codeContext,
    buildSummaryContext,
    sessionPhase: phase,
  })

  return [
    systemContext,
    '',
    'Latest user message:',
    message,
  ].join('\n')
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
  directConfig: { apiBase: string; apiKey: string; model: string }
) {
  const prompt = buildPrompt(payload)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false

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
        const gen = streamChat('', [{ role: 'user', content: prompt }], directConfig, request.signal)
        for await (const chunk of gen) {
          push({ type: 'chunk', text: chunk })
        }
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

async function handleCustomApiChat(request: Request, payload: ChatRequest) {
  const apiBase = (payload.customApiBase ?? '').replace(/\/$/, '')
  const apiKey = payload.customApiKey ?? ''
  const apiModel = payload.customApiModel || payload.model || 'gpt-4o'
  const prompt = buildPrompt(payload)

  if (!apiBase || !apiKey) {
    return Response.json({ error: 'Custom API base URL and key are required.' }, { status: 400 })
  }

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModel,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
      signal: request.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `Custom API request failed: ${msg}` }, { status: 502 })
  }

  if (!upstreamResponse.ok) {
    const errText = await upstreamResponse.text().catch(() => `HTTP ${upstreamResponse.status}`)
    return Response.json({ error: `Custom API error: ${errText.slice(0, 300)}` }, { status: 502 })
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
                push({ type: 'chunk', text: delta })
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }

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
  backend: 'claude-code' | 'codex' | 'gemini'
) {
  const prompt = buildPrompt(payload)
  const agent = getPersistentAgent({ backend, workDir: process.cwd(), model: payload.model })

  if (!agent.isAlive()) {
    await agent.start()
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let textAccumulated = ''

      const close = () => {
        if (closed) return
        closed = true
        agent.removeListener('event', onEvent)
        agent.removeListener('response-done', onDone)
        controller.close()
      }

      const push = (event: unknown) => {
        if (closed) return
        controller.enqueue(encodeEvent(event))
      }

      const onEvent = (event: Record<string, unknown>) => {
        if (closed) return

        // Claude stream-json: assistant messages carry content blocks with text
        if (event['type'] === 'assistant') {
          const message = event['message'] as Record<string, unknown> | undefined
          const content = message?.['content']
          if (Array.isArray(content)) {
            for (const block of content as Array<Record<string, unknown>>) {
              if (block['type'] === 'text' && typeof block['text'] === 'string') {
                const fullText = block['text'] as string
                if (fullText.length > textAccumulated.length) {
                  push({ type: 'chunk', text: fullText.slice(textAccumulated.length) })
                  textAccumulated = fullText
                }
              }
            }
          }
        }
      }

      const onDone = () => {
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

      agent.sendMessage(prompt).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        push({ type: 'error', error: `Failed to send message: ${msg}` })
        close()
      })
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

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatRequest

  if (!payload.message?.trim()) {
    return Response.json({ error: 'Message cannot be empty.' }, { status: 400 })
  }

  const backend = getBackend(payload.backend)

  // Fast path: if VIBE_LLM_* env vars are set, use direct HTTP (no CLI subprocess, no cold start).
  // This takes priority over CLI backends but NOT over an explicitly chosen custom-api backend
  // (which may have its own base URL / key from the UI).
  const directConfig = backend !== 'custom-api' ? getDirectApiConfig() : null
  if (directConfig) {
    return handleDirectApiChat(request, payload, directConfig)
  }

  if (backend === 'custom-api') {
    return handleCustomApiChat(request, payload)
  }

  // Persistent agent path: keep claude process alive between messages.
  // First message pays the cold-start cost; subsequent messages are near-instant.
  // Falls back to one-shot spawn if persistent agent fails.
  if (backend === 'claude-code') {
    try {
      return await handlePersistentChat(request, payload, backend)
    } catch {
      // Persistent agent failed — fall through to one-shot spawn
    }
  }

  // Fallback: one-shot spawn (used for codex/gemini and any unrecognized backend)
  const agentId = agentRunner.spawnAgent(
    'chat',
    buildPrompt(payload),
    backend,
    process.cwd(),
    payload.model
  )

  let cleanup = () => undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let sentLength = 0
      let closed = false

      const close = () => {
        if (closed) {
          return
        }

        closed = true
        cleanup()
        controller.close()
      }

      const push = (event: unknown) => {
        if (closed) {
          return
        }

        controller.enqueue(encodeEvent(event))
      }

      const intervalId = setInterval(() => {
        const status = agentRunner.getStatus(agentId)

        if (!status) {
          push({ type: 'error', error: 'Chat agent not found.' })
          close()
          return
        }

        const visibleText = extractAgentText(status.output)

        if (visibleText.length > sentLength) {
          push({ type: 'chunk', text: visibleText.slice(sentLength) })
          sentLength = visibleText.length
        }

        if (status.status === 'done') {
          push({ type: 'done' })
          close()
          return
        }

        if (status.status === 'error') {
          const errorMsg = status.errorMessage
            ? `Backend error: ${stripAnsi(status.errorMessage).slice(0, 200)}`
            : 'The AI backend encountered an error.'
          push({ type: 'error', error: errorMsg })
          close()
        }
      }, 125)

      cleanup = () => {
        clearInterval(intervalId)
      }

      request.signal.addEventListener('abort', close, { once: true })
    },
    cancel() {
      cleanup()
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
