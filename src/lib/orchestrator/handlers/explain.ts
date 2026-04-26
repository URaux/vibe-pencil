import { agentRunner } from '@/lib/agent-runner-instance'
import type { AgentBackend } from '@/lib/agent-runner'
import { collectAnchorPaths } from '@/lib/deep-analyze/prompt-builder'
import type { AgentRunnerLike } from '../classify'
import type { Handler, HandlerContext, HandlerResult } from '../types'
import path from 'node:path'

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_BACKEND: AgentBackend = 'codex'
const DEFAULT_MODEL = 'gpt-5-codex-mini'
const POLL_INTERVAL_MS = 25

// Imperative-only: line-leading or sentence-leading verb (after `.`/`!`/`?` plus space).
// Avoids false positives on prose like "the build pipeline runs ..." while still catching
// explicit commands like "rename FooService to BarService".
const FORBIDDEN_VERB_RE = /(?:^|[.!?]\s+)(rename|build|spawn|run|refactor|modify)\s+\w/im

const SYSTEM_PROMPT_BASE =
  'You are an architecture explainer for ArchViber. Given the user question and provided IR summary + anchor file paths, give a plain-text answer in 2-5 sentences. Cite at least one block name or file path from the provided context. Do NOT use tool-action verbs (rename, build, spawn, run, modify, refactor). Output plain prose; no markdown headers, no bullet lists, no code fences.'

const SYSTEM_PROMPT_NO_ANCHORS =
  SYSTEM_PROMPT_BASE +
  ' If no anchor paths are provided, anchor in block names from irSummary.topContainers instead.'

export interface ExplainOptions {
  runner?: AgentRunnerLike
  backend?: AgentBackend
  model?: string
  workDir?: string
  timeoutMs?: number
}

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
    // Best-effort stop only.
  }

  return { type: 'timeout' as const, rawOutput: runner.getStatus(agentId)?.output ?? '' }
}

function findAnchorRefs(text: string, topContainerNames: string[], anchorPaths: string[]): string[] {
  const refs: string[] = []
  const lower = text.toLowerCase()

  for (const name of topContainerNames) {
    if (lower.includes(name.toLowerCase())) {
      refs.push(name)
    }
  }

  for (const p of anchorPaths) {
    const base = path.basename(p)
    if (lower.includes(base.toLowerCase())) {
      refs.push(base)
    }
  }

  return [...new Set(refs)]
}

export function makeExplainHandler(opts: ExplainOptions = {}): Handler {
  return async (ctx: HandlerContext): Promise<HandlerResult> => {
    const runner = opts.runner ?? ctx.runner ?? agentRunner
    const backend = opts.backend ?? DEFAULT_BACKEND
    const model = opts.model ?? DEFAULT_MODEL
    const workDir = opts.workDir ?? ctx.workDir ?? process.cwd()
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const anchorPaths: string[] = ctx.ir ? collectAnchorPaths(ctx.ir) : []
    const hasAnchors = anchorPaths.length > 0
    const systemPrompt = hasAnchors ? SYSTEM_PROMPT_BASE : SYSTEM_PROMPT_NO_ANCHORS

    const agentPrompt = JSON.stringify({
      task: 'explain',
      userPrompt: ctx.userPrompt,
      irSummary: ctx.irSummary,
      anchorPaths,
    })

    const agentId = runner.spawnAgent(
      'orchestrator-explain',
      agentPrompt,
      backend,
      workDir,
      model,
      undefined,
      undefined,
      systemPrompt
    )

    const terminal = await waitForTerminalStatus(runner, agentId, timeoutMs)

    if (terminal.type === 'timeout') {
      return { intent: 'explain', status: 'error', error: `Explain timeout after ${timeoutMs}ms` }
    }

    if (terminal.type === 'missing') {
      return { intent: 'explain', status: 'error', error: terminal.errorMessage }
    }

    if (terminal.type === 'error') {
      return { intent: 'explain', status: 'error', error: `Explain agent error: ${terminal.errorMessage}` }
    }

    const trimmedText = terminal.rawOutput.trim()

    if (!trimmedText) {
      return { intent: 'explain', status: 'error', error: 'Explain produced empty output' }
    }

    if (FORBIDDEN_VERB_RE.test(trimmedText)) {
      return { intent: 'explain', status: 'error', error: 'Explain output contains forbidden tool-action verb' }
    }

    const topContainerNames = ctx.irSummary.topContainers.map((c) => c.name)
    const anchorRefs = findAnchorRefs(trimmedText, topContainerNames, anchorPaths)

    if (anchorRefs.length === 0) {
      return {
        intent: 'explain',
        status: 'error',
        error: 'Explain output lacks grounding: no block name or anchor path referenced',
      }
    }

    return {
      intent: 'explain',
      status: 'ok',
      payload: { content: trimmedText, anchorRefs },
    }
  }
}

export const handleExplain: Handler = makeExplainHandler()
export const explainHandler: Handler = handleExplain
