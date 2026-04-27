import { agentRunner } from '@/lib/agent-runner-instance'
import type { AgentBackend } from '@/lib/agent-runner'
import { tryRepairJson } from '@/lib/canvas-action-types'
import type { AgentRunnerLike } from '../classify'
import type { Handler, HandlerContext, HandlerResult } from '../types'

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_BACKEND: AgentBackend = 'codex'
const DEFAULT_MODEL = 'gpt-5-codex-mini'
const POLL_INTERVAL_MS = 25

const BUILD_SYSTEM_PROMPT =
  'You are a build target classifier for ArchViber. Given a user request and IR summary, output JSON describing which blocks should be built. Output ONLY JSON: {"scope":"all"|"wave"|"blocks"|"none", "waveIndex":number?, "blockIds":string[]?, "reason":string}. If the user does not ask to build anything, scope="none".'

export type BuildScope = 'all' | 'wave' | 'blocks' | 'none'

export interface BuildPlan {
  scope: BuildScope
  waveIndex?: number
  blockIds?: string[]
  reason: string
  dispatchUrl: string
  dispatchBody: Record<string, unknown>
}

export interface BuildOptions {
  runner?: AgentRunnerLike
  backend?: AgentBackend
  model?: string
  workDir?: string
  timeoutMs?: number
}

interface ParsedBuildOutput {
  scope: BuildScope
  waveIndex?: number
  blockIds?: string[]
  reason: string
}

const DISPATCH_URL = '/api/agent/spawn'

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function waitForTerminalStatus(runner: AgentRunnerLike, agentId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    const status = runner.getStatus(agentId)
    if (!status) {
      return { type: 'missing' as const, rawOutput: '', errorMessage: 'Agent status disappeared' }
    }

    if (status.status === 'done') {
      return { type: 'done' as const, rawOutput: status.output }
    }

    if (status.status === 'error') {
      return {
        type: 'error' as const,
        rawOutput: status.output,
        errorMessage: status.errorMessage ?? 'Agent failed',
      }
    }

    await sleep(POLL_INTERVAL_MS)
  }

  try {
    runner.stopAgent?.(agentId)
  } catch {
    // best-effort
  }

  return { type: 'timeout' as const, rawOutput: runner.getStatus(agentId)?.output ?? '' }
}

export function validateParsed(raw: unknown): ParsedBuildOutput {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Build parse failed: expected an object')
  }
  const entry = raw as Record<string, unknown>
  const scope = entry['scope']
  if (scope !== 'all' && scope !== 'wave' && scope !== 'blocks' && scope !== 'none') {
    throw new Error(`Build parse failed: invalid scope "${String(scope)}"`)
  }
  const reason = entry['reason']
  if (typeof reason !== 'string' || !reason) {
    throw new Error('Build parse failed: reason must be a non-empty string')
  }

  const out: ParsedBuildOutput = { scope, reason }

  if (scope === 'wave') {
    const waveIndex = entry['waveIndex']
    if (typeof waveIndex !== 'number' || !Number.isInteger(waveIndex) || waveIndex < 0) {
      throw new Error('Build parse failed: wave scope requires non-negative integer waveIndex')
    }
    out.waveIndex = waveIndex
  }

  if (scope === 'blocks') {
    const blockIds = entry['blockIds']
    if (!Array.isArray(blockIds) || blockIds.length === 0) {
      throw new Error('Build parse failed: blocks scope requires non-empty blockIds array')
    }
    if (!blockIds.every((id): id is string => typeof id === 'string' && id.length > 0)) {
      throw new Error('Build parse failed: blockIds must be strings')
    }
    out.blockIds = blockIds
  }

  return out
}

function knownIds(ctx: HandlerContext): Set<string> {
  const ids = new Set<string>()
  for (const c of ctx.irSummary.topContainers) ids.add(c.id)
  if (ctx.ir) {
    for (const b of ctx.ir.blocks) ids.add(b.id)
    for (const c of ctx.ir.containers) ids.add(c.id)
  }
  return ids
}

