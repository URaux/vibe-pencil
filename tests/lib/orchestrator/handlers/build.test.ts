import { describe, expect, it } from 'vitest'
import { makeBuildHandler, type BuildPlan } from '@/lib/orchestrator/handlers/build'
import { MockRunner } from '../../../_helpers/mock-runner'
import type { HandlerContext, IrSummary, ClassifyResult } from '@/lib/orchestrator/types'

const baseSummary: IrSummary = {
  projectName: 'TestProject',
  blockCount: 8,
  containerCount: 3,
  edgeCount: 5,
  topContainers: [
    { id: 'auth', name: 'Auth', blockCount: 2 },
    { id: 'api', name: 'API', blockCount: 4 },
    { id: 'data', name: 'Data', blockCount: 2 },
  ],
  techStacks: ['TypeScript'],
  estimatedTokens: 30,
}

function makeClassify(): ClassifyResult {
  return { intent: 'build', confidence: 0.9, rawOutput: '', fallback: false }
}

function makeCtx(prompt: string, runner: MockRunner): HandlerContext {
  return {
    userPrompt: prompt,
    irSummary: baseSummary,
    classifyResult: makeClassify(),
    runner,
    workDir: process.cwd(),
  }
}

describe('build handler', () => {
  it('Test 1: scope=all returns ok with build-all summary', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"all","reason":"user asked to build everything"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('build this', runner))

    expect(result.intent).toBe('build')
    expect(result.status).toBe('ok')
    const payload = result.payload as { plan: BuildPlan; summary: string }
    expect(payload.plan.scope).toBe('all')
    expect(payload.plan.dispatchBody).toEqual({ all: true })
    expect(payload.summary).toBe('Build all 8 block(s)')
  })

  it('Test 2: scope=wave returns ok with waveIndex preserved', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"wave","waveIndex":2,"reason":"user named wave"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('implement Wave 2', runner))

    expect(result.status).toBe('ok')
    const payload = result.payload as { plan: BuildPlan; summary: string }
    expect(payload.plan.scope).toBe('wave')
    expect(payload.plan.waveIndex).toBe(2)
    expect(payload.plan.dispatchBody).toEqual({ wave: 2 })
    expect(payload.summary).toBe('Build wave 2')
  })

  it('Test 3: scope=blocks with known IDs returns ok and resolves names', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"blocks","blockIds":["auth"],"reason":"single block named"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('build the auth block', runner))

    expect(result.status).toBe('ok')
    const payload = result.payload as { plan: BuildPlan; summary: string }
    expect(payload.plan.scope).toBe('blocks')
    expect(payload.plan.blockIds).toEqual(['auth'])
    expect(payload.summary).toContain('Auth')
  })

  it('Test 4: scope=blocks with unknown ID returns error mentioning unknown block', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"blocks","blockIds":["does-not-exist"],"reason":"made up"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('build the magic block', runner))

    expect(result.status).toBe('error')
    expect(result.error).toContain('unknown block')
  })

  it('Test 5: scope=none routes to error indicating not-a-build-request', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"none","reason":"explanation request not build"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('what does Canvas Editor do?', runner))

    expect(result.status).toBe('error')
    expect(result.error).toContain('not a build request')
  })

  it('Test 6: malformed JSON returns parse error', async () => {
    const runner = new MockRunner([{ type: 'done', output: 'this is not json at all' }])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('build everything', runner))

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/parse|JSON/)
  })

  it('Test 7: timeout returns error mentioning timeout', async () => {
    const runner = new MockRunner([{ type: 'hang' }])
    const handler = makeBuildHandler({ runner, timeoutMs: 30 })

    const result = await handler(makeCtx('build now', runner))

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/timeout/i)
  })

  it('Test 8: wave scope with 0 blocks in IR returns error about no waves', async () => {
    const emptySummary: IrSummary = { ...baseSummary, blockCount: 0 }
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"wave","waveIndex":0,"reason":"user asked wave 0"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })
    const ctx: HandlerContext = {
      userPrompt: 'build wave 0',
      irSummary: emptySummary,
      classifyResult: makeClassify(),
      runner,
      workDir: process.cwd(),
    }

    const result = await handler(ctx)

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/no waves|no blocks/i)
  })

  it('Test 9: blocks scope with mix of valid + invalid IDs rejects listing all unknown', async () => {
    const runner = new MockRunner([
      {
        type: 'done',
        output: '{"scope":"blocks","blockIds":["auth","ghost-id","api","phantom"],"reason":"named blocks"}',
      },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('build auth and ghost', runner))

    expect(result.status).toBe('error')
    expect(result.error).toContain('ghost-id')
    expect(result.error).toContain('phantom')
    // known IDs (auth, api) should NOT appear in the error
    expect(result.error).not.toContain('auth')
  })

  it('Test 10: all scope with 0 blocks in IR returns error about empty project', async () => {
    const emptySummary: IrSummary = { ...baseSummary, blockCount: 0 }
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"all","reason":"build everything"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })
    const ctx: HandlerContext = {
      userPrompt: 'build everything',
      irSummary: emptySummary,
      classifyResult: makeClassify(),
      runner,
      workDir: process.cwd(),
    }

    const result = await handler(ctx)

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/no blocks|empty project/i)
  })

  it('Test 11: JSON with invalid scope field returns validation error', async () => {
    const runner = new MockRunner([
      { type: 'done', output: '{"scope":"EVERYTHING","reason":"build it all"}' },
    ])
    const handler = makeBuildHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('build everything', runner))

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/invalid scope|parse/i)
  })
})
