import { describe, expect, it, vi } from 'vitest'
import { runArchitectureReview, renderReviewSection } from '@/lib/review/architecture-review'
import type { DriftReport } from '@/lib/drift/detect'
import type { IrSummary } from '@/lib/orchestrator/types'

const cleanReport: DriftReport = {
  addedBlocks: [],
  removedBlocks: [],
  changedBlocks: [],
  addedContainers: [],
  removedContainers: [],
  addedEdges: [],
  removedEdges: [],
  clean: true,
}

const driftedReport: DriftReport = {
  ...cleanReport,
  clean: false,
  addedBlocks: [
    {
      id: 'auth',
      name: 'Auth',
      description: '',
      status: 'idle',
      container_id: 'api',
      code_anchors: [],
    },
  ],
}

const irSummary: IrSummary = {
  projectName: 'TestProject',
  blockCount: 5,
  containerCount: 2,
  edgeCount: 3,
  topContainers: [{ id: 'api', name: 'API', blockCount: 3 }],
  techStacks: ['TypeScript'],
  estimatedTokens: 30,
}

const config = { apiBase: 'https://fake.example.com/v1', apiKey: 'k', model: 'gpt-fake' }

function mockOk(content: string) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('runArchitectureReview', () => {
  it('short-circuits when drift is clean', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    const result = await runArchitectureReview({
      driftReport: cleanReport,
      irSummary,
      config,
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(result.skipped).toBe('no-drift')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('calls the LLM and returns the review content', async () => {
    const reviewText =
      'A new Auth block was added under the API container. ' +
      'The main risk is that authentication logic now lives outside the audited code-anchors. ' +
      'Confirm the new block has explicit code_anchors before merging.'
    const fetchFn = mockOk(reviewText)

    const result = await runArchitectureReview({
      driftReport: driftedReport,
      irSummary,
      config,
      fetchFn: fetchFn as unknown as typeof fetch,
    })

    expect(result.skipped).toBeUndefined()
    expect(result.review).toBe(reviewText)
    expect(result.modelUsed).toBe('gpt-fake')
    expect(fetchFn).toHaveBeenCalledTimes(1)

    const callArgs = (fetchFn.mock.calls as unknown as Array<[string, RequestInit]>)[0]
    const url = callArgs[0]
    expect(url).toContain('https://fake.example.com/v1/chat/completions')
    const body = JSON.parse(callArgs[1].body as string)
    expect(body.model).toBe('gpt-fake')
    expect(body.messages[0].content).toMatch(/architecture reviewer/)
    expect(body.messages[1].content).toContain('"task":"review architectural drift"')
  })

  it('throws on non-ok HTTP response', async () => {
    const fetchFn = vi.fn(async () => new Response('boom', { status: 500 }))
    await expect(
      runArchitectureReview({
        driftReport: driftedReport,
        irSummary,
        config,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 500/)
  })

  it('throws on empty content', async () => {
    const fetchFn = mockOk('   ')
    await expect(
      runArchitectureReview({
        driftReport: driftedReport,
        irSummary,
        config,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/empty content/)
  })
})

describe('renderReviewSection', () => {
  it('returns empty string when skipped', () => {
    const md = renderReviewSection({ review: 'x', modelUsed: 'm', durationMs: 1, skipped: 'no-drift' })
    expect(md).toBe('')
  })

  it('renders model + duration + content', () => {
    const md = renderReviewSection({
      review: 'A 3-sentence review.',
      modelUsed: 'gpt-fake',
      durationMs: 1234,
    })
    expect(md).toContain('Architectural review')
    expect(md).toContain('gpt-fake')
    expect(md).toContain('1234ms')
    expect(md).toContain('A 3-sentence review.')
  })
})