function summaryFor(plan: BuildPlan, ctx: HandlerContext): string {
  if (plan.scope === 'all') return `Build all ${ctx.irSummary.blockCount} block(s)`
  if (plan.scope === 'wave') return `Build wave ${plan.waveIndex}`
  if (plan.scope === 'blocks') {
    const ids = plan.blockIds ?? []
    const names = ids.map((id) => {
      const container = ctx.irSummary.topContainers.find((c) => c.id === id)
      if (container) return container.name
      const block = ctx.ir?.blocks.find((b) => b.id === id)
      return block?.name ?? id
    })
    return `Build ${ids.length} block(s): ${names.join(', ')}`
  }
  return plan.reason
}

export function makeBuildHandler(opts: BuildOptions = {}): Handler {
  return async (ctx: HandlerContext): Promise<HandlerResult> => {
    const runner = opts.runner ?? ctx.runner ?? agentRunner
    const backend = opts.backend ?? DEFAULT_BACKEND
    const model = opts.model ?? DEFAULT_MODEL
    const workDir = opts.workDir ?? ctx.workDir ?? process.cwd()
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const agentPrompt = JSON.stringify({
      task: 'classify build target',
      userPrompt: ctx.userPrompt,
      irSummary: ctx.irSummary,
    })

    const agentId = runner.spawnAgent(
      'orchestrator-build',
      agentPrompt,
      backend,
      workDir,
      model,
      undefined,
      undefined,
      BUILD_SYSTEM_PROMPT
    )

    const terminal = await waitForTerminalStatus(runner, agentId, timeoutMs)

    if (terminal.type === 'timeout') {
      return { intent: 'build', status: 'error', error: `Build timeout after ${timeoutMs}ms` }
    }

    if (terminal.type === 'missing') {
      return { intent: 'build', status: 'error', error: terminal.errorMessage }
    }

    if (terminal.type === 'error') {
      return { intent: 'build', status: 'error', error: `Build agent error: ${terminal.errorMessage}` }
    }

    const parsed = tryRepairJson(terminal.rawOutput)
    if (parsed === null) {
      return { intent: 'build', status: 'error', error: 'Build parse failed: could not extract JSON from agent output' }
    }

    let validated: ParsedBuildOutput
    try {
      validated = validateParsed(parsed)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { intent: 'build', status: 'error', error: message }
    }

    if (validated.scope === 'none') {
      return { intent: 'build', status: 'error', error: `not a build request: ${validated.reason}` }
    }

    if (validated.scope === 'all' && ctx.irSummary.blockCount === 0) {
      return { intent: 'build', status: 'error', error: 'Build failed: project has no blocks to build' }
    }

    if (validated.scope === 'wave' && ctx.irSummary.blockCount === 0) {
      return {
        intent: 'build',
        status: 'error',
        error: 'Build failed: project has no waves — add blocks before targeting a wave',
      }
    }

    if (validated.scope === 'blocks' && validated.blockIds) {
      const known = knownIds(ctx)
      const unknown = validated.blockIds.filter((id) => !known.has(id))
      if (unknown.length > 0) {
        return {
          intent: 'build',
          status: 'error',
          error: `unknown block ID(s): ${unknown.join(', ')}`,
        }
      }
    }

    let dispatchBody: Record<string, unknown>
    if (validated.scope === 'all') {
      dispatchBody = { all: true }
    } else if (validated.scope === 'wave') {
      dispatchBody = { wave: validated.waveIndex }
    } else {
      dispatchBody = { blockIds: validated.blockIds }
    }

    const plan: BuildPlan = {
      scope: validated.scope,
      reason: validated.reason,
      dispatchUrl: DISPATCH_URL,
      dispatchBody,
      ...(validated.waveIndex !== undefined ? { waveIndex: validated.waveIndex } : {}),
      ...(validated.blockIds ? { blockIds: validated.blockIds } : {}),
    }

    return { intent: 'build', status: 'ok', payload: { plan, summary: summaryFor(plan, ctx) } }
  }
}

export const handleBuild: Handler = makeBuildHandler()
export const buildHandler: Handler = handleBuild
