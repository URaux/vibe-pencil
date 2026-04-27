import type { Ir } from '@/lib/ir'
import { summarizeIr, classifyIntent, dispatchIntent } from '@/lib/orchestrator'
import { recordTurnStart, recordClassification, recordDispatch } from '@/lib/orchestrator/log'
import type { HandlerResult, Intent } from '@/lib/orchestrator/types'
import type { ChatRequest } from './types'
import crypto from 'node:crypto'

function hashPrompt(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)
}

export interface TopIntent {
  intent: Intent
  confidence: number
}

/**
 * Extracts the top-k intents from classifier rawOutput.
 * If rawOutput contains `intent_scores: Record<Intent, number>`, uses those.
 * Otherwise returns a single-entry array from the primary intent/confidence.
 */
export function getTopIntents(
  rawOutput: string,
  primaryIntent: Intent,
  primaryConfidence: number,
  k = 2,
): TopIntent[] {
  try {
    const match = rawOutput.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>
      const scores = parsed['intent_scores']
      if (scores && typeof scores === 'object' && !Array.isArray(scores)) {
        return Object.entries(scores as Record<string, number>)
          .filter(([, v]) => typeof v === 'number')
          .sort(([, a], [, b]) => b - a)
          .slice(0, k)
          .map(([intent, confidence]) => ({ intent: intent as Intent, confidence }))
      }
    }
  } catch {
    // fall through
  }
  return [{ intent: primaryIntent, confidence: primaryConfidence }]
}

const GENERIC_CLARIFY =
  "I'm not sure what you'd like — did you want to " +
  '(a) edit the design, (b) build/run something, (c) modify a block, ' +
  '(d) deep-analyze the code, or (e) get an explanation? ' +
  "Tell me which and I'll proceed."

const INTENT_LABEL: Record<Intent, string> = {
  design_edit: 'edit the design',
  build: 'build/run something',
  modify: 'modify a block',
  deep_analyze: 'deep-analyze the code',
  explain: 'get an explanation',
}

export function clarifyMessage(opts: {
  topIntents?: TopIntent[]
  confidence: number
  fallbackReason?: string
}): string {
  const { topIntents, confidence } = opts
  if (
    topIntents &&
    topIntents.length >= 2 &&
    confidence >= 0.3
  ) {
    const [first, second] = topIntents
    const a = INTENT_LABEL[first.intent] ?? first.intent
    const b = INTENT_LABEL[second.intent] ?? second.intent
    return `Did you mean to ${a} or ${b}? Reply with which and I'll proceed.`
  }
  return GENERIC_CLARIFY
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

  if (result.intent === 'design_edit' && result.status === 'ok') {
    const payload = result.payload as { actions: Array<{ action: string; node?: { name?: string; type?: string } }> } | undefined
    const actions = payload?.actions ?? []
    return (
      `Planned ${actions.length} canvas action(s):\n` +
      actions
        .map((a) => '- ' + a.action + (a.action === 'add-node' ? ' (' + (a.node?.name ?? a.node?.type ?? '') + ')' : ''))
        .join('\n')
    )
  }

  if (result.intent === 'explain' && result.status === 'ok') {
    const payload = result.payload as { content: string; anchorRefs: string[] } | undefined
    return payload?.content ?? ''
  }

  if (result.intent === 'build' && result.status === 'ok') {
    const payload = result.payload as { plan: { dispatchUrl: string }; summary: string } | undefined
    return payload?.summary ?? ''
  }

  if (result.intent === 'modify' && result.status === 'ok') {
    const payload = result.payload as
      | { branch?: string; sha?: string; sandboxResult?: { tscOk: boolean; testsOk: boolean } }
      | undefined
    if (!payload) return 'Modify completed.'
    const branch = payload.branch ?? '(unknown branch)'
    const sha = payload.sha ? payload.sha.slice(0, 7) : ''
    const tsc = payload.sandboxResult ? (payload.sandboxResult.tscOk ? 'tsc ok' : 'tsc fail') : 'tsc skipped'
    const tests = payload.sandboxResult
      ? payload.sandboxResult.testsOk
        ? 'tests ok'
        : 'tests fail'
      : 'tests skipped'
    return `Rename committed on ${branch}${sha ? ' (' + sha + ')' : ''}. Sandbox: ${tsc}, ${tests}.`
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
    const topIntents = getTopIntents(
      classifyResult.rawOutput,
      classifyResult.intent,
      classifyResult.confidence,
    )
    return Response.json({
      content: clarifyMessage({ topIntents, confidence: classifyResult.confidence, fallbackReason: classifyResult.fallbackReason }),
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
