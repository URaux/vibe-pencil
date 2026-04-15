import { promises as fs } from 'fs'
import path from 'path'
import { z } from 'zod'

/**
 * Persistent per-session brainstorm state.
 *
 * Stored at `<projectRoot>/.archviber/brainstorm-state/<sessionId>.json`.
 *
 * Lifecycle:
 *   - Created on first chat turn that carries a sessionId.
 *   - Updated server-side after each assistant response by parsing HTML-comment
 *     control tags out of the streamed text (see `src/app/api/chat/route.ts`).
 *   - Injected back into subsequent prompts via `formatStateForPrompt` so the
 *     LLM has a stable memory anchor across long novice conversations.
 *
 * The eventLog grows up to 20 entries before being compacted into a fresh
 * snapshot of `externalDeps` (last-write-wins keyed by `service+envVar`).
 */

const BRAINSTORM_STATE_DIR = 'brainstorm-state'

const EVENT_LOG_COMPACT_THRESHOLD = 20

const externalDepStatusSchema = z.enum(['needed', 'provided', 'skipped', 'unknown'])

const externalDepSchema = z
  .object({
    service: z.string(),
    type: z.string(),
    status: externalDepStatusSchema,
    envVar: z.string().optional(),
    group: z.string().optional(),
    docsUrl: z.string().optional(),
    notes: z.string().optional(),
  })
  .strict()

/**
 * An event in the externalDeps stream. Events are append-only until compacted.
 *
 * `op` describes the intent:
 *   - `add` / `update`: upsert a dep keyed by `service + envVar`
 *   - `remove`: drop matching dep from the snapshot
 */
const externalDepsEventSchema = z
  .object({
    op: z.enum(['add', 'update', 'remove']),
    service: z.string(),
    envVar: z.string().optional(),
    type: z.string().optional(),
    status: externalDepStatusSchema.optional(),
    group: z.string().optional(),
    docsUrl: z.string().optional(),
    notes: z.string().optional(),
    ts: z.string().optional(),
  })
  .strict()

const decisionsSchema = z
  .object({
    domain: z.string().optional(),
    scale: z.string().optional(),
    features: z.array(z.string()).optional(),
    tech_preferences: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown())

export const brainstormStateSchema = z
  .object({
    sessionId: z.string().min(1),
    startedAt: z.string(),
    lastUpdatedAt: z.string(),
    mode: z.enum(['novice', 'expert']),
    currentBatch: z.enum(['what', 'how', 'deps', 'converging', 'done']),
    decisions: decisionsSchema,
    externalDeps: z.array(externalDepSchema),
    externalDepsEventLog: z.array(externalDepsEventSchema),
    roundCount: z.number().int().nonnegative(),
    offTopicRounds: z.number().int().nonnegative(),
  })
  .strict()

export type ExternalDep = z.infer<typeof externalDepSchema>
export type ExternalDepsEvent = z.infer<typeof externalDepsEventSchema>
export type BrainstormDecisions = z.infer<typeof decisionsSchema>
export type BrainstormState = z.infer<typeof brainstormStateSchema>

/* ------------------------------------------------------------------ paths --- */

function stateDirPath(projectRoot: string): string {
  return path.join(projectRoot, '.archviber', BRAINSTORM_STATE_DIR)
}

/**
 * Prevent path traversal: only allow safe sessionId chars (uuid-ish + -_.).
 */
function sanitizeSessionId(sessionId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(sessionId)) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }
  return sessionId
}

export function brainstormStateFilePath(projectRoot: string, sessionId: string): string {
  return path.join(stateDirPath(projectRoot), `${sanitizeSessionId(sessionId)}.json`)
}

/* ----------------------------------------------------------------- factory --- */

export function createInitialBrainstormState(sessionId: string, now = new Date()): BrainstormState {
  const ts = now.toISOString()
  return {
    sessionId,
    startedAt: ts,
    lastUpdatedAt: ts,
    mode: 'novice',
    currentBatch: 'what',
    decisions: {},
    externalDeps: [],
    externalDepsEventLog: [],
    roundCount: 0,
    offTopicRounds: 0,
  }
}

/* --------------------------------------------------------------------- I/O --- */

/**
 * Read brainstorm state for a given sessionId. Returns `null` when the file
 * does not exist (legacy / first turn). Throws on malformed JSON or schema
 * violations so callers can surface the error.
 */
