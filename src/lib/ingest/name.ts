/**
 * LLM naming pass — W2.D5.
 *
 * Takes a ClusterResult + CodeAnchorResult and produces a stable
 * `clusterId → ClusterName` mapping. Each cluster goes through the LLM with a
 * terse prompt, falling back to deterministic heuristics on timeout / error /
 * invalid response / offline mode.
 *
 * Consumes `streamChat` from `@/lib/llm-client` (no new HTTP client). Bounded
 * concurrency via a hand-rolled promise pool. Caller-supplied AbortSignal
 * cancels all in-flight calls.
 *
 * Scope: no IR-block construction, no disk I/O. Purely cluster + anchors → names.
 */

import type { ClusterResult, FactCluster } from './cluster'
import type { CodeAnchorResult } from './code-anchors'
import type { LlmConfig } from '@/lib/llm-client'
import { streamChat } from '@/lib/llm-client'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type NameSource = 'llm' | 'fallback-prefix' | 'fallback-sequential'

export interface ClusterName {
  clusterId: string
  /** Short human-readable name. 2-4 words, PascalCase or "Xxx Yyy" friendly. */
  name: string
  /** One-line description. Optional — LLM may return none; fallback paths omit. */
  description?: string
  /**
   * Self-reported confidence in [0, 1].
   * - `llm`: what the model returned, else 0.5.
   * - `fallback-prefix`: 0.6.
   * - `fallback-sequential`: 0.2.
   */
  confidence: number
  source: NameSource
}

export interface NameDiagnostics {
  llmCalls: number
  llmSuccesses: number
  llmTimeouts: number
  llmErrors: number
  fallbackPrefix: number
  fallbackSequential: number
  /** Total wall-clock duration in ms. */
  wallMs: number
}

export interface NameResult {
  names: Map<string, ClusterName>
  diagnostics: NameDiagnostics
}

export interface NameClustersOptions {
  /** Per-call timeout in ms. Default 15_000. */
  timeoutMs?: number
  /** Max concurrent LLM calls. Default 4. */
  concurrency?: number
  /** Skip the LLM entirely and rely on fallbacks. Default false. */
  offline?: boolean
  /**
   * Optional caller signal — when aborted, all pending calls cancel and
   * remaining clusters are named via fallback.
   */
  signal?: AbortSignal
  /** Optional project name used in the LLM prompt. Default 'archviber'. */
  projectName?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_CONCURRENCY = 4
const DEFAULT_PROJECT_NAME = 'archviber'

const MAX_FILES_IN_PROMPT = 10
const MAX_SYMBOLS_PER_FILE_IN_PROMPT = 5
const MAX_SYMBOL_NAME_LEN = 60

const MAX_NAME_LEN = 60
const MAX_DESCRIPTION_LEN = 200

const SYSTEM_PROMPT =
  'You name software architecture clusters. Given a list of files + exported symbols, respond with a JSON object {"name": "...", "description": "...", "confidence": 0.xx}. Name must be 2-4 words, descriptive of the cluster\'s role. Description must be one sentence. When the cluster spans multiple languages (e.g. Python + Go), the name should describe the responsibility regardless of language — avoid language-specific terms.'

// W2.D4: language detection from file extension for cross-language cluster naming.
// Mirrors the LanguageAdapter id values; not coupled to the registry to keep this
// module independent of registration order.
const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.scala': 'scala',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
}

