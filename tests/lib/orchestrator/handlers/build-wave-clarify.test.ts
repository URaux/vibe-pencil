import { describe, expect, it } from 'vitest'
import { makeBuildHandler, computeWaveCandidates, type BuildPlan } from '@/lib/orchestrator/handlers/build'
import { MockRunner } from '../../../_helpers/mock-runner'
import type { HandlerContext, IrSummary, ClassifyResult } from '@/lib/orchestrator/types'
import type { Ir } from '@/lib/ir/schema'

const baseSummary: IrSummary = {
  projectName: 'TestProject',
  blockCount: 3,
  containerCount: 1,
  edgeCount: 2,
  topContainers: [{ id: 'svc', name: 'Service', blockCount: 3 }],
  techStacks: ['TypeScript'],
  estimatedTokens: 20,
}

const baseIr: Ir = {
  version: '1.0',
  project: {
    name: 'TestProject',
    metadata: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archviberVersion: '0.1.0' },
  },
  containers: [{ id: 'svc', name: 'Service', color: 'blue' }],
  blocks: [
    { id: 'a', name: 'A', description: '', status: 'idle', container_id: 'svc', code_anchors: [] },
    { id: 'b', name: 'B', description: '', status: 'idle', container_id: 'svc', code_anchors: [] },
    { id: 'c', name: 'C', description: '', status: 'idle', container_id: 'svc', code_anchors: [] },
  ],
  // a->b->c: a is wave 0, b is wave 1, c is wave 2
  edges: [
    { id: 'e1', source: 'b', target: 'a', type: 'sync' },
    { id: 'e2', source: 'c', target: 'b', type: 'sync' },
  ],
  audit_log: [],
  seed_state: {},
}

function makeClassify(): ClassifyResult {
  return { intent: 'build', confidence: 0.9, rawOutput: '', fallback: false }
}

function makeCtx(prompt: string, runner: MockRunner, ir?: Ir): HandlerContext {
  return {
    userPrompt: prompt,
    irSummary: baseSummary,
    ir,
    classifyResult: makeClassify(),
    runner,
    workDir: process.cwd(),
  }
}

describe('computeWaveCandidates', () => {
  it('returns empty array when no IR provided', () => {
    const ctx = makeCtx('build wave 0', new MockRunner())
    expect(computeWaveCandidates(ctx)).toEqual([])
  })

  it('returns empty array when IR has no blocks', () => {
    const emptyIr: Ir = { ...baseIr, blocks: [], edges: [] }
    const ctx = makeCtx('build wave 0', new MockRunner(), emptyIr)
    expect(computeWaveCandidates(ctx)).toEqual([])
  })

  it('computes correct wave candidates from IR', () => {
    const ctx = makeCtx('build wave 0', new MockRunner(), baseIr)
    const candidates = computeWaveCandidates(ctx)
    expect(candidates).toHaveLength(3)
    expect(candidates[0]).toEqual({ waveIndex: 0, blockCount: 1 })
    expect(candidates[1]).toEqual({ waveIndex: 1, blockCount: 1 })
    expect(candidates[2]).toEqual({ waveIndex: 2, blockCount: 1 })
  })
})

describe('build handler: wave clarification', () => {
  it('scope=wave missing waveIndex → follow-up clarification succeeds with IR candidates', async () => {
    const runner = new MockRunner([
      // First call: classifier returns wave scope without waveIndex
      { type: 'done', output: '{"scope":"wave","reason":"user wants wave build"}' },
      // Second call: clarification agent picks wave 1
      { type: 'done', output: '{"waveIndex":1,"reason":"user said second wave"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 200 })
    const result = await handler(makeCtx('build the second wave', runner, baseIr))

    expect(result.status).toBe('ok')
    const payload = result.payload as { plan: BuildPlan; summary: string }
    expect(payload.plan.scope).toBe('wave')
    expect(payload.plan.waveIndex).toBe(1)
    expect(payload.plan.dispatchBody).toEqual({ wave: 1 })
    expect(payload.summary).toContain('wave 1')
  })

  it('scope=wave missing waveIndex, no IR → error mentioning no IR', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"wave","reason":"user wants wave build"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 200 })
    const result = await handler(makeCtx('build the wave', runner))

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/no IR|no ir|wave/i)
  })

  it('scope=wave negative waveIndex → follow-up clarification with IR candidates', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"wave","waveIndex":-1,"reason":"invalid"}' },
      { type: 'done', output: '{"waveIndex":0,"reason":"first wave"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 200 })
    const result = await handler(makeCtx('build wave negative', runner, baseIr))

    expect(result.status).toBe('ok')
    const payload = result.payload as { plan: BuildPlan; summary: string }
    expect(payload.plan.waveIndex).toBe(0)
  })

  it('scope=wave, clarification returns null waveIndex → clarify-style error with candidate list', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"wave","reason":"ambiguous"}' },
      { type: 'done', output: '{"waveIndex":null,"reason":"cannot determine"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 200 })
    const result = await handler(makeCtx('build some wave', runner, baseIr))

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/Available waves.*\[0.*1.*2\]/i)
  })

  it('scope=wave, clarification returns out-of-range index → clarify-style error', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"wave","reason":"ambiguous"}' },
      { type: 'done', output: '{"waveIndex":99,"reason":"picked high wave"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 200 })
    const result = await handler(makeCtx('build wave 99', runner, baseIr))

    expect(result.status).toBe('error')
    expect(result.error).toContain('Available waves')
  })

  it('scope=wave, clarification agent errors → clarify-style error with candidate list', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"wave","reason":"ambiguous"}' },
      { type: 'error', errorMessage: 'clarify agent crashed' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 200 })
    const result = await handler(makeCtx('build some wave', runner, baseIr))

    expect(result.status).toBe('error')
    expect(result.error).toContain('Available waves')
  })

  it('scope=wave, clarification returns malformed JSON → clarify-style error', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"wave","reason":"ambiguous"}' },
      { type: 'done', output: 'not json at all' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 200 })
    const result = await handler(makeCtx('build some wave', runner, baseIr))

    expect(result.status).toBe('error')
    expect(result.error).toContain('Available waves')
  })

  it('existing tests still pass: scope=all returns ok', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"all","reason":"build everything"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })
    const result = await handler(makeCtx('build all', runner, baseIr))

    expect(result.status).toBe('ok')
    const payload = result.payload as { plan: BuildPlan }
    expect(payload.plan.scope).toBe('all')
  })

  it('existing tests still pass: scope=wave with valid waveIndex returns ok directly', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"wave","waveIndex":0,"reason":"first wave"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })
    const result = await handler(makeCtx('build wave 0', runner, baseIr))

    expect(result.status).toBe('ok')
    const payload = result.payload as { plan: BuildPlan }
    expect(payload.plan.waveIndex).toBe(0)
    // Only 1 agent call: no clarification needed
    expect(runner.spawnAgent).toHaveBeenCalledTimes(1)
  })
})
