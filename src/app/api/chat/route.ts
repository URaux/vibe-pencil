import type { AgentBackend } from '@/lib/agent-runner'
import { agentRunner } from '@/lib/agent-runner-instance'
import { extractAgentText } from '@/lib/agent-output'

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
  architecture_yaml: string
  backend?: AgentBackend
  model?: string
}

const CANVAS_ACTION_INSTRUCTIONS = [
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

function formatHistory(history: ChatMessage[] | undefined) {
  if (!history?.length) {
    return 'No prior conversation.'
  }

  return history.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join('\n\n')
}

function getBackend(backend?: AgentBackend): AgentBackend {
  if (backend === 'codex' || backend === 'claude-code' || backend === 'gemini') {
    return backend
  }

  return (process.env.VIBE_CHAT_AGENT_BACKEND as AgentBackend) ?? 'claude-code'
}

function buildPrompt({ message, history, nodeContext, architecture_yaml }: ChatRequest) {
  return [
    'You are the AI discussion panel for a software architecture canvas.',
    'Respond as a collaborative architecture assistant grounded in the provided canvas state.',
    'Reference the selected node context when it is available.',
    CANVAS_ACTION_INSTRUCTIONS,
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

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function encodeEvent(payload: unknown) {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}

export async function POST(request: Request) {
  const payload = (await request.json()) as ChatRequest

  if (!payload.message?.trim()) {
    return Response.json({ error: 'Message cannot be empty.' }, { status: 400 })
  }

  const agentId = agentRunner.spawnAgent(
    'chat',
    buildPrompt(payload),
    getBackend(payload.backend),
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
