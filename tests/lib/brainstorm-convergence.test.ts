import { describe, expect, it } from 'vitest'
import { buildSystemContext } from '@/lib/context-engine'

type Locale = 'en' | 'zh'

function buildBrainstormContext(
  locale: Locale,
  brainstormRound?: number,
  sessionPhase: 'brainstorm' | 'design' = 'brainstorm'
) {
  return buildSystemContext({
    agentType: 'canvas',
    task: 'discuss',
    locale,
    sessionPhase,
    brainstormRound,
  })
}

describe('buildSystemContext brainstorm convergence', () => {
  it('round 1 with no history stays in exploration mode', () => {
    const context = buildBrainstormContext('en', 1)

    expect(context).toContain('You must cover these 6 dimensions')
    expect(context).toContain('This is round 1 of 8')
    expect(context).toContain('1 question per turn')
    // The prompt mentions "Do NOT generate any ```json:canvas-action" as a prohibition,
    // but should NOT contain the full canvas-action instruction block (add-node examples etc.)
    expect(context).toContain('Do NOT generate any ```json:canvas-action')
    expect(context).not.toContain('Put ALL ```json:canvas-action blocks FIRST')
  })

  it('round 6 is still in exploration mode', () => {
    const context = buildBrainstormContext('en', 6)

    expect(context).toContain('You must cover these 6 dimensions')
    expect(context).toContain('This is round 6 of 8')
    expect(context).toContain('1 question per turn')
    expect(context).not.toContain('Do NOT ask any more questions')
  })

  it('round 7 switches into summarization mode', () => {
    const context = buildBrainstormContext('en', 7)

    expect(context).toContain('This is round 7 of 8')
    expect(context).toMatch(/summarize|CRITICAL/i)
    expect(context).not.toContain('Progress through dimensions in order')
  })

  it('round 8 forces a conclusion', () => {
    const context = buildBrainstormContext('en', 8)

    expect(context).toContain('Round 8 reached')
    expect(context).toMatch(/Do NOT ask|Start Designing/i)
    expect(context).not.toContain('1 question per turn')
  })

  it('rounds beyond the limit keep force-conclude behavior', () => {
    const context = buildBrainstormContext('en', 10)

    expect(context).toMatch(/Do NOT ask|Start Designing/i)
    expect(context).not.toContain('1 question per turn')
  })

  it('undefined brainstormRound behaves like round 1', () => {
    const context = buildBrainstormContext('en')

    expect(context).toContain('This is round 1 of 8')
    expect(context).toContain('1 question per turn')
  })

  it('design phase uses canvas-action instructions instead of brainstorm dimensions', () => {
    const context = buildBrainstormContext('en', 1, 'design')

    expect(context).not.toContain('You must cover these 6 dimensions')
    expect(context).toContain('```json:canvas-action')
    expect(context).toContain('Put ALL ```json:canvas-action blocks FIRST')
  })

  it('uses locale-appropriate round 7 convergence text', () => {
    const zhContext = buildBrainstormContext('zh', 7)
    const enContext = buildBrainstormContext('en', 7)

    expect(enContext).toContain('This is round 7 of 8')
    expect(enContext).toMatch(/summarize|CRITICAL/i)
    expect(zhContext).not.toContain('This is round 7 of 8')
    expect(zhContext).toMatch(/[\u4e00-\u9fff]/)
    expect(zhContext).toMatch(/总结|关键|确认方案|设计阶段|轮/u)
  })
})
