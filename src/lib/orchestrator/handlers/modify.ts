import { agentRunner } from '@/lib/agent-runner-instance'
import type { AgentBackend } from '@/lib/agent-runner'
import { tryRepairJson } from '@/lib/canvas-action-types'
import type { AgentRunnerLike } from '../classify'
import type { Handler, HandlerContext, HandlerResult } from '../types'
import { planRename } from '@/lib/modify/rename'
import { runSandbox } from '@/lib/modify/sandbox'
import { createRenamePr } from '@/lib/modify/pr'

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_BACKEND: AgentBackend = 'codex'
const DEFAULT_MODEL = 'gpt-5-codex-mini'
const POLL_INTERVAL_MS = 25

const EXTRACT_SYSTEM_PROMPT =
  'Extract a rename request from the user\'s message and IR summary. Output ONLY JSON: {"symbol":"OldName","newName":"NewName"}. Both must be valid JavaScript identifiers. If the user is not asking for a rename, output {"error":"not-a-rename"}.'

export interface ModifyOptions {
  runner?: AgentRunnerLike
  backend?: AgentBackend
  model?: string
  workDir?: string
  timeoutMs?: number
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function waitForTerminalStatus(
  runner: AgentRunnerLike,
  agentId: string,
  timeoutMs: number
) {
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
    // Best-effort stop only.
  }

  return { type: 'timeout' as const, rawOutput: runner.getStatus(agentId)?.output ?? '' }
}

export function makeModifyHandler(opts: ModifyOptions = {}): Handler {
  return async (ctx: HandlerContext): Promise<HandlerResult> => {
    const runner = opts.runner ?? ctx.runner ?? agentRunner
    const backend = opts.backend ?? DEFAULT_BACKEND
    const model = opts.model ?? DEFAULT_MODEL
    const workDir = opts.workDir ?? ctx.workDir
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    if (!workDir) {
      return { intent: 'modify', status: 'error', error: 'modify requires a project workDir' }
    }

    const agentPrompt = JSON.stringify({
      task: 'extract rename',
      userPrompt: ctx.userPrompt,
      irSummary: ctx.irSummary,
    })

    const agentId = runner.spawnAgent(
      'orchestrator-modify',
      agentPrompt,
      backend,
      workDir,
      model,
      undefined,
      undefined,
      EXTRACT_SYSTEM_PROMPT
    )

    const terminal = await waitForTerminalStatus(runner, agentId, timeoutMs)

    if (terminal.type === 'timeout') {
      return { intent: 'modify', status: 'error', error: `Modify timeout after ${timeoutMs}ms` }
    }

    if (terminal.type === 'missing') {
      return { intent: 'modify', status: 'error', error: terminal.errorMessage }
    }

    if (terminal.type === 'error') {
      return { intent: 'modify', status: 'error', error: `Modify agent error: ${terminal.errorMessage}` }
    }

    const parsed = tryRepairJson(terminal.rawOutput)
    if (parsed === null || typeof parsed !== 'object') {
      return {
        intent: 'modify',
        status: 'error',
        error: 'Modify parse failed: could not extract JSON from agent output',
      }
    }

    const extraction = parsed as Record<string, unknown>

    if (extraction['error'] === 'not-a-rename') {
      return {
        intent: 'modify',
        status: 'error',
        error: 'not a rename request — try: rename X to Y',
      }
    }

    const symbol = extraction['symbol']
    const newName = extraction['newName']

    if (typeof symbol !== 'string' || !symbol || typeof newName !== 'string' || !newName) {
      return {
        intent: 'modify',
        status: 'error',
        error: 'Modify parse failed: extraction JSON missing symbol or newName',
      }
    }

    let plan
    try {
      plan = await planRename(workDir, symbol, newName)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { intent: 'modify', status: 'error', error: `planRename failed: ${message}` }
    }

    if (plan.conflicts.length > 0) {
      return {
        intent: 'modify',
        status: 'error',
        error: `rename blocked: ${plan.conflicts[0].message}`,
        payload: { plan, blocked: true },
      }
    }

    let sandboxResult
    try {
      sandboxResult = await runSandbox(workDir, plan)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { intent: 'modify', status: 'error', error: `sandbox failed: ${message}` }
    }

    if (!sandboxResult.tscOk) {
      return {
        intent: 'modify',
        status: 'error',
        error: `rename breaks tsc: ${sandboxResult.errors[0] ?? 'unknown error'}`,
        payload: { plan, sandboxResult },
      }
    }

    let prResult
    try {
      prResult = await createRenamePr(workDir, plan, { symbol, newName })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { intent: 'modify', status: 'error', error: `createRenamePr failed: ${message}` }
    }

    return {
      intent: 'modify',
      status: 'ok',
      payload: {
        plan,
        sandboxResult,
        branch: prResult.branch,
        sha: prResult.sha,
      },
    }
  }
}

export const handleModify: Handler = makeModifyHandler()
