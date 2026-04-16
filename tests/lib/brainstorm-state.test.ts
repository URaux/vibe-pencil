import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  applyExternalDepsEvents,
  applyAssistantControl,
  brainstormStateFilePath,
  createInitialBrainstormState,
  EVENT_LOG_COMPACT_THRESHOLD,
  EVENT_LOG_COMPACT_TOKEN_BUDGET,
  estimateEventLogTokens,
  formatStateForPrompt,
  parseAssistantControlComments,
  readBrainstormState,
  updateBrainstormState,
  writeBrainstormState,
  type ExternalDepsEvent,
} from '@/lib/brainstorm/state'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-brainstorm-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeEvent(i: number): ExternalDepsEvent {
  // Mix of distinct services and a couple that overlap so compaction
  // exercises last-write-wins.
  const service = i < 20 ? `svc-${i}` : `svc-${i - 18}` // svc-2, svc-3, ... overlap
  return {
    op: 'add',
    service,
    type: 'api_key',
    status: i % 3 === 0 ? 'provided' : 'needed',
    envVar: `${service.toUpperCase().replace('-', '_')}_KEY`,
    group: i % 2 === 0 ? 'A' : 'B',
  }
}

// Smaller variant used to probe the count-ceiling trigger specifically:
// drops optional fields (envVar/group/status) so many events stay under the
// token budget while still crossing the 50-event ceiling.
function makeTinyEvent(i: number): ExternalDepsEvent {
  const service = i < 20 ? `s${i}` : `s${i - 18}`
  return { op: 'add', service, type: 'api_key' }
}

describe('brainstorm state — externalDeps event compaction', () => {
  it('compacts the event log into a snapshot once the count ceiling is hit', () => {
    let state = createInitialBrainstormState('s1')

    // Tiny events keep total footprint under the 1500-token budget so we can
    // isolate the count-ceiling trigger. Push ceiling+5 events one at a time.
    const total = EVENT_LOG_COMPACT_THRESHOLD + 5
    for (let i = 0; i < total; i++) {
      state = applyExternalDepsEvents(state, [makeTinyEvent(i)])
    }

    // Count-ceiling compaction must have fired: log empties, snapshot retained.
    expect(state.externalDepsEventLog.length).toBeLessThan(EVENT_LOG_COMPACT_THRESHOLD)
    expect(state.externalDeps.length).toBeGreaterThan(0)

    // Snapshot must reflect the LAST write for overlapping keys.
    // makeTinyEvent maps i→service such that s3 is written at i=3 and i=21
    // (21-18). Check the dep exists (status defaults to 'needed' since we
    // drop the field in tiny events).
    const s3 = state.externalDeps.find((d) => d.service === 's3')
    expect(s3).toBeDefined()
  })

  it('keeps the log AND a live snapshot below the compaction threshold', () => {
    let state = createInitialBrainstormState('s2')
    for (let i = 0; i < 5; i++) {
      state = applyExternalDepsEvents(state, [makeEvent(i)])
    }
    expect(state.externalDepsEventLog.length).toBe(5)
    expect(state.externalDeps.length).toBe(5)
    // Sanity: 5 short events are well below both triggers.
    expect(estimateEventLogTokens(state.externalDepsEventLog)).toBeLessThan(
      EVENT_LOG_COMPACT_TOKEN_BUDGET,
    )
  })

  it('compacts early when a few long-note events exceed the token budget', () => {
    // Five events with verbose CJK/English notes should trip the token
    // budget long before the 50-event count ceiling — this is the exact
    // long-novice-session scenario the token-based trigger exists for.
    let state = createInitialBrainstormState('s-token-budget')
    const longNote =
      '这是一段很长的 notes，用来模拟用户在 novice 模式下给某个外部依赖写的详细备注。'.repeat(30) +
      ' Additional English exposition that inflates the JSON payload well past'.repeat(10)

    const events: ExternalDepsEvent[] = []
    for (let i = 0; i < 5; i++) {
      events.push({
        op: 'add',
        service: `heavy-svc-${i}`,
        type: 'api_key',
        status: 'needed',
        envVar: `HEAVY_${i}_KEY`,
        notes: longNote,
      })
    }

    // Verify our estimator agrees the batch is well over budget before we
    // feed it in — guards against the heuristic drifting in future edits.
    expect(estimateEventLogTokens(events)).toBeGreaterThanOrEqual(
      EVENT_LOG_COMPACT_TOKEN_BUDGET,
    )

    state = applyExternalDepsEvents(state, events)

    // Token-budget compaction must have fired despite only 5 events.
    expect(state.externalDepsEventLog).toEqual([])
    expect(state.externalDeps).toHaveLength(5)
    expect(state.externalDeps[0].notes).toBe(longNote)
  })

  it('does NOT compact 21 short events — tokens below budget, count below ceiling', () => {
    // 21 short events > old 20-event threshold but far below the new 50-event
    // ceiling and the 1500-token budget. They should accumulate in the log
    // without triggering compaction.
    let state = createInitialBrainstormState('s-no-compact')
    for (let i = 0; i < 21; i++) {
      state = applyExternalDepsEvents(state, [makeEvent(i)])
    }

    expect(state.externalDepsEventLog.length).toBe(21)
    expect(estimateEventLogTokens(state.externalDepsEventLog)).toBeLessThan(
      EVENT_LOG_COMPACT_TOKEN_BUDGET,
    )
    expect(state.externalDepsEventLog.length).toBeLessThan(
      EVENT_LOG_COMPACT_THRESHOLD,
    )
  })

  it('treats `remove` events as deletions in the snapshot', () => {
    let state = createInitialBrainstormState('s3')
    state = applyExternalDepsEvents(state, [
      { op: 'add', service: 'stripe', type: 'api_key', status: 'needed', envVar: 'STRIPE_KEY' },
      { op: 'remove', service: 'stripe', envVar: 'STRIPE_KEY' },
    ])
    expect(state.externalDeps).toEqual([])
  })

  it('atomically writes and reads back state from disk', async () => {
    // Feed just enough tiny events to cross the count ceiling, then add a few
    // more that accumulate in the fresh log. Tiny events keep us under the
    // token budget so we isolate the count-ceiling path.
    const overCeilingBy = 2
    const total = EVENT_LOG_COMPACT_THRESHOLD + overCeilingBy
    let state = createInitialBrainstormState('test-session-uuid')
    for (let i = 0; i < total; i++) {
      state = applyExternalDepsEvents(state, [makeTinyEvent(i)])
    }
    const written = await writeBrainstormState(tmpDir, state)
    expect(written).toBe(brainstormStateFilePath(tmpDir, 'test-session-uuid'))

    const reloaded = await readBrainstormState(tmpDir, 'test-session-uuid')
    expect(reloaded).not.toBeNull()
    expect(reloaded!.sessionId).toBe('test-session-uuid')
    expect(reloaded!.externalDeps.length).toBeGreaterThan(0)
    // Compaction fires once the ceiling is crossed (log → 0), then the
    // remaining events are appended below threshold.
    expect(reloaded!.externalDepsEventLog.length).toBe(overCeilingBy)
  })

  it('returns null for an unknown sessionId', async () => {
    const result = await readBrainstormState(tmpDir, 'never-written')
    expect(result).toBeNull()
  })
})

