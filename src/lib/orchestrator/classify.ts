import { agentRunner } from '@/lib/agent-runner-instance'
import type { AgentBackend, AgentStatus, CustomApiConfig } from '@/lib/agent-runner'
import type { IrSummary, ClassifyResult, Intent } from './types'
import { INTENTS } from './types'
import { cacheGet, cacheSet, makeCacheKey } from './cache'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_CONFIDENCE_THRESHOLD = 0.6
const DEFAULT_BACKEND: AgentBackend = 'codex'
const DEFAULT_MODEL = 'gpt-5-codex-mini'
const POLL_INTERVAL_MS = 25

const CLASSIFIER_SYSTEM_PROMPT = [
  'You are an intent classifier for ArchViber.',
  'Choose exactly one intent from: design_edit, build, modify, deep_analyze, explain.',
  'Return ONLY minified JSON with keys intent, confidence, rationale.',
  'confidence must be a number from 0 to 1.',
  'rationale must be 15 words or fewer.',
  'No markdown, no code fences, no extra text.',
].join(' ')

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
  getStatus: (agentId: string) => {
    agentId: string
    nodeId: string
    prompt: string
    backend: AgentBackend
    workDir: string
    status: AgentStatus
    output: string
    errorMessage?: string
    exitCode?: number | null
  } | null
  stopAgent?: (agentId: string) => void
}

export interface ClassifyOptions {
  runner?: AgentRunnerLike
  backend?: AgentBackend
  model?: string
  workDir?: string
  timeoutMs?: number
  confidenceThreshold?: number
}

interface ParsedClassifierOutput {
  intent: Intent
  confidence: number
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildUserPrompt(userPrompt: string, summary: IrSummary) {
  return JSON.stringify({
    task: 'Classify the user request into one ArchViber intent.',
    userPrompt,
    irSummary: summary,
    allowedIntents: INTENTS,
    outputFormat: {
      intent: 'one allowed intent',
      confidence: 'number 0..1',
      rationale: '<=15 words',
    },
  })
}

function extractFirstJsonObject(rawOutput: string): string | null {
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < rawOutput.length; i += 1) {
    const char = rawOutput[i]

    if (start === -1) {
      if (char === '{') {
        start = i
        depth = 1
      }
      continue
    }

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return rawOutput.slice(start, i + 1)
      }
    }
  }

  return null
}

function validateParsedOutput(value: unknown): ParsedClassifierOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('Classifier output was not an object')
  }

  const parsed = value as { intent?: unknown; confidence?: unknown }

  if (!INTENTS.includes(parsed.intent as Intent)) {
    throw new Error(`Invalid intent: ${String(parsed.intent)}`)
  }

  if (typeof parsed.confidence !== 'number' || Number.isNaN(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1) {
    throw new Error(`Invalid confidence: ${String(parsed.confidence)}`)
  }

  return {
    intent: parsed.intent as Intent,
    confidence: parsed.confidence,
  }
}

function fallbackResult(rawOutput: string, fallbackReason: string): ClassifyResult {
  return {
    intent: 'explain',
    confidence: 0,
    rawOutput,
    fallback: true,
    fallbackReason,
  }
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

export async function classifyIntent(
  userPrompt: string,
  summary: IrSummary,
  opts: ClassifyOptions = {}
): Promise<ClassifyResult> {
  const runner = opts.runner ?? agentRunner
  const backend = opts.backend ?? DEFAULT_BACKEND
  const model = opts.model ?? DEFAULT_MODEL
  const workDir = opts.workDir ?? process.cwd()
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const confidenceThreshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD

  const cacheKey = makeCacheKey(userPrompt, summary.blockCount, summary.containerCount)
  const cached = cacheGet(cacheKey)
  if (cached) return cached

  const agentId = runner.spawnAgent(
    'orchestrator-classifier',
    buildUserPrompt(userPrompt, summary),
    backend,
    workDir,
    model,
    undefined,
    undefined,
    CLASSIFIER_SYSTEM_PROMPT
  )

  const terminal = await waitForTerminalStatus(runner, agentId, timeoutMs)

  if (terminal.type === 'timeout') {
    return fallbackResult(terminal.rawOutput, `Classifier timeout after ${timeoutMs}ms`)
  }

  if (terminal.type === 'missing') {
    return fallbackResult(terminal.rawOutput, terminal.errorMessage)
  }

  if (terminal.type === 'error') {
    return fallbackResult(terminal.rawOutput, `Classifier error: ${terminal.errorMessage}`)
  }

  try {
    const jsonBlock = extractFirstJsonObject(terminal.rawOutput)
    if (!jsonBlock) {
      throw new Error('No JSON object found in classifier output')
    }

    const parsed = validateParsedOutput(JSON.parse(jsonBlock))
    if (parsed.confidence < confidenceThreshold) {
      return {
        intent: 'explain',
        confidence: parsed.confidence,
        rawOutput: terminal.rawOutput,
        fallback: true,
        fallbackReason: `Low confidence for attempted intent ${parsed.intent}`,
      }
    }

    const result: ClassifyResult = {
      intent: parsed.intent,
      confidence: parsed.confidence,
      rawOutput: terminal.rawOutput,
      fallback: false,
    }
    cacheSet(cacheKey, result)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fallbackResult(terminal.rawOutput, message)
  }
}
