import { ensureCanvasChatScaffold } from '@/lib/cc-native-scaffold'
import { aggregateReports } from '@/lib/deep-analyze/aggregate'
import { runDeepAnalyze } from '@/lib/deep-analyze/runner'
import { PERSPECTIVE_NAMES } from '@/lib/deep-analyze/types'
import { irSchema, type Ir } from '@/lib/ir/schema'

export const runtime = 'nodejs'

interface DeepAnalyzeRequest {
  ir: Ir
  projectRoot: string
  backend?: 'claude-code' | 'codex'
  model?: string
}

const encoder = new TextEncoder()

function encodeNdjson(event: unknown) {
  return encoder.encode(`${JSON.stringify(event)}\n`)
}

export async function POST(request: Request) {
  const payload = (await request.json()) as DeepAnalyzeRequest

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (event: unknown) => controller.enqueue(encodeNdjson(event))

        try {
          const ir = irSchema.parse(payload?.ir)
          const workDir = typeof ensureCanvasChatScaffold === 'function'
            ? await ensureCanvasChatScaffold()
            : process.cwd()

          for (const perspective of PERSPECTIVE_NAMES) {
            push({ type: 'perspective-start', perspective })
          }

          const results = await runDeepAnalyze(ir, payload.projectRoot, {
            backend: payload.backend,
            model: payload.model,
            workDir,
          })

          for (const result of results) {
            push({
              type: 'perspective-done',
              perspective: result.perspective,
              status: result.status,
              durationMs: result.durationMs,
            })
          }

          push({
            type: 'aggregate',
            markdown: aggregateReports(results, { projectName: ir.project.name }),
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          push({ type: 'error', message })
        } finally {
          controller.close()
        }
      },
    }),
    {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'application/x-ndjson; charset=utf-8',
      },
    }
  )
}