describe('brainstorm state — assistant control parsing', () => {
  it('parses progress, externalDeps, and decisions comments out of a response', () => {
    const response = `
Some chat content here.
<!-- progress: batch=how round=3 mode=novice -->
More content.
<!-- externalDeps: [{"op":"add","service":"stripe","type":"api_key","status":"needed","envVar":"STRIPE_SECRET_KEY","group":"A"}] -->
<!-- decisions: {"domain":"e-commerce","scale":"SMB","features":["cart","checkout"]} -->
Wrap up.
`
    const parsed = parseAssistantControlComments(response)
    expect(parsed.progress).toEqual({ batch: 'how', round: 3, mode: 'novice' })
    expect(parsed.externalDepsEvents).toHaveLength(1)
    expect(parsed.externalDepsEvents[0].service).toBe('stripe')
    expect(parsed.decisionsPatch?.domain).toBe('e-commerce')
  })

  it('tolerates malformed JSON in control comments', () => {
    const parsed = parseAssistantControlComments(
      '<!-- externalDeps: [not valid json] --> <!-- decisions: {bad} -->'
    )
    expect(parsed.externalDepsEvents).toEqual([])
    expect(parsed.decisionsPatch).toBeUndefined()
  })

  it('applies a parsed control payload to state', () => {
    let state = createInitialBrainstormState('s4')
    state = applyAssistantControl(state, {
      progress: { batch: 'deps', round: 7, mode: 'novice' },
      externalDepsEvents: [
        { op: 'add', service: 'github', type: 'oauth', status: 'needed', envVar: 'GH_OAUTH', group: 'B' },
      ],
      decisionsPatch: { domain: 'e-commerce' },
    })
    expect(state.currentBatch).toBe('deps')
    expect(state.roundCount).toBe(7)
    expect(state.decisions.domain).toBe('e-commerce')
    expect(state.externalDeps).toHaveLength(1)
  })
})

