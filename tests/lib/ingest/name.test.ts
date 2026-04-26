/**
 * W2.D5 hermetic tests — mock global fetch; exercise LLM + fallback paths.
 * No real network. No disk I/O.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClusterResult, FactCluster } from '../../../src/lib/ingest/cluster'
import type { CodeAnchorResult } from '../../../src/lib/ingest/code-anchors'
import type { LlmConfig } from '../../../src/lib/llm-client'
import {
  _internals,
  nameClusters,
  prettifyPathPrefix,
} from '../../../src/lib/ingest/name'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function moduleId(relPath: string): string {
  return `module:${relPath}`
}

function makeCluster(opts: {
  id: string
  files: string[]
  primary?: string
  pathPrefix?: string
}): FactCluster {
  const memberIds = opts.files.map(moduleId)
  const memberFiles = [...opts.files]
  const base: FactCluster = {
    id: opts.id,
    memberIds,
    memberFiles,
    size: opts.files.length,
    primaryEntry: opts.primary ?? opts.files[0] ?? '',
  }
  if (opts.pathPrefix !== undefined) {
    return { ...base, pathPrefix: opts.pathPrefix }
  }
  return base
}

function makeClusterResult(clusters: FactCluster[]): ClusterResult {
  const moduleToCluster = new Map<string, string>()
  for (const c of clusters) for (const m of c.memberIds) moduleToCluster.set(m, c.id)
  return {
    clusters,
    moduleToCluster,
    modularity: 0,
    diagnostics: { isolatedModules: 0, smallClustersBefore: 0, smallClustersAfter: 0 },
  }
}

function makeAnchors(
  clusters: ClusterResult,
  filesPerCluster: Record<string, Array<{ path: string; symbols: string[] }>> = {},
): CodeAnchorResult {
  const entries = clusters.clusters.map((c) => {
    const files = filesPerCluster[c.id] ?? c.memberFiles.map((p) => ({ path: p, symbols: [] }))
    const primary = c.primaryEntry && files.some((f) => f.path === c.primaryEntry)
      ? c.primaryEntry
      : files[0]?.path
    return {
      clusterId: c.id,
      anchor: primary !== undefined ? { files, primary_entry: primary } : { files },
    }
  })
  const withFiles = entries.filter((e) => e.anchor.files.length > 0).length
  return {
    entries,
    coverage: entries.length === 0 ? 0 : withFiles / entries.length,
    diagnostics: { clustersWithNoExports: 0, orphanedPrimaryEntries: 0 },
  }
}

const CONFIG: LlmConfig = {
  apiBase: 'https://fake.example.com/v1',
  apiKey: 'fake-key',
  model: 'fake-model',
}

// ---------------------------------------------------------------------------
// Fetch mock utilities — builds OpenAI-style SSE streams.
// ---------------------------------------------------------------------------

function sseChunk(content: string): Uint8Array {
  const payload = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
  return new TextEncoder().encode(payload)
}

function sseDone(): Uint8Array {
  return new TextEncoder().encode('data: [DONE]\n\n')
}

/** Build a Response whose body is an SSE stream containing the given full content split into a couple chunks. */
function makeSseResponse(fullContent: string): Response {
  const chunks = [sseChunk(fullContent), sseDone()]
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/**
 * Build a Response whose body NEVER completes — simulates a stalled stream.
 * When `signal` fires we error the stream with an AbortError so the client
 * sees a real abort (matching native fetch behaviour).
 */
function makeStalledResponse(signal?: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Send one small chunk to keep things honest, then never terminate.
      controller.enqueue(sseChunk(''))
      if (signal) {
        const handleAbort = () => {
          try {
            const err = new DOMException('The operation was aborted.', 'AbortError')
            controller.error(err)
          } catch {
            // ignore
          }
        }
        if (signal.aborted) handleAbort()
        else signal.addEventListener('abort', handleAbort, { once: true })
      }
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

// Track the original fetch so we can restore it.
const originalFetch = globalThis.fetch

beforeEach(() => {
  // Each test installs its own mock.
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. Offline mode — prefix fallback
// ---------------------------------------------------------------------------

describe('nameClusters — offline fallback-prefix', () => {
  it('names every cluster via prefix heuristic, no network', async () => {
    const clusters = makeClusterResult([
      makeCluster({
        id: 'cluster:1',
        files: ['src/lib/ingest/a.ts'],
        pathPrefix: 'src/lib/ingest',
      }),
      makeCluster({
        id: 'cluster:2',
        files: ['src/lib/code-anchors/b.ts'],
        pathPrefix: 'src/lib/code-anchors',
      }),
      makeCluster({
        id: 'cluster:3',
        files: ['src/lib/brainstormState/c.ts'],
        pathPrefix: 'src/lib/brainstormState',
      }),
    ])
    const anchors = makeAnchors(clusters)

    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const result = await nameClusters(clusters, anchors, CONFIG, { offline: true })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.names.size).toBe(3)
    expect(result.names.get('cluster:1')?.name).toBe('Ingest')
    expect(result.names.get('cluster:1')?.source).toBe('fallback-prefix')
    expect(result.names.get('cluster:2')?.name).toBe('Code Anchors')
    expect(result.names.get('cluster:3')?.name).toBe('Brainstorm State')
    expect(result.diagnostics).toMatchObject({
      llmCalls: 0,
      llmSuccesses: 0,
      llmTimeouts: 0,
      llmErrors: 0,
      fallbackPrefix: 3,
      fallbackSequential: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Offline mode — no prefix → sequential
// ---------------------------------------------------------------------------

describe('nameClusters — offline fallback-sequential', () => {
  it('uses Cluster A/B/C in input order when no meaningful prefix', async () => {
    const clusters = makeClusterResult([
      makeCluster({ id: 'cluster:A', files: ['src/a.ts'] }),
      makeCluster({ id: 'cluster:B', files: ['lib/b.ts'], pathPrefix: 'src' }),
      makeCluster({ id: 'cluster:C', files: ['other/c.ts'], pathPrefix: '' }),
    ])
    const anchors = makeAnchors(clusters)
    const result = await nameClusters(clusters, anchors, CONFIG, { offline: true })
    expect(result.names.get('cluster:A')?.name).toBe('Cluster A')
    expect(result.names.get('cluster:B')?.name).toBe('Cluster B')
    expect(result.names.get('cluster:C')?.name).toBe('Cluster C')
    expect(result.diagnostics.fallbackSequential).toBe(3)
    expect(result.diagnostics.fallbackPrefix).toBe(0)
    for (const cn of result.names.values()) {
      expect(cn.source).toBe('fallback-sequential')
      expect(cn.confidence).toBe(0.2)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. Online success
// ---------------------------------------------------------------------------

describe('nameClusters — online success', () => {
  it('preserves LLM-provided name, description, confidence', async () => {
    const clusters = makeClusterResult([
      makeCluster({
        id: 'cluster:x',
        files: ['src/lib/ingest/a.ts'],
        pathPrefix: 'src/lib/ingest',
      }),
    ])
    const anchors = makeAnchors(clusters, {
      'cluster:x': [{ path: 'src/lib/ingest/a.ts', symbols: ['foo', 'bar'] }],
    })

    globalThis.fetch = vi.fn(async () =>
      makeSseResponse('{"name":"Foo Bar","description":"Does foo.","confidence":0.9}'),
    ) as unknown as typeof fetch

    const result = await nameClusters(clusters, anchors, CONFIG)
    const cn = result.names.get('cluster:x')
    expect(cn?.source).toBe('llm')
    expect(cn?.name).toBe('Foo Bar')
    expect(cn?.description).toBe('Does foo.')
    expect(cn?.confidence).toBe(0.9)
    expect(result.diagnostics.llmCalls).toBe(1)
    expect(result.diagnostics.llmSuccesses).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 4. Online timeout
// ---------------------------------------------------------------------------

describe('nameClusters — online timeout', () => {
  it('aborts the stalled stream and falls back to prefix', async () => {
    const clusters = makeClusterResult([
      makeCluster({
        id: 'cluster:t',
        files: ['src/lib/ingest/a.ts'],
        pathPrefix: 'src/lib/ingest',
      }),
    ])
    const anchors = makeAnchors(clusters)

    globalThis.fetch = vi.fn(async (_input, init?: RequestInit) => {
      const sig = init?.signal ?? undefined
      return makeStalledResponse(sig)
    }) as unknown as typeof fetch

    const result = await nameClusters(clusters, anchors, CONFIG, { timeoutMs: 50 })
    const cn = result.names.get('cluster:t')
    expect(cn?.source).toBe('fallback-prefix')
    expect(cn?.name).toBe('Ingest')
    expect(result.diagnostics.llmTimeouts).toBe(1)
    expect(result.diagnostics.fallbackPrefix).toBe(1)
  }, 5_000)
})

// ---------------------------------------------------------------------------
// 5. Online HTTP 500 error
// ---------------------------------------------------------------------------

describe('nameClusters — online HTTP 500', () => {
  it('falls back when the server returns 500', async () => {
    const clusters = makeClusterResult([
      makeCluster({
        id: 'cluster:e',
        files: ['src/lib/ingest/a.ts'],
        pathPrefix: 'src/lib/ingest',
      }),
    ])
    const anchors = makeAnchors(clusters)

    globalThis.fetch = vi.fn(
      async () =>
        new Response('Internal Server Error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        }),
    ) as unknown as typeof fetch

    const result = await nameClusters(clusters, anchors, CONFIG)
    const cn = result.names.get('cluster:e')
    expect(cn?.source).toBe('fallback-prefix')
    expect(result.diagnostics.llmErrors).toBe(1)
    expect(result.diagnostics.fallbackPrefix).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 6. Malformed JSON
// ---------------------------------------------------------------------------

describe('nameClusters — malformed JSON', () => {
  it('falls back when the model returns non-JSON text', async () => {
    const clusters = makeClusterResult([
      makeCluster({
        id: 'cluster:m',
        files: ['src/lib/ingest/a.ts'],
        pathPrefix: 'src/lib/ingest',
      }),
    ])
    const anchors = makeAnchors(clusters)

    globalThis.fetch = vi.fn(async () =>
      makeSseResponse('blah blah blah nothing parseable'),
    ) as unknown as typeof fetch

    const result = await nameClusters(clusters, anchors, CONFIG)
    const cn = result.names.get('cluster:m')
    expect(cn?.source).toBe('fallback-prefix')
    expect(result.diagnostics.llmErrors).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 7. Markdown-fenced JSON
// ---------------------------------------------------------------------------

describe('nameClusters — markdown-fenced JSON', () => {
  it('strips ```json fences and parses successfully', async () => {
    const clusters = makeClusterResult([
      makeCluster({
        id: 'cluster:md',
        files: ['src/lib/ingest/a.ts'],
        pathPrefix: 'src/lib/ingest',
      }),
    ])
    const anchors = makeAnchors(clusters)

    const fenced = '```json\n{"name":"Thing Doer","description":"Does things.","confidence":0.8}\n```'
    globalThis.fetch = vi.fn(async () => makeSseResponse(fenced)) as unknown as typeof fetch

    const result = await nameClusters(clusters, anchors, CONFIG)
    const cn = result.names.get('cluster:md')
    expect(cn?.source).toBe('llm')
    expect(cn?.name).toBe('Thing Doer')
    expect(cn?.description).toBe('Does things.')
    expect(cn?.confidence).toBe(0.8)
  })
})

// ---------------------------------------------------------------------------
// 8. Schema violation — empty name
// ---------------------------------------------------------------------------

describe('nameClusters — schema violation', () => {
  it('falls back when name is empty string', async () => {
    const clusters = makeClusterResult([
      makeCluster({
        id: 'cluster:v',
        files: ['src/lib/ingest/a.ts'],
        pathPrefix: 'src/lib/ingest',
      }),
    ])
    const anchors = makeAnchors(clusters)

    globalThis.fetch = vi.fn(async () =>
      makeSseResponse('{"name":"","confidence":0.5}'),
    ) as unknown as typeof fetch

    const result = await nameClusters(clusters, anchors, CONFIG)
    const cn = result.names.get('cluster:v')
    expect(cn?.source).toBe('fallback-prefix')
    expect(result.diagnostics.llmErrors).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 9. Concurrency limit
// ---------------------------------------------------------------------------

describe('nameClusters — concurrency limit', () => {
  it('caps in-flight calls at `concurrency`', async () => {
    const NUM = 5
    const clusters = makeClusterResult(
      Array.from({ length: NUM }, (_, i) =>
        makeCluster({
          id: `cluster:${i}`,
          files: [`src/lib/mod${i}/a.ts`],
          pathPrefix: `src/lib/mod${i}`,
        }),
      ),
    )
    const anchors = makeAnchors(clusters)

    let inFlight = 0
    let maxInFlight = 0

    globalThis.fetch = vi.fn(async () => {
      inFlight++
      if (inFlight > maxInFlight) maxInFlight = inFlight
      // Hold briefly so concurrent calls overlap in real time.
      await new Promise<void>((r) => setTimeout(r, 20))
      inFlight--
      return makeSseResponse(`{"name":"Some Thing","confidence":0.5}`)
    }) as unknown as typeof fetch

    const result = await nameClusters(clusters, anchors, CONFIG, { concurrency: 2 })
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(result.names.size).toBe(NUM)
    expect(result.diagnostics.llmSuccesses).toBe(NUM)
  }, 10_000)
})

// ---------------------------------------------------------------------------
// 10. Caller signal abort
// ---------------------------------------------------------------------------

describe('nameClusters — caller signal abort', () => {
  it('aborts pending calls and falls back; no hang', async () => {
    const clusters = makeClusterResult([
      makeCluster({
        id: 'cluster:s1',
        files: ['src/lib/ingest/a.ts'],
        pathPrefix: 'src/lib/ingest',
      }),
      makeCluster({
        id: 'cluster:s2',
        files: ['src/lib/code-anchors/b.ts'],
        pathPrefix: 'src/lib/code-anchors',
      }),
    ])
    const anchors = makeAnchors(clusters)

    globalThis.fetch = vi.fn(async (_input, init?: RequestInit) => {
      const sig = init?.signal ?? undefined
      return makeStalledResponse(sig)
    }) as unknown as typeof fetch

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)

    const result = await nameClusters(clusters, anchors, CONFIG, {
      timeoutMs: 30_000,
      signal: controller.signal,
    })
    expect(result.names.size).toBe(2)
    for (const cn of result.names.values()) {
      expect(cn.source).not.toBe('llm')
    }
  }, 5_000)
})

// ---------------------------------------------------------------------------
// 11. PathPrefix splitter unit tests
// ---------------------------------------------------------------------------

describe('prettifyPathPrefix', () => {
  it('handles kebab-case, camelCase, single-word, nested', () => {
    expect(prettifyPathPrefix('src/lib/code-anchors')).toBe('Code Anchors')
    expect(prettifyPathPrefix('src/lib/brainstormState')).toBe('Brainstorm State')
    expect(prettifyPathPrefix('src/lib/ingest')).toBe('Ingest')
    expect(prettifyPathPrefix('src/lib/snake_case_thing')).toBe('Snake Case Thing')
    expect(prettifyPathPrefix('src/lib/APIClient')).toBe('API Client')
    expect(prettifyPathPrefix('')).toBe('')
    expect(prettifyPathPrefix('/')).toBe('')
    expect(prettifyPathPrefix('single')).toBe('Single')
  })
})

// ---------------------------------------------------------------------------
// 12. Determinism of fallback path
// ---------------------------------------------------------------------------

describe('nameClusters — fallback determinism', () => {
  it('two identical offline runs deep-equal (modulo wallMs)', async () => {
    const build = (): ClusterResult =>
      makeClusterResult([
        makeCluster({
          id: 'cluster:d1',
          files: ['src/lib/ingest/a.ts'],
          pathPrefix: 'src/lib/ingest',
        }),
        makeCluster({
          id: 'cluster:d2',
          files: ['src/lib/code-anchors/b.ts'],
          pathPrefix: 'src/lib/code-anchors',
        }),
        makeCluster({ id: 'cluster:d3', files: ['other/c.ts'] }),
      ])

    const c1 = build()
    const c2 = build()
    const r1 = await nameClusters(c1, makeAnchors(c1), CONFIG, { offline: true })
    const r2 = await nameClusters(c2, makeAnchors(c2), CONFIG, { offline: true })

    const toPlain = (r: typeof r1) => ({
      entries: Array.from(r.names.entries()),
      diagnostics: { ...r.diagnostics, wallMs: 0 },
    })
    expect(toPlain(r1)).toEqual(toPlain(r2))
    // Iteration order == cluster input order.
    expect(Array.from(r1.names.keys())).toEqual(['cluster:d1', 'cluster:d2', 'cluster:d3'])
  })
})

// ---------------------------------------------------------------------------
// 13. Internal parse helpers — sanity
// ---------------------------------------------------------------------------

describe('_internals.parseLlmResponse', () => {
  it('parses direct JSON', () => {
    const r = _internals.parseLlmResponse('{"name":"X Y","confidence":0.4}')
    expect(r?.name).toBe('X Y')
    expect(r?.confidence).toBe(0.4)
  })
  it('recovers when there is stray text around a {...} object', () => {
    const r = _internals.parseLlmResponse('Sure! {"name":"Pkg Thing","confidence":0.7} done.')
    expect(r?.name).toBe('Pkg Thing')
  })
  it('rejects confidence out of range', () => {
    expect(_internals.parseLlmResponse('{"name":"X","confidence":1.5}')).toBeNull()
    expect(_internals.parseLlmResponse('{"name":"X","confidence":-0.1}')).toBeNull()
  })
  it('rejects name over 60 chars', () => {
    const longName = 'A'.repeat(61)
    expect(_internals.parseLlmResponse(`{"name":"${longName}","confidence":0.5}`)).toBeNull()
  })
  it('accepts description absent and defaults confidence', () => {
    const r = _internals.parseLlmResponse('{"name":"Ok"}')
    expect(r?.name).toBe('Ok')
    expect(r?.confidence).toBe(0.5)
    expect(r?.description).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// W2.D4: cross-language prompt rendering tests
// ---------------------------------------------------------------------------

import { inferLanguageFromPath } from '../../../src/lib/ingest/name'

describe('inferLanguageFromPath (W2.D4)', () => {
  it('detects typescript / python / go / java / rust', () => {
    expect(inferLanguageFromPath('src/foo.ts')).toBe('typescript')
    expect(inferLanguageFromPath('src/foo.tsx')).toBe('typescript')
    expect(inferLanguageFromPath('src/main.py')).toBe('python')
    expect(inferLanguageFromPath('src/main.go')).toBe('go')
    expect(inferLanguageFromPath('App.java')).toBe('java')
    expect(inferLanguageFromPath('main.rs')).toBe('rust')
  })

  it('returns null for extension-less or unknown files', () => {
    expect(inferLanguageFromPath('Makefile')).toBeNull()
    expect(inferLanguageFromPath('foo.unknownext')).toBeNull()
  })
})

describe('renderUserPrompt language line (W2.D4)', () => {
  it('emits "Languages (multi):" for clusters spanning multiple languages', () => {
    const cluster = makeCluster({ id: 'c1', files: ['svc/api.py', 'svc/worker.go'], pathPrefix: 'svc' })
    const clusters = makeClusterResult([cluster])
    const anchors = makeAnchors(clusters, {
      c1: [
        { path: 'svc/api.py', symbols: ['App'] },
        { path: 'svc/worker.go', symbols: ['Worker'] },
      ],
    })
    const built = _internals.buildPromptClusters(clusters, anchors)
    expect(built).toHaveLength(1)
    expect(built[0].languages).toEqual(['go', 'python'])
    const rendered = _internals.renderUserPrompt('test-proj', built[0])
    expect(rendered).toContain('Languages (multi): go, python')
  })

  it('emits "Language:" (singular) for single-language clusters', () => {
    const cluster = makeCluster({ id: 'c1', files: ['svc/api.py'], pathPrefix: 'svc' })
    const clusters = makeClusterResult([cluster])
    const anchors = makeAnchors(clusters, { c1: [{ path: 'svc/api.py', symbols: ['App'] }] })
    const built = _internals.buildPromptClusters(clusters, anchors)
    expect(built[0].languages).toEqual(['python'])
    const rendered = _internals.renderUserPrompt('test-proj', built[0])
    expect(rendered).toContain('Language: python')
    expect(rendered).not.toContain('Languages (multi):')
  })

  it('omits language line when all files have unknown extensions', () => {
    const cluster = makeCluster({ id: 'c1', files: ['Makefile', 'README'], pathPrefix: '' })
    const clusters = makeClusterResult([cluster])
    const anchors = makeAnchors(clusters, {
      c1: [
        { path: 'Makefile', symbols: [] },
        { path: 'README', symbols: [] },
      ],
    })
    const built = _internals.buildPromptClusters(clusters, anchors)
    expect(built[0].languages).toEqual([])
    const rendered = _internals.renderUserPrompt('test-proj', built[0])
    expect(rendered).not.toMatch(/Language(s \(multi\))?:/)
  })

  it('language detection scans ALL files, not just the prompt-capped subset', () => {
    // Build a cluster with > MAX_FILES_IN_PROMPT (10) files spanning python + go.
    // The first 10 are python; the 11th is go. We want to confirm 'go' still
    // appears in languages even though it's beyond the prompt cap.
    const files: string[] = []
    for (let i = 0; i < 10; i++) files.push(`svc/py${i}.py`)
    files.push('svc/worker.go')
    const cluster = makeCluster({ id: 'c1', files, pathPrefix: 'svc' })
    const clusters = makeClusterResult([cluster])
    const anchors = makeAnchors(clusters, {
      c1: files.map((p) => ({ path: p, symbols: [] })),
    })
    const built = _internals.buildPromptClusters(clusters, anchors)
    expect(built[0].languages).toEqual(['go', 'python'])
  })
})
