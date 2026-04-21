import { describe, expect, it } from 'vitest'
import { aggregateReports } from '@/lib/deep-analyze/aggregate'
import { PERSPECTIVE_LABELS, PERSPECTIVE_NAMES, type PerspectiveName } from '@/lib/deep-analyze'
import type { PerspectiveRunResult } from '@/lib/deep-analyze/runner'

function success(perspective: PerspectiveName): PerspectiveRunResult {
  return {
    perspective,
    status: 'success',
    markdown: `${perspective} findings\n\nok`,
    durationMs: 10,
  }
}

function failure(
  perspective: PerspectiveName,
  status: 'error' | 'timeout' = 'error'
): PerspectiveRunResult {
  return {
    perspective,
    status,
    markdown: '',
    errorMessage: `${perspective} ${status}`,
    durationMs: 10,
  }
}

describe('deep-analyze/aggregate', () => {
  it('renders five successful sections and success summary', () => {
    const markdown = aggregateReports(PERSPECTIVE_NAMES.map(success))

    expect(markdown).toContain('5/5 perspectives succeeded')
    for (const perspective of PERSPECTIVE_NAMES) {
      expect(markdown).toContain(`## ${PERSPECTIVE_LABELS[perspective]}`)
    }
  })

  it('renders mixed success and failure callouts', () => {
    const markdown = aggregateReports([
      success('architect'),
      success('redteam'),
      success('reproducibility'),
      failure('static'),
      failure('product', 'timeout'),
    ])

    expect(markdown).toContain('3/5 perspectives succeeded')
    expect((markdown.match(/^> Analyst failed:/gm) ?? []).length).toBe(2)
  })

  it('renders zero successes when all analysts fail', () => {
    const markdown = aggregateReports(PERSPECTIVE_NAMES.map((perspective) => failure(perspective)))

    expect(markdown).toContain('0/5 perspectives succeeded')
    expect((markdown.match(/^> Analyst failed:/gm) ?? []).length).toBe(5)
  })

  it('uses the provided project name in the header', () => {
    const markdown = aggregateReports(PERSPECTIVE_NAMES.map(success), { projectName: 'ArchViber' })

    expect(markdown).toContain('ArchViber')
  })
})