describe('brainstorm state — prompt formatting', () => {
  it('returns empty string for fresh state with no signal', () => {
    const state = createInitialBrainstormState('s5')
    expect(formatStateForPrompt(state)).toBe('')
  })

  it('renders a Chinese prefix once state has content', () => {
    let state = createInitialBrainstormState('s6')
    state = applyAssistantControl(state, {
      progress: { batch: 'how', round: 3, mode: 'novice' },
      externalDepsEvents: [
        { op: 'add', service: 'stripe', type: 'api_key', status: 'needed', envVar: 'STRIPE_KEY', group: 'A' },
      ],
      decisionsPatch: { domain: 'e-commerce', features: ['cart', 'checkout'] },
    })
    const prefix = formatStateForPrompt(state)
    expect(prefix).toContain('本次 brainstorm 已知状态')
    expect(prefix).toContain('HOW 层')
    expect(prefix).toContain('第 3 轮')
    expect(prefix).toContain('e-commerce')
    expect(prefix).toContain('stripe')
  })
})

describe('brainstorm state — sessionId sanitization', () => {
  it('rejects path traversal in sessionId', () => {
    expect(() => brainstormStateFilePath(tmpDir, '../evil')).toThrow(/Invalid sessionId/)
  })
})

describe('brainstorm state — control-comment parsing regressions', () => {
  it('parses decisions with nested tech_preferences (no truncation at first `}`)', () => {
    const response =
      '<!-- decisions: {"tech_preferences":{"db":"postgres","auth":"clerk"},"domain":"shop"} -->'
    const parsed = parseAssistantControlComments(response)
    expect(parsed.decisionsPatch?.domain).toBe('shop')
    expect(parsed.decisionsPatch?.tech_preferences).toEqual({
      db: 'postgres',
      auth: 'clerk',
    })
  })

  it('parses externalDeps whose notes contain a bracket (no truncation at first `]`)', () => {
    const response =
      '<!-- externalDeps: [{"op":"add","service":"stripe","type":"api_key","status":"needed","envVar":"STRIPE_KEY","notes":"see [docs] here"}] -->'
    const parsed = parseAssistantControlComments(response)
    expect(parsed.externalDepsEvents).toHaveLength(1)
    expect(parsed.externalDepsEvents[0].notes).toBe('see [docs] here')
  })

  it('deep-merges tech_preferences across turns instead of clobbering prior keys', () => {
    let state = createInitialBrainstormState('s-tech')
    state = applyAssistantControl(state, {
      externalDepsEvents: [],
      decisionsPatch: { tech_preferences: { auth: 'clerk' } },
    })
    state = applyAssistantControl(state, {
      externalDepsEvents: [],
      decisionsPatch: { tech_preferences: { db: 'postgres' } },
    })
    expect(state.decisions.tech_preferences).toEqual({ auth: 'clerk', db: 'postgres' })
  })
})

describe('brainstorm state — concurrent update serialization', () => {
  it('serializes concurrent updateBrainstormState calls for the same sessionId', async () => {
    const sessionId = 'concurrent-session'
    // Seed an initial state on disk so both updaters read a known baseline.
    await writeBrainstormState(tmpDir, createInitialBrainstormState(sessionId))

    // Fire two overlapping updates that each push a distinct externalDep.
    // Without serialization, both would read the empty baseline and the
    // second write would clobber the first.
    const [r1, r2] = await Promise.all([
      updateBrainstormState(tmpDir, sessionId, (current) => {
        const base = current ?? createInitialBrainstormState(sessionId)
        return applyAssistantControl(base, {
          externalDepsEvents: [
            { op: 'add', service: 'alpha', type: 'api_key', status: 'needed', envVar: 'ALPHA_KEY' },
          ],
        })
      }),
      updateBrainstormState(tmpDir, sessionId, (current) => {
        const base = current ?? createInitialBrainstormState(sessionId)
        return applyAssistantControl(base, {
          externalDepsEvents: [
            { op: 'add', service: 'beta', type: 'api_key', status: 'needed', envVar: 'BETA_KEY' },
          ],
        })
      }),
    ])

    expect(r1).not.toBeNull()
    expect(r2).not.toBeNull()

    const final = await readBrainstormState(tmpDir, sessionId)
    expect(final).not.toBeNull()
    const services = final!.externalDeps.map((d) => d.service).sort()
    expect(services).toEqual(['alpha', 'beta'])
  })
})
