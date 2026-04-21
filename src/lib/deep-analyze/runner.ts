import { promises as fs } from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { agentRunner } from '@/lib/agent-runner-instance'
import type { AgentBackend, AgentStatus, CustomApiConfig } from '@/lib/agent-runner'
import type { Ir } from '@/lib/ir/schema'
import { buildAnalystInput, renderAnalystMessage } from './prompt-builder'
import { PERSPECTIVE_NAMES, type PerspectiveName } from './types'

export interface AgentRunnerLike {
  spawnAgent: (
    nodeId: string,
    prompt: string,
    backend: AgentBackend,
    workDir: string,
    model?: string,
    customApiConfig?: CustomApiConfig,
    ccSessionId?: string,
    systemPrompt?: string
  ) => string
  stopAgent: (agentId: string) => void
  on: (event: 'status' | 'output', listener: (payload: unknown) => void) => EventEmitter
  off: (event: 'status' | 'output', listener: (payload: unknown) => void) => EventEmitter
}

export interface RunDeepAnalyzeOptions {
  backend?: 'claude-code' | 'codex'
  model?: string
  workDir: string
  timeoutMs?: number
  runner?: AgentRunnerLike
}

export interface PerspectiveRunResult {
  perspective: PerspectiveName
  status: 'success' | 'error' | 'timeout'
  markdown: string
  errorMessage?: string
  durationMs: number
}

interface StatusEvent {
  agentId: string
  nodeId: string
  status: AgentStatus
  error?: string
  errorMessage?: string
}

interface OutputEvent {
  agentId: string
  nodeId: string
  text: string
}

const DEFAULT_TIMEOUT_MS = 120_000
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/

async function loadSystemPrompts(projectRoot: string): Promise<Map<PerspectiveName, string>> {
  const cache = new Map<PerspectiveName, string>()

  await Promise.all(
    PERSPECTIVE_NAMES.map(async (perspective) => {
      const filePath = path.join(
        projectRoot,
        '.claude',
        'agents',
        `archviber-analyst-${perspective}.md`
      )
      const source = await fs.readFile(filePath, 'utf8')
      cache.set(perspective, source.replace(FRONTMATTER_RE, '').trim())
    })
  )

  return cache
}

function runPerspective(
  perspective: PerspectiveName,
  ir: Ir,
  projectRoot: string,
  opts: Required<Pick<RunDeepAnalyzeOptions, 'backend' | 'timeoutMs'>> &
    Pick<RunDeepAnalyzeOptions, 'model' | 'workDir'> & { runner: AgentRunnerLike; systemPrompt: string }
): Promise<PerspectiveRunResult> {
  const startedAt = Date.now()
  const input = buildAnalystInput(perspective, ir, projectRoot)
  const message = renderAnalystMessage(input)
  const nodeId = `deep-analyze-${perspective}`
  const agentId = opts.runner.spawnAgent(
    nodeId,
    message,
    opts.backend,
    opts.workDir,
    opts.model,
    undefined,
    undefined,
    opts.systemPrompt
  )

  return new Promise<PerspectiveRunResult>((resolve) => {
    const outputChunks: string[] = []
    let settled = false

    const cleanup = () => {
      clearTimeout(timeoutId)
      opts.runner.off('status', onStatus)
      opts.runner.off('output', onOutput)
    }

    const finish = (
      status: PerspectiveRunResult['status'],
      errorMessage?: string
    ) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      resolve({
        perspective,
        status,
        markdown: status === 'success' ? outputChunks.join('').trim() : '',
        errorMessage,
        durationMs: Date.now() - startedAt,
      })
    }

    const onOutput = (event: unknown) => {
      const payload = event as OutputEvent
      if (payload.agentId === agentId) {
        outputChunks.push(payload.text)
      }
    }

    const onStatus = (event: unknown) => {
      const payload = event as StatusEvent
      if (payload.agentId !== agentId) {
        return
      }

      if (payload.status === 'done') {
        finish('success')
        return
      }

      if (payload.status === 'error') {
        finish('error', payload.errorMessage ?? payload.error ?? 'Agent failed')
      }
    }

    const timeoutId = setTimeout(() => {
      try {
        opts.runner.stopAgent(agentId)
      } catch {
        // Best-effort stop; timeout still wins.
      }
      finish('timeout', `Timed out after ${opts.timeoutMs}ms`)
    }, opts.timeoutMs)

    opts.runner.on('status', onStatus)
    opts.runner.on('output', onOutput)
  })
}

export async function runDeepAnalyze(
  ir: Ir,
  projectRoot: string,
  opts: RunDeepAnalyzeOptions
): Promise<PerspectiveRunResult[]> {
  const backend = opts.backend ?? 'claude-code'
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const runner = opts.runner ?? agentRunner
  const promptCache = await loadSystemPrompts(projectRoot)

  return Promise.all(
    PERSPECTIVE_NAMES.map((perspective) =>
      runPerspective(perspective, ir, projectRoot, {
        backend,
        model: opts.model,
        workDir: opts.workDir,
        timeoutMs,
        runner,
        systemPrompt: promptCache.get(perspective) ?? '',
      })
    )
  )
}
