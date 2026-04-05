import { buildSystemContext } from '@/lib/context-engine'
import { formatScanForPrompt } from '@/lib/scan-formatter'
import { canvasToYaml } from '@/lib/schema-engine'
import { agentRunner } from '@/lib/agent-runner-instance'
import { extractAgentText, extractJsonObject } from '@/lib/agent-output'
import { normalizeCanvas } from '@/lib/import-normalizer'
import type { ProjectScan } from '@/lib/project-scanner'
import type { Locale } from '@/lib/i18n'
import type { Edge, Node } from '@xyflow/react'
import type { CanvasNodeData } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface EnhanceRequest {
  dir: string
  scan: ProjectScan
  skeletonNodes: Node<CanvasNodeData>[]
  skeletonEdges: Edge[]
  backend?: 'claude-code' | 'codex' | 'gemini'
  locale?: Locale
}

export async function POST(request: Request) {
  const { dir, scan, skeletonNodes, skeletonEdges, backend, locale } =
    (await request.json()) as EnhanceRequest

  if (!dir?.trim()) {
    return Response.json({ error: 'Project directory path cannot be empty.' }, { status: 400 })
  }

  if (!scan || !Array.isArray(skeletonNodes)) {
    return Response.json({ error: 'Missing scan data or skeleton nodes.' }, { status: 400 })
  }

  const projectSummary = formatScanForPrompt(scan)
  const existingYaml = canvasToYaml(skeletonNodes, skeletonEdges ?? [], scan.name)

  const prompt = buildSystemContext({
    agentType: 'canvas',
    task: 'import-enhance',
    locale: locale ?? 'en',
    taskParams: {
      dir,
      projectSummary,
      existingYaml,
    },
  })

  const resolvedBackend = backend ?? 'codex'
  const agentId = agentRunner.spawnAgent('project-enhance', prompt, resolvedBackend, dir)

  const encoder = new TextEncoder()
  let cleanup = () => { /* noop */ }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const close = () => {
        if (closed) return
        closed = true
        cleanup()
        controller.close()
      }

      const push = (data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      // Send progress heartbeats every 3 seconds
      const heartbeat = setInterval(() => {
        const status = agentRunner.getStatus(agentId)
        if (!status) return
        push({ type: 'progress', status: status.status })
        if (status.status === 'done' || status.status === 'error') {
          clearInterval(heartbeat)
        }
      }, 3000)

      const handleStatus = (event: { agentId: string; status: string }) => {
        if (event.agentId !== agentId) return

        const info = agentRunner.getStatus(agentId)
        if (!info) return

        if (event.status === 'done') {
          try {
            const agentText = extractAgentText(info.output)
            const parsed = extractJsonObject(agentText)
            if (parsed) {
              const canvas = normalizeCanvas(parsed)
              push({ type: 'enhanced', canvas })
            } else {
              push({ type: 'error', error: 'Could not parse enhanced architecture from agent.' })
            }
          } catch (err) {
            push({ type: 'error', error: err instanceof Error ? err.message : 'Parse failed' })
          }
          close()
        } else if (event.status === 'error') {
          push({ type: 'error', error: info.errorMessage ?? 'Enhancement agent failed' })
          close()
        }
      }

      cleanup = () => {
        clearInterval(heartbeat)
        agentRunner.off('status', handleStatus)
      }

      agentRunner.on('status', handleStatus)
      request.signal.addEventListener('abort', () => {
        agentRunner.stopAgent(agentId)
        close()
      }, { once: true })

      // Initial event
      push({ type: 'started', agentId })
    },
    cancel() {
      agentRunner.stopAgent(agentId)
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