export function inferLanguageFromPath(filePath: string): string | null {
  const ext = filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')).toLowerCase() : ''
  return LANG_BY_EXT[ext] ?? null
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

interface PromptCluster {
  cluster: FactCluster
  filesWithSymbols: Array<{ path: string; symbols: string[] }>
  /** W2.D4: distinct languages present in the cluster, sorted for stability. */
  languages: string[]
}

function buildPromptClusters(
  clusters: ClusterResult,
  anchors: CodeAnchorResult,
): PromptCluster[] {
  const anchorByClusterId = new Map<string, CodeAnchorResult['entries'][number]['anchor']>()
  for (const e of anchors.entries) anchorByClusterId.set(e.clusterId, e.anchor)

  return clusters.clusters.map((cluster) => {
    const anchor = anchorByClusterId.get(cluster.id)
    const files = anchor?.files ?? []
    const capped = files.slice(0, MAX_FILES_IN_PROMPT).map((f) => {
      const symbols = f.symbols
        .slice(0, MAX_SYMBOLS_PER_FILE_IN_PROMPT)
        .map((s) => (s.length > MAX_SYMBOL_NAME_LEN ? s.slice(0, MAX_SYMBOL_NAME_LEN) : s))
      return { path: f.path, symbols }
    })
    // Collect distinct languages from ALL files in the cluster (not just capped),
    // so a 100-file cluster's language mix isn't truncated by MAX_FILES_IN_PROMPT.
    const langSet = new Set<string>()
    for (const f of files) {
      const lang = inferLanguageFromPath(f.path)
      if (lang) langSet.add(lang)
    }
    const languages = Array.from(langSet).sort()
    return { cluster, filesWithSymbols: capped, languages }
  })
}

function renderUserPrompt(projectName: string, pc: PromptCluster): string {
  const lines: string[] = []
  lines.push(`Project: ${projectName}`)
  if (pc.cluster.pathPrefix) {
    lines.push(`Cluster pathPrefix: ${pc.cluster.pathPrefix}`)
  } else {
    lines.push('Cluster pathPrefix: (none)')
  }
  // W2.D4: emit a Languages: line for clusters spanning multiple languages
  // so the LLM picks a polyglot-appropriate name.
  if (pc.languages.length > 1) {
    lines.push(`Languages (multi): ${pc.languages.join(', ')}`)
  } else if (pc.languages.length === 1) {
    lines.push(`Language: ${pc.languages[0]}`)
  }
  lines.push(`Files (up to ${MAX_FILES_IN_PROMPT}):`)
  if (pc.filesWithSymbols.length === 0) {
    lines.push('- (no files)')
  } else {
    for (const f of pc.filesWithSymbols) {
      const syms = f.symbols.length > 0 ? ` [${f.symbols.join(', ')}]` : ''
      lines.push(`- ${f.path}${syms}`)
    }
  }
  if (pc.cluster.primaryEntry) {
    lines.push(`Primary entry: ${pc.cluster.primaryEntry}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// JSON response parsing + validation
// ---------------------------------------------------------------------------

interface ParsedResponse {
  name: string
  description?: string
  confidence: number
}

/** Strip leading/trailing whitespace and any ```json ... ``` or ``` ... ``` fences. */
function stripMarkdownFences(raw: string): string {
  let s = raw.trim()
  // Match ```json\n...\n``` or ```\n...\n```
  const fencedMatch = /^```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)\n?```\s*$/.exec(s)
  if (fencedMatch) {
    s = fencedMatch[1].trim()
  }
  return s
}

/** Extract the first balanced-looking `{...}` JSON-ish region from the text. */
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{')
  if (start < 0) return null
  // Walk forward matching braces, honouring string literals.
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return s.slice(start, i + 1)
      }
    }
  }
  return null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validate + narrow a parsed object. Returns null when invalid. */
function validateParsed(candidate: unknown): ParsedResponse | null {
  if (!isRecord(candidate)) return null
  const rawName = candidate.name
  if (typeof rawName !== 'string') return null
  const name = rawName.trim()
  if (name.length === 0 || name.length > MAX_NAME_LEN) return null

  const rawDesc = candidate.description
  let description: string | undefined
  if (rawDesc !== undefined && rawDesc !== null) {
    if (typeof rawDesc !== 'string') return null
    const trimmed = rawDesc.trim()
    if (trimmed.length > MAX_DESCRIPTION_LEN) return null
    description = trimmed.length > 0 ? trimmed : undefined
  }

  const rawConf = candidate.confidence
  let confidence = 0.5
  if (rawConf !== undefined && rawConf !== null) {
    if (typeof rawConf !== 'number' || !Number.isFinite(rawConf)) return null
    if (rawConf < 0 || rawConf > 1) return null
    confidence = rawConf
  }

  return description !== undefined ? { name, description, confidence } : { name, confidence }
}

/**
 * Parse an LLM response. Returns null when parsing or validation fails.
 */
function parseLlmResponse(raw: string): ParsedResponse | null {
  const stripped = stripMarkdownFences(raw)
  // Attempt 1: direct parse.
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s) as unknown
    } catch {
      return undefined
    }
  }
  const direct = tryParse(stripped)
  if (direct !== undefined) {
    const valid = validateParsed(direct)
    if (valid) return valid
  }
  // Attempt 2: extract first balanced {...}.
  const extracted = extractFirstJsonObject(stripped)
  if (extracted !== null) {
    const parsed = tryParse(extracted)
    if (parsed !== undefined) {
      return validateParsed(parsed)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Fallbacks
// ---------------------------------------------------------------------------

/**
 * Derive a PascalCased multi-word label from a pathPrefix's last segment.
 *
 * Splits on `-`, `_`, and camelCase boundaries. Returns an empty string when
 * the last segment is empty or yields no alphanumeric tokens.
 *
 * Examples:
 *   'src/lib/ingest'     → 'Ingest'
 *   'src/lib/code-anchors' → 'Code Anchors'
 *   'src/lib/brainstormState' → 'Brainstorm State'
 *   'src/lib/fooBARBaz'  → 'Foo BAR Baz'
 */
export function prettifyPathPrefix(pathPrefix: string): string {
  if (!pathPrefix) return ''
  const segs = pathPrefix.split('/').filter((s) => s.length > 0)
  if (segs.length === 0) return ''
  const last = segs[segs.length - 1]
  if (!last) return ''
  // Split on -, _, whitespace.
  const coarse = last.split(/[-_\s]+/).filter((s) => s.length > 0)
  // For each coarse token split on camelCase boundaries.
  const tokens: string[] = []
  for (const c of coarse) {
    // Insert boundary before an uppercase that follows a lowercase/digit,
    // OR before an uppercase that is followed by a lowercase (handles ABCDef → ABC Def).
    const withBoundaries = c
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    for (const t of withBoundaries.split(/\s+/).filter((s) => s.length > 0)) {
      tokens.push(t)
    }
  }
  if (tokens.length === 0) return ''
  // Title-case each token: capitalize first char, keep the rest as given
  // (preserves all-caps like "BAR" / "API" / "ID").
  const titled = tokens.map((t) => {
    if (t.length === 0) return t
    if (t === t.toUpperCase() && t.length > 1) return t // all-caps token: keep
    return t[0].toUpperCase() + t.slice(1)
  })
  return titled.join(' ').trim()
}

/**
 * Short pathPrefix is "meaningful" when it has a non-generic leaf.
 * `src`, `src/lib`, `src/app`, `''` are NOT meaningful.
 */
function hasMeaningfulPrefix(cluster: FactCluster): boolean {
  const p = cluster.pathPrefix
  if (!p) return false
  const segs = p.split('/').filter((s) => s.length > 0)
  if (segs.length === 0) return false
  const generic = new Set(['src', 'lib', 'app', 'source'])
  // Special-case: a single-generic-segment prefix is not meaningful.
  if (segs.every((s) => generic.has(s))) return false
  // At least one non-generic leaf segment is required; pick the LAST segment.
  const leaf = segs[segs.length - 1]
  if (generic.has(leaf)) return false
  return leaf.length > 0
}

/** "A", "B", ..., "Z", "AA", "AB", ... — Excel-style column letters. */
function sequentialLabel(index: number): string {
  let n = index
  let out = ''
  while (true) {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
    if (n < 0) break
  }
  return out
}

function fallbackName(cluster: FactCluster, sequentialIndex: number): ClusterName {
  if (hasMeaningfulPrefix(cluster) && cluster.pathPrefix) {
    const pretty = prettifyPathPrefix(cluster.pathPrefix)
    if (pretty.length > 0) {
      return {
        clusterId: cluster.id,
        name: pretty,
        confidence: 0.6,
        source: 'fallback-prefix',
      }
    }
  }
  return {
    clusterId: cluster.id,
    name: `Cluster ${sequentialLabel(sequentialIndex)}`,
    confidence: 0.2,
    source: 'fallback-sequential',
  }
}

// ---------------------------------------------------------------------------
// Single-call LLM attempt
// ---------------------------------------------------------------------------

type LlmOutcome =
  | { ok: true; parsed: ParsedResponse }
  | { ok: false; kind: 'timeout' | 'error' | 'malformed' }

async function callLlmForCluster(
  pc: PromptCluster,
  config: LlmConfig,
  projectName: string,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): Promise<LlmOutcome> {
  const controller = new AbortController()
  let timedOut = false
  const timeoutHandle = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  let parentAborted = false
  const onParentAbort = () => {
    parentAborted = true
    controller.abort()
  }
  if (parentSignal) {
    if (parentSignal.aborted) {
      parentAborted = true
      controller.abort()
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true })
    }
  }

  try {
    const userPrompt = renderUserPrompt(projectName, pc)
    let collected = ''
    try {
      for await (const delta of streamChat(
        SYSTEM_PROMPT,
        [{ role: 'user', content: userPrompt }],
        config,
        controller.signal,
      )) {
        collected += delta
      }
    } catch (err) {
      if (timedOut) return { ok: false, kind: 'timeout' }
      if (parentAborted) return { ok: false, kind: 'error' }
      // Stream-level errors — network, HTTP 5xx, etc.
      void err
      return { ok: false, kind: 'error' }
    }

    const parsed = parseLlmResponse(collected)
    if (!parsed) return { ok: false, kind: 'malformed' }
    return { ok: true, parsed }
  } finally {
    clearTimeout(timeoutHandle)
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort)
  }
}

// ---------------------------------------------------------------------------
// Bounded concurrency pool
// ---------------------------------------------------------------------------

/**
 * Run `tasks` with at most `concurrency` in flight. Results are written to
 * the returned array at the same index as each task. Each task handles its
 * own errors; the pool itself never rejects.
 */
async function runPool<T>(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array<T>(count)
  if (count === 0) return results
  const effective = Math.max(1, Math.min(concurrency, count))
  let next = 0

  const runOne = async (): Promise<void> => {
    while (true) {
      const idx = next++
      if (idx >= count) return
      results[idx] = await worker(idx)
    }
  }

  const workers: Promise<void>[] = []
  for (let i = 0; i < effective; i++) workers.push(runOne())
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function nameClusters(
  clusters: ClusterResult,
  anchors: CodeAnchorResult,
  config: LlmConfig,
  options?: NameClustersOptions,
): Promise<NameResult> {
  const started = Date.now()
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY
  const offline = options?.offline ?? false
  const projectName = options?.projectName ?? DEFAULT_PROJECT_NAME
  const signal = options?.signal

  const names = new Map<string, ClusterName>()
  const diagnostics: NameDiagnostics = {
    llmCalls: 0,
    llmSuccesses: 0,
    llmTimeouts: 0,
    llmErrors: 0,
    fallbackPrefix: 0,
    fallbackSequential: 0,
    wallMs: 0,
  }

  // Preserve input order — insertion order of Map is cluster input order.
  const total = clusters.clusters.length
  if (total === 0) {
    diagnostics.wallMs = Date.now() - started
    return { names, diagnostics }
  }

  // Reserve a sequential index per cluster IN INPUT ORDER so fallbacks are
  // stable regardless of which clusters actually end up needing sequential
  // labels.
  const results: ClusterName[] = new Array<ClusterName>(total)

  // Fallback helper — captures sequentialIndex.
  const doFallback = (i: number): ClusterName => {
    const cluster = clusters.clusters[i]
    const fb = fallbackName(cluster, i)
    if (fb.source === 'fallback-prefix') diagnostics.fallbackPrefix++
    else diagnostics.fallbackSequential++
    return fb
  }

  // Offline — every cluster falls back.
  if (offline) {
    for (let i = 0; i < total; i++) results[i] = doFallback(i)
    for (const cn of results) names.set(cn.clusterId, cn)
    diagnostics.wallMs = Date.now() - started
    return { names, diagnostics }
  }

  // Short-circuit: caller already aborted.
  if (signal?.aborted) {
    for (let i = 0; i < total; i++) results[i] = doFallback(i)
    for (const cn of results) names.set(cn.clusterId, cn)
    diagnostics.wallMs = Date.now() - started
    return { names, diagnostics }
  }

  const promptClusters = buildPromptClusters(clusters, anchors)

  await runPool(total, concurrency, async (i) => {
    // If the caller signal has aborted between scheduling and execution, skip
    // the LLM and fall back directly.
    if (signal?.aborted) {
      results[i] = doFallback(i)
      return
    }
    diagnostics.llmCalls++
    const outcome = await callLlmForCluster(
      promptClusters[i],
      config,
      projectName,
      timeoutMs,
      signal,
    )
    if (outcome.ok) {
      diagnostics.llmSuccesses++
      const cluster = clusters.clusters[i]
      const cn: ClusterName = outcome.parsed.description !== undefined
        ? {
            clusterId: cluster.id,
            name: outcome.parsed.name,
            description: outcome.parsed.description,
            confidence: outcome.parsed.confidence,
            source: 'llm',
          }
        : {
            clusterId: cluster.id,
            name: outcome.parsed.name,
            confidence: outcome.parsed.confidence,
            source: 'llm',
          }
      results[i] = cn
      return
    }
    // Failure — record the diagnostic bucket, then fall back.
    if (outcome.kind === 'timeout') diagnostics.llmTimeouts++
    else diagnostics.llmErrors++
    results[i] = doFallback(i)
  })

  // Insert in input order.
  for (const cn of results) names.set(cn.clusterId, cn)
  diagnostics.wallMs = Date.now() - started
  return { names, diagnostics }
}

// Internals re-exported for tests / ad-hoc inspection. Not part of the stable API.
export const _internals = {
  prettifyPathPrefix,
  parseLlmResponse,
  hasMeaningfulPrefix,
  sequentialLabel,
  stripMarkdownFences,
  extractFirstJsonObject,
  buildPromptClusters,
  renderUserPrompt,
} as const
