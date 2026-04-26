import type { Ir } from '@/lib/ir'
import { summarizeIr, classifyIntent, dispatchIntent } from '@/lib/orchestrator'
import { recordTurnStart, recordClassification, recordDispatch } from '@/lib/orchestrator/log'
import type { HandlerResult } from '@/lib/orchestrator/types'
import type { ChatRequest } from './types'
import crypto from 'node:crypto'

function hashPrompt(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)
}

function clarifyMessage(classifyResult: { confidence: number; fallbackReason?: string }): string {
  return (
    "I'm not sure what you'd like — did you want to " +
    '(a) edit the design, (b) build/run something, (c) modify a block, ' +
    '(d) deep-analyze the code, or (e) get an explanation? ' +
    'Tell me which and I\'ll proceed.'
  )
}

export function stringifyHandlerResult(result: HandlerResult): string {
  if (result.status === 'not_implemented') {
    return `${result.intent} is not yet implemented in orchestrator mode.`
  }

  if (result.intent === 'deep_analyze' && result.status === 'ok') {
    const payload = result.payload as { perspectives: string[]; analystInputs: unknown[] } | undefined
    const perspectives = payload?.perspectives ?? []
    return `Analysis prepared. ${perspectives.length} perspectives queued: ${perspectives.join(', ')}`
  }

  return `${result.intent}\n${JSON.stringify(result.payload, null, 2)}`
}

export async function runOrchestratorTurn({
  payload,
  ir,
  request: _request,
}: {
  payload: ChatRequest
  ir: Ir
  request: Request
}): Promise<Response | null> {
  const turnRecord = recordTurnStart({
    userPromptHash: hashPrompt(payload.message),
    irBlocks: ir.blocks.length,
  })

  const summary = summarizeIr(ir)
  const classifyResult = await classifyIntent(payload.message, summary)

  recordClassification(turnRecord, {
    intent: classifyResult.intent,
    confidence: classifyResult.confidence,
    fallback: classifyResult.fallback,
    fallbackReason: classifyResult.fallbackReason,
  })

  if (classifyResult.fallback) {
    return Response.json({
      content: clarifyMessage(classifyResult),
      orchestrator: {
        intent: 'clarify',
        confidence: classifyResult.confidence,
        fallback: true,
        fallbackReason: classifyResult.fallbackReason,
      },
      ccSessionId: null,
    })
  }

  const result = await dispatchIntent({
    userPrompt: payload.message,
    irSummary: summary,
    ir,
    classifyResult,
    workDir: process.cwd(),
  })

  recordDispatch(turnRecord, {
    intent: result.intent,
    status: result.status,
    error: result.error,
  })

  if (result.status === 'not_implemented') {
    return null
  }

  if (result.status === 'error') {
    return Response.json(
      {
        error: result.error ?? 'Handler error',
        orchestrator: {
          intent: classifyResult.intent,
          confidence: classifyResult.confidence,
          fallback: classifyResult.fallback,
        },
      },
      { status: 500 }
    )
  }

  return Response.json({
    content: stringifyHandlerResult(result),
    orchestrator: {
      intent: classifyResult.intent,
      confidence: classifyResult.confidence,
      fallback: classifyResult.fallback,
    },
    ccSessionId: null,
  })
}
