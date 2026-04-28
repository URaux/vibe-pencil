import { agentRunner } from '@/lib/agent-runner-instance'
import type { AgentBackend } from '@/lib/agent-runner'
import { tryRepairJson } from '@/lib/canvas-action-types'
import type { AgentRunnerLike } from '../classify'
import type { Handler, HandlerContext, HandlerResult } from '../types'
import { planRename } from '@/lib/modify/rename'
import { planExtract } from '@/lib/modify/extract'
import { planReplaceInFile } from '@/lib/modify/replace-in-file'
import { planAddExport } from '@/lib/modify/add-export'
import { runSandbox } from '@/lib/modify/sandbox'
import { createRenamePr } from '@/lib/modify/pr'

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_BACKEND: AgentBackend = 'codex'
const DEFAULT_MODEL = 'gpt-5-codex-mini'
const POLL_INTERVAL_MS = 25

// W3.D6 + v0.4: detects rename, extract, replace, and add-export verbs.
const EXTRACT_SYSTEM_PROMPT =
  'Classify the user\'s modify request as one of: rename, extract, replace, or add-export. Output ONLY JSON. ' +
  'For rename: {"verb":"rename","symbol":"OldName","newName":"NewName"} (both valid JS identifiers). ' +
  'For extract method: {"verb":"extract","filePath":"src/foo.ts","startLine":12,"endLine":20,"newFunctionName":"helperName"}. ' +
  'For replace in file: {"verb":"replace","filePath":"src/foo.ts","pattern":"oldText","replacement":"newText","flags":"g"}. ' +
  'For add export: {"verb":"add-export","filePath":"src/foo.ts","symbolName":"MyFunction","kind":"function"}. ' +
  'The kind field is optional (function|class|const|interface|type|enum); omit to auto-detect. ' +
  'If none apply: {"error":"not-a-modify-verb"}.'

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

    if (extraction['error'] === 'not-a-rename' || extraction['error'] === 'not-a-modify-verb') {
      return {
        intent: 'modify',
        status: 'error',
        error: 'not a modify request — try: rename X to Y, or extract lines N-M as fooHelper',
      }
    }

    const verb = extraction['verb'] ?? 'rename' // backward-compat: missing verb means rename
    const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

    let plan
    let prSubject: { symbol: string; newName: string }

    if (verb === 'extract') {
      const filePath = extraction['filePath']
      const startLine = extraction['startLine']
      const endLine = extraction['endLine']
      const newFunctionName = extraction['newFunctionName']
      if (
        typeof filePath !== 'string' ||
        !filePath ||
        typeof startLine !== 'number' ||
        typeof endLine !== 'number' ||
        typeof newFunctionName !== 'string' ||
        !newFunctionName
      ) {
        return {
          intent: 'modify',
          status: 'error',
          error: 'Modify parse failed: extract requires filePath/startLine/endLine/newFunctionName',
        }
      }
      if (!IDENTIFIER_RE.test(newFunctionName)) {
        return {
          intent: 'modify',
          status: 'error',
          error: `invalid identifier: newFunctionName "${newFunctionName}"`,
        }
      }
      try {
        plan = await planExtract(workDir, { filePath, startLine, endLine, newFunctionName })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { intent: 'modify', status: 'error', error: `planExtract failed: ${message}` }
      }
      prSubject = { symbol: 'extract', newName: newFunctionName }
    } else if (verb === 'rename') {
      const symbol = extraction['symbol']
      const newName = extraction['newName']

      if (typeof symbol !== 'string' || !symbol || typeof newName !== 'string' || !newName) {
        return {
          intent: 'modify',
          status: 'error',
          error: 'Modify parse failed: extraction JSON missing symbol or newName',
        }
      }
      if (!IDENTIFIER_RE.test(symbol) || !IDENTIFIER_RE.test(newName)) {
        return {
          intent: 'modify',
          status: 'error',
          error: `invalid identifier: symbol "${symbol}" / newName "${newName}" must match /^[A-Za-z_$][A-Za-z0-9_$]*$/`,
        }
      }
      try {
        plan = await planRename(workDir, symbol, newName)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { intent: 'modify', status: 'error', error: `planRename failed: ${message}` }
      }
      prSubject = { symbol, newName }
    } else if (verb === 'replace') {
      const filePath = extraction['filePath']
      const pattern = extraction['pattern']
      const replacement = extraction['replacement']
      const flags = extraction['flags']

      if (
        typeof filePath !== 'string' ||
        !filePath ||
        typeof pattern !== 'string' ||
        !pattern ||
        typeof replacement !== 'string'
      ) {
        return {
          intent: 'modify',
          status: 'error',
          error: 'Modify parse failed: replace requires filePath/pattern/replacement',
        }
      }
      try {
        plan = await planReplaceInFile(workDir, {
          filePath,
          pattern,
          replacement,
          flags: typeof flags === 'string' ? flags : undefined,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { intent: 'modify', status: 'error', error: `planReplaceInFile failed: ${message}` }
      }
      prSubject = { symbol: pattern, newName: replacement }
    } else {
      return {
        intent: 'modify',
        status: 'error',
        error: `Modify parse failed: unknown verb "${String(verb)}"`,
      }
    }

    if (plan.conflicts.length > 0) {
      return {
        intent: 'modify',
        status: 'error',
        error: `${verb} blocked: ${plan.conflicts[0].message}`,
        payload: { plan, blocked: true, verb },
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
        error: `${verb} breaks tsc: ${sandboxResult.errors[0] ?? 'unknown error'}`,
        payload: { plan, sandboxResult, verb },
      }
    }

    let prResult
    try {
      prResult = await createRenamePr(workDir, plan, prSubject)
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
        verb,
      },
    }
  }
}

export const handleModify: Handler = makeModifyHandler()
