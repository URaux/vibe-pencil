import { summarizeIr, classifyIntent, dispatchIntent } from '.'
import type { Ir } from '@/lib/ir'
import type { ClassifyResult, HandlerResult } from './types'

export interface StreamClassifyEvent {
  type: 'classify'
  intent: ClassifyResult['intent'] | 'clarify'
  confidence: number
  fallback: boolean
}

export interface StreamDispatchStartEvent {
  type: 'dispatch_start'
  intent: ClassifyResult['intent']
}

export interface StreamDispatchDoneEvent {
  type: 'dispatch_done'
  status: HandlerResult['status']
  payload: unknown
  error?: string
}

export type OrchestratorStreamEvent =
  | StreamClassifyEvent
  | StreamDispatchStartEvent
  | StreamDispatchDoneEvent

function encodeSSE(event: OrchestratorStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

export interface RunStreamOrchestratorTurnOptions {
  prompt: string
  ir: Ir
  signal?: AbortSignal
}

export function runStreamOrchestratorTurn(opts: RunStreamOrchestratorTurnOptions): Response {
  const { prompt, ir, signal } = opts

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: OrchestratorStreamEvent) => {
        if (signal?.aborted) return
        controller.enqueue(encodeSSE(event))
      }

      try {
        const summary = summarizeIr(ir)
        const classifyResult = await classifyIntent(prompt, summary)

        push({
          type: 'classify',
          intent: classifyResult.fallback ? 'clarify' : classifyResult.intent,
          confidence: classifyResult.confidence,
          fallback: classifyResult.fallback,
        })

        if (classifyResult.fallback) {
          controller.close()
          return
        }

        push({ type: 'dispatch_start', intent: classifyResult.intent })

        const result = await dispatchIntent({
          userPrompt: prompt,
          irSummary: summary,
          ir,
          classifyResult,
          workDir: process.cwd(),
        })

        push({
          type: 'dispatch_done',
          status: result.status,
          payload: result.payload ?? null,
          error: result.error,
        })
      } catch (err) {
        push({
          type: 'dispatch_done',
          status: 'error',
          payload: null,
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
