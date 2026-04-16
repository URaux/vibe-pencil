import { describe, expect, it } from 'vitest'
import { parseOptions } from '@/lib/option-parser'

describe('option-parser', () => {
  it('marks feature and preference lists as multi-select fallback cards', () => {
    const parsed = parseOptions([
      'Which features and integrations matter most?',
      '1. Search',
      '2. Billing',
      '3. SSO',
    ].join('\n'))

    expect(parsed).not.toBeNull()
    expect(parsed?.multi).toBe(true)
  })

  it('keeps either-or fallback lists single-select', () => {
    const parsed = parseOptions([
      'Choose one deployment mode',
      '1. Shared SaaS',
      '2. Single tenant',
    ].join('\n'))

    expect(parsed).not.toBeNull()
    expect(parsed?.multi).toBe(false)
  })
})