export async function readBrainstormState(
  projectRoot: string,
  sessionId: string,
): Promise<BrainstormState | null> {
  const filePath = brainstormStateFilePath(projectRoot, sessionId)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const parsed = JSON.parse(raw) as unknown
  return brainstormStateSchema.parse(parsed)
}

/**
 * Atomically write brainstorm state. Mirrors `writeIrFile` semantics:
 * validate-then-write to a `.tmp` sibling, then rename. Stamps `lastUpdatedAt`.
 */
export async function writeBrainstormState(
  projectRoot: string,
  state: BrainstormState,
): Promise<string> {
  const stamped: BrainstormState = { ...state, lastUpdatedAt: new Date().toISOString() }
  const validated = brainstormStateSchema.parse(stamped)

  const filePath = brainstormStateFilePath(projectRoot, validated.sessionId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  const tmpPath = `${filePath}.tmp`
  const json = `${JSON.stringify(validated, null, 2)}\n`
  try {
    await fs.writeFile(tmpPath, json, 'utf8')
    await fs.rename(tmpPath, filePath)
  } catch (error) {
    try {
      await fs.unlink(tmpPath)
    } catch {
      /* swallow */
    }
    throw error
  }
  return filePath
}

/* ---------------------------------------------------------- event handling --- */

/**
 * Reduce a sequence of externalDeps events into a snapshot. Last-write-wins,
 * keyed by `service + envVar` (envVar can be empty for non-env-var deps).
 */
function reduceEventsToSnapshot(
  baseSnapshot: ExternalDep[],
  events: ExternalDepsEvent[],
): ExternalDep[] {
  const key = (service: string, envVar?: string) => `${service}::${envVar ?? ''}`
  const map = new Map<string, ExternalDep>()
  for (const dep of baseSnapshot) {
    map.set(key(dep.service, dep.envVar), dep)
  }
  for (const ev of events) {
    const k = key(ev.service, ev.envVar)
    if (ev.op === 'remove') {
      map.delete(k)
      continue
    }
    const existing = map.get(k)
    const merged: ExternalDep = {
      service: ev.service,
      type: ev.type ?? existing?.type ?? 'unknown',
      status: ev.status ?? existing?.status ?? 'needed',
      envVar: ev.envVar ?? existing?.envVar,
      group: ev.group ?? existing?.group,
      docsUrl: ev.docsUrl ?? existing?.docsUrl,
      notes: ev.notes ?? existing?.notes,
    }
    map.set(k, merged)
  }
  return Array.from(map.values())
}

/**
 * Append new externalDeps events to the log. When the log reaches the
 * compaction threshold, fold all events into `externalDeps` and clear the log.
 *
 * Returns a new state object — does not mutate input.
 */
export function applyExternalDepsEvents(
  state: BrainstormState,
  newEvents: ExternalDepsEvent[],
): BrainstormState {
  if (newEvents.length === 0) return state

  const stamped = newEvents.map((ev) => (ev.ts ? ev : { ...ev, ts: new Date().toISOString() }))
  const combinedLog = [...state.externalDepsEventLog, ...stamped]

  if (combinedLog.length >= EVENT_LOG_COMPACT_THRESHOLD) {
    const newSnapshot = reduceEventsToSnapshot(state.externalDeps, combinedLog)
    return {
      ...state,
      externalDeps: newSnapshot,
      externalDepsEventLog: [],
    }
  }

  // Below threshold: keep raw log AND keep snapshot in sync so reads of
  // `externalDeps` always reflect current truth without replaying the log.
  const newSnapshot = reduceEventsToSnapshot(state.externalDeps, stamped)
  return {
    ...state,
    externalDeps: newSnapshot,
    externalDepsEventLog: combinedLog,
  }
}

/* ----------------------------------------------------- prompt formatting --- */

const BATCH_LABELS: Record<BrainstormState['currentBatch'], string> = {
  what: 'WHAT 层',
  how: 'HOW 层',
  deps: 'DEPS 层',
  converging: '收敛中',
  done: '已完成',
}

function formatDecisions(decisions: BrainstormDecisions): string {
  const parts: string[] = []
  if (decisions.domain) parts.push(`领域=${decisions.domain}`)
  if (decisions.scale) parts.push(`规模=${decisions.scale}`)
  if (decisions.features && decisions.features.length > 0) {
    parts.push(`功能=[${decisions.features.join(', ')}]`)
  }
  if (decisions.tech_preferences && Object.keys(decisions.tech_preferences).length > 0) {
    const pairs = Object.entries(decisions.tech_preferences)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ')
    parts.push(`技术偏好={${pairs}}`)
  }
  return parts.length > 0 ? parts.join(', ') : '（暂无）'
}

function formatExternalDeps(deps: ExternalDep[]): string {
  if (deps.length === 0) return '（暂无）'
  return deps
    .map((d) => {
      const typeBits = [d.type]
      if (d.group) typeBits.push(`group ${d.group}`)
      const statusZh =
        d.status === 'provided'
          ? '已提供'
          : d.status === 'skipped'
            ? '已跳过'
            : d.status === 'unknown'
              ? '未知'
              : '未提供'
      return `${d.service} (${typeBits.join(', ')}, ${statusZh})`
    })
    .join(', ')
}

/**
 * Build a short prompt prefix so the LLM has a deterministic memory anchor
 * across long brainstorm sessions. Returns `''` when the state is fresh and
 * carries no useful signal (avoid wasting tokens on first-turn boilerplate).
 */
export function formatStateForPrompt(state: BrainstormState): string {
  const hasContent =
    state.roundCount > 0 ||
    state.externalDeps.length > 0 ||
    Object.keys(state.decisions).length > 0
  if (!hasContent) return ''

  const lines = [
    '## 本次 brainstorm 已知状态',
    `- 模式: ${state.mode}`,
    `- 当前批次: ${BATCH_LABELS[state.currentBatch]}（第 ${state.roundCount} 轮）`,
    `- 已决策: ${formatDecisions(state.decisions)}`,
    `- 外部依赖: ${formatExternalDeps(state.externalDeps)}`,
    `- 离题轮次: ${state.offTopicRounds}`,
    '继续主线，回到当前批次。',
  ]
  return lines.join('\n')
}

/* ----------------------------------------------- concurrency serialization --- */

/**
 * Per-sessionId mutex. Concurrent chat requests for the same sessionId are a
 * realistic failure mode (user double-clicks send, retries after a hang, or
 * opens two tabs). Without serialization, each request does its own
 * read → apply → write and the last writer silently overwrites the first,
 * losing an entire turn's externalDeps events / decisions patch.
 *
 * We key on `${projectRoot}::${sessionId}` (already sanitized by path helper)
 * and chain updates onto a promise so only one read-modify-write is in flight
 * at a time per session. Entries are cleaned up once the tail settles.
 */
const sessionUpdateLocks = new Map<string, Promise<void>>()

function lockKey(projectRoot: string, sessionId: string): string {
  return `${projectRoot}::${sanitizeSessionId(sessionId)}`
}

/**
 * Serialized read-modify-write for a single sessionId. The updater receives
 * the current state (or `null` if no file exists yet) and must return the
 * next state to persist, or `null` to skip writing. Guarantees at most one
 * in-flight update per (projectRoot, sessionId).
 */
export async function updateBrainstormState(
  projectRoot: string,
  sessionId: string,
  updater: (current: BrainstormState | null) => BrainstormState | null | Promise<BrainstormState | null>,
): Promise<BrainstormState | null> {
  const key = lockKey(projectRoot, sessionId)
  const prev = sessionUpdateLocks.get(key) ?? Promise.resolve()

  let result: BrainstormState | null = null
  const next = prev
    .catch(() => undefined) // never let a prior failure poison the chain
    .then(async () => {
      const current = await readBrainstormState(projectRoot, sessionId)
      const proposed = await updater(current)
      if (proposed === null) return
      await writeBrainstormState(projectRoot, proposed)
      result = proposed
    })

  sessionUpdateLocks.set(key, next)
  try {
    await next
    return result
  } finally {
    // Only clear the slot if we're still the tail; a newer caller may have
    // chained onto `next` and replaced the entry already.
    if (sessionUpdateLocks.get(key) === next) {
      sessionUpdateLocks.delete(key)
    }
  }
}

/* ---------------------------------------------- assistant-output parsing --- */

/**
 * Result of parsing a streamed assistant response for control comments.
 * All fields optional — caller merges only what was emitted this turn.
 */
export interface ParsedAssistantControl {
  progress?: {
    batch?: BrainstormState['currentBatch']
    round?: number
    mode?: BrainstormState['mode']
  }
  externalDepsEvents: ExternalDepsEvent[]
  decisionsPatch?: BrainstormDecisions
}

const PROGRESS_RE = /<!--\s*progress:\s*([^>]*?)-->/gi
// NOTE: capture non-greedily up to the comment close `-->` (not the first
// matching bracket). Prior versions used `(\[...?\])` / `(\{...?\})` which
// truncated payloads containing nested objects or a `]`/`}` inside a string
// (e.g. `tech_preferences:{db:"postgres"}` or `notes:"see [docs]"`), causing
// silent data loss of control state. We now grab the whole comment body and
// let JSON.parse validate structure.
const EXTERNAL_DEPS_RE = /<!--\s*externalDeps:\s*([\s\S]*?)\s*-->/gi
const DECISIONS_RE = /<!--\s*decisions:\s*([\s\S]*?)\s*-->/gi

function parseProgressBody(body: string): ParsedAssistantControl['progress'] {
  // Tokens look like `batch=how round=3 mode=novice`. Tolerate quotes.
  const out: ParsedAssistantControl['progress'] = {}
  for (const match of body.matchAll(/(\w+)\s*=\s*"?([\w]+)"?/g)) {
    const key = match[1]
    const value = match[2]
    if (key === 'batch' && ['what', 'how', 'deps', 'converging', 'done'].includes(value)) {
      out.batch = value as BrainstormState['currentBatch']
    } else if (key === 'round') {
      const n = Number.parseInt(value, 10)
      if (Number.isFinite(n) && n >= 0) out.round = n
    } else if (key === 'mode' && (value === 'novice' || value === 'expert')) {
      out.mode = value
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function safeJsonParse<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * Pull control comments out of the assistant's streamed text. Tolerates
 * malformed payloads (skips them) so a bad emission can't crash the chat.
 */
export function parseAssistantControlComments(text: string): ParsedAssistantControl {
  const result: ParsedAssistantControl = { externalDepsEvents: [] }

  let lastProgress: ParsedAssistantControl['progress']
  for (const m of text.matchAll(PROGRESS_RE)) {
    const parsed = parseProgressBody(m[1] ?? '')
    if (parsed) lastProgress = { ...lastProgress, ...parsed }
  }
  if (lastProgress) result.progress = lastProgress

  for (const m of text.matchAll(EXTERNAL_DEPS_RE)) {
    const arr = safeJsonParse<unknown>(m[1] ?? '[]')
    if (!Array.isArray(arr)) continue
    for (const candidate of arr) {
      const parsed = externalDepsEventSchema.safeParse(candidate)
      if (parsed.success) result.externalDepsEvents.push(parsed.data)
    }
  }

  let mergedDecisions: BrainstormDecisions | undefined
  for (const m of text.matchAll(DECISIONS_RE)) {
    const obj = safeJsonParse<Record<string, unknown>>(m[1] ?? '{}')
    if (!obj || typeof obj !== 'object') continue
    const parsed = decisionsSchema.safeParse(obj)
    if (parsed.success) {
      mergedDecisions = { ...(mergedDecisions ?? {}), ...parsed.data }
    }
  }
  if (mergedDecisions) result.decisionsPatch = mergedDecisions

  return result
}

/**
 * Apply a parsed control payload to a state object. Pure; returns new state.
 */
export function applyAssistantControl(
  state: BrainstormState,
  control: ParsedAssistantControl,
): BrainstormState {
  let next: BrainstormState = state

  if (control.progress) {
    next = {
      ...next,
      currentBatch: control.progress.batch ?? next.currentBatch,
      roundCount: Math.max(next.roundCount, control.progress.round ?? 0),
      mode: control.progress.mode ?? next.mode,
    }
  }

  if (control.decisionsPatch) {
    // Shallow-merge top level, but DEEP-merge `tech_preferences` so
    // incremental turns (turn 1: {auth: "clerk"}, turn 2: {db: "postgres"})
    // accumulate instead of clobbering. Other fields (domain/scale/features)
    // are intentionally last-write-wins — the LLM re-emits them whole.
    const prevTech = next.decisions.tech_preferences
    const patchTech = control.decisionsPatch.tech_preferences
    const mergedTech =
      prevTech || patchTech
        ? { ...(prevTech ?? {}), ...(patchTech ?? {}) }
        : undefined
    next = {
      ...next,
      decisions: {
        ...next.decisions,
        ...control.decisionsPatch,
        ...(mergedTech ? { tech_preferences: mergedTech } : {}),
      },
    }
  }

  if (control.externalDepsEvents.length > 0) {
    next = applyExternalDepsEvents(next, control.externalDepsEvents)
  }

  return next
}
