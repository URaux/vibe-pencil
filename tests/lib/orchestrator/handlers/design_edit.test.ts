import { describe, expect, it } from 'vitest'
import { makeDesignEditHandler, validateActions } from '@/lib/orchestrator/handlers/design_edit'
import { MockRunner } from '../../../_helpers/mock-runner'
import type { HandlerContext, IrSummary, ClassifyResult } from '@/lib/orchestrator/types'

const baseSummary: IrSummary = {
  projectName: 'TestProject',
  blockCount: 4,
  containerCount: 2,
  edgeCount: 3,
  topContainers: [
    { id: 'api', name: 'API', blockCount: 2 },
    { id: 'data', name: 'Data', blockCount: 2 },
  ],
  techStacks: ['TypeScript'],
  estimatedTokens: 20,
}

function makeClassify(): ClassifyResult {
  return { intent: 'design_edit', confidence: 0.9, rawOutput: '', fallback: false }
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

describe('design_edit handler', () => {
  it('Test 1: add-block prompt → returns ok with 1 add-node action', async () => {
    const output = JSON.stringify([{ action: 'add-node', node: { type: 'block', name: 'Auth', parentId: 'api' } }])
    const runner = new MockRunner([{ type: 'done', output }])
    const handler = makeDesignEditHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('add an Auth block to the API container', runner))

    expect(result.intent).toBe('design_edit')
    expect(result.status).toBe('ok')
    const payload = result.payload as { actions: unknown[] }
    expect(payload.actions).toHaveLength(1)
    expect((payload.actions[0] as { action: string }).action).toBe('add-node')
  })

  it('Test 2: connect-blocks prompt → returns ok with 1 add-edge action', async () => {
    const output = JSON.stringify([{ action: 'add-edge', edge: { source: 'a', target: 'b', type: 'sync' } }])
    const runner = new MockRunner([{ type: 'done', output }])
    const handler = makeDesignEditHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('connect block a to block b', runner))

    expect(result.intent).toBe('design_edit')
    expect(result.status).toBe('ok')
    const payload = result.payload as { actions: unknown[] }
    expect(payload.actions).toHaveLength(1)
    expect((payload.actions[0] as { action: string }).action).toBe('add-edge')
  })

  it('Test 3: rename → returns ok with 1 update-node action', async () => {
    const output = JSON.stringify([{ action: 'update-node', target_id: 'x', data: { name: 'Y' } }])
    const runner = new MockRunner([{ type: 'done', output }])
    const handler = makeDesignEditHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('rename block x to Y', runner))

    expect(result.intent).toBe('design_edit')
    expect(result.status).toBe('ok')
    const payload = result.payload as { actions: unknown[] }
    expect(payload.actions).toHaveLength(1)
    expect((payload.actions[0] as { action: string }).action).toBe('update-node')
  })

  it('Test 4: remove → returns ok with 1 remove-node action', async () => {
    const output = JSON.stringify([{ action: 'remove-node', target_id: 'x' }])
    const runner = new MockRunner([{ type: 'done', output }])
    const handler = makeDesignEditHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('remove block x', runner))

    expect(result.intent).toBe('design_edit')
    expect(result.status).toBe('ok')
    const payload = result.payload as { actions: unknown[] }
    expect(payload.actions).toHaveLength(1)
    expect((payload.actions[0] as { action: string }).action).toBe('remove-node')
  })

  it('Test 5: malformed JSON output → status error mentioning parse', async () => {
    const runner = new MockRunner([{ type: 'done', output: 'this is not json at all' }])
    const handler = makeDesignEditHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('do something', runner))

    expect(result.intent).toBe('design_edit')
    expect(result.status).toBe('error')
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('parse')
  })

  it('Test 6: action with invalid action field → status error mentioning validation', async () => {
    const output = JSON.stringify([{ action: 'teleport-node', target_id: 'x' }])
    const runner = new MockRunner([{ type: 'done', output }])
    const handler = makeDesignEditHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('teleport a node', runner))

    expect(result.intent).toBe('design_edit')
    expect(result.status).toBe('error')
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('Validation failed')
  })

  it('Test 7: timeout → status error mentioning timeout', async () => {
    const runner = new MockRunner([{ type: 'hang' }])
    const handler = makeDesignEditHandler({ runner, timeoutMs: 20 })

    const result = await handler(makeCtx('add a block', runner))

    expect(result.intent).toBe('design_edit')
    expect(result.status).toBe('error')
    expect(result.error).toBeTruthy()
    expect(result.error).toContain('timeout')
    expect(runner.stopAgent).toHaveBeenCalledTimes(1)
  })
})

describe('validateActions', () => {
  it('accepts a valid add-node action', () => {
    const actions = validateActions([{ action: 'add-node', node: { type: 'block', name: 'Auth' } }])
    expect(actions).toHaveLength(1)
    expect(actions[0].action).toBe('add-node')
  })

  it('rejects add-node with invalid type', () => {
    expect(() => validateActions([{ action: 'add-node', node: { type: 'invalid-type' } }])).toThrow('Validation failed')
  })

  it('rejects update-node without target_id', () => {
    expect(() => validateActions([{ action: 'update-node', data: {} }])).toThrow('Validation failed')
  })

  it('rejects add-edge without source', () => {
    expect(() => validateActions([{ action: 'add-edge', edge: { target: 'b' } }])).toThrow('Validation failed')
  })
})
