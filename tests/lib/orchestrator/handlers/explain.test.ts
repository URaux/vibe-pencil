import { describe, expect, it } from 'vitest'
import { makeExplainHandler } from '@/lib/orchestrator/handlers/explain'
import { MockRunner } from '../../../_helpers/mock-runner'
import type { HandlerContext, IrSummary, ClassifyResult } from '@/lib/orchestrator/types'
import type { Ir } from '@/lib/ir/schema'

const baseSummary: IrSummary = {
  projectName: 'TestProject',
  blockCount: 4,
  containerCount: 2,
  edgeCount: 3,
  topContainers: [
    { id: 'canvas-editor', name: 'Canvas Editor', blockCount: 2 },
    { id: 'store', name: 'Store', blockCount: 2 },
  ],
  techStacks: ['TypeScript'],
  estimatedTokens: 20,
}

const baseIr: Ir = {
  version: '1.0',
  project: {
    name: 'TestProject',
    metadata: { createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', archviberVersion: '0.1.0' },
  },
  containers: [
    { id: 'canvas-editor', name: 'Canvas Editor', color: 'blue' },
    { id: 'store', name: 'Store', color: 'green' },
  ],
  blocks: [
    {
      id: 'b1',
      name: 'Renderer',
      description: '',
      status: 'idle',
      container_id: 'canvas-editor',
      tech_stack: 'TypeScript',
      code_anchors: [
        {
          primary_entry: 'src/canvas/renderer.ts',
          files: [{ path: 'src/canvas/renderer.ts', symbols: [] }],
        },
      ],
    },
  ],
  edges: [],
  audit_log: [],
  seed_state: {},
}

function makeClassify(): ClassifyResult {
  return { intent: 'explain', confidence: 0.9, rawOutput: '', fallback: false }
}

function makeCtx(prompt: string, runner: MockRunner, withIr = false): HandlerContext {
  return {
    userPrompt: prompt,
    irSummary: baseSummary,
    classifyResult: makeClassify(),
    runner,
    workDir: process.cwd(),
    ...(withIr ? { ir: baseIr } : {}),
  }
}

describe('explain handler', () => {
  it('Test 1: prose mentions Canvas Editor block name → ok with anchorRefs containing Canvas Editor', async () => {
    const prose = 'The Canvas Editor container handles rendering and user interaction for diagram nodes.'
    const runner = new MockRunner([{ type: 'done', output: prose }])
    const handler = makeExplainHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('what does Canvas Editor do?', runner, true))

    expect(result.intent).toBe('explain')
    expect(result.status).toBe('ok')
    const payload = result.payload as { content: string; anchorRefs: string[] }
    expect(payload.content).toBe(prose)
    expect(payload.anchorRefs).toContain('Canvas Editor')
  })

  it('Test 2: prose mentions topContainer names → ok', async () => {
    const prose = 'The Store container manages state, while the Canvas Editor handles the visual layer.'
    const runner = new MockRunner([{ type: 'done', output: prose }])
    const handler = makeExplainHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('summarize the architecture', runner))

    expect(result.intent).toBe('explain')
    expect(result.status).toBe('ok')
    const payload = result.payload as { content: string; anchorRefs: string[] }
    expect(payload.anchorRefs.length).toBeGreaterThanOrEqual(1)
  })

  it('Test 3: prose with NO anchor reference → status error mentioning grounding', async () => {
    const prose = 'This system is complex and has many parts that do various things.'
    const runner = new MockRunner([{ type: 'done', output: prose }])
    const handler = makeExplainHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('explain everything', runner))

    expect(result.intent).toBe('explain')
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/grounding/i)
  })

  it('Test 4: imperative-form forbidden verb at line start → status error mentioning forbidden verb', async () => {
    // Per W1 D10.5 fixup #6: forbidden verb regex only fires on line-leading or sentence-leading
    // imperative form. Mid-prose "should rename" does NOT trigger (false-positive avoidance).
    const prose = 'Rename the Canvas Editor to ClearerEditor for better naming.'
    const runner = new MockRunner([{ type: 'done', output: prose }])
    const handler = makeExplainHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('what does Canvas Editor do?', runner))

    expect(result.intent).toBe('explain')
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/forbidden/i)
  })

  it('Test 4b: prose-mid forbidden verb does NOT trigger (false-positive avoidance)', async () => {
    const prose = 'The Canvas Editor lets you rename blocks via the side panel for usability.'
    const runner = new MockRunner([{ type: 'done', output: prose }])
    const handler = makeExplainHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('what does Canvas Editor do?', runner))

    expect(result.intent).toBe('explain')
    expect(result.status).toBe('ok')
  })

  it('Test 5: empty output → status error mentioning empty', async () => {
    const runner = new MockRunner([{ type: 'done', output: '   ' }])
    const handler = makeExplainHandler({ runner, timeoutMs: 100 })

    const result = await handler(makeCtx('what does Canvas Editor do?', runner))

    expect(result.intent).toBe('explain')
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/empty/i)
  })

  it('Test 6: timeout → status error mentioning timeout', async () => {
    const runner = new MockRunner([{ type: 'hang' }])
    const handler = makeExplainHandler({ runner, timeoutMs: 20 })

    const result = await handler(makeCtx('what does Canvas Editor do?', runner))

    expect(result.intent).toBe('explain')
    expect(result.status).toBe('error')
    expect(result.error).toMatch(/timeout/i)
    expect(runner.stopAgent).toHaveBeenCalledTimes(1)
  })

  it('Test 7: ctx.ir missing → anchors in topContainer names, ok if prose mentions a topContainer', async () => {
    const prose = 'The Store container holds all shared state for the application.'
    const runner = new MockRunner([{ type: 'done', output: prose }])
    const handler = makeExplainHandler({ runner, timeoutMs: 100 })

    // no ir provided
    const result = await handler(makeCtx('describe the store', runner, false))

    expect(result.intent).toBe('explain')
    expect(result.status).toBe('ok')
    const payload = result.payload as { content: string; anchorRefs: string[] }
    expect(payload.anchorRefs).toContain('Store')
  })
})
