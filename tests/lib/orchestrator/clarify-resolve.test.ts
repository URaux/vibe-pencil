import { describe, expect, it } from 'vitest'
import { resolveClarifyReply, shouldShortCircuit } from '../../../src/lib/orchestrator/clarify-resolve'
import type { LastTurnContext } from '../../../src/lib/orchestrator/clarify-resolve'

describe('resolveClarifyReply', () => {
  it('Test 1: single letter a → design_edit', () => {
    expect(resolveClarifyReply('a')).toBe('design_edit')
  })

  it('Test 2: single letter b → build', () => {
    expect(resolveClarifyReply('b')).toBe('build')
  })

  it('Test 3: single letter c → modify', () => {
    expect(resolveClarifyReply('c')).toBe('modify')
  })

  it('Test 4: single letter d → deep_analyze', () => {
    expect(resolveClarifyReply('d')).toBe('deep_analyze')
  })

  it('Test 5: single letter e → explain', () => {
    expect(resolveClarifyReply('e')).toBe('explain')
  })

  it('Test 6: ordinal "first" → design_edit', () => {
    expect(resolveClarifyReply('first')).toBe('design_edit')
  })

  it('Test 7: ordinal "second" → build', () => {
    expect(resolveClarifyReply('second')).toBe('build')
  })

  it('Test 8: ordinal "third" → modify', () => {
    expect(resolveClarifyReply('third')).toBe('modify')
  })

  it('Test 9: ordinal "fourth" → deep_analyze', () => {
    expect(resolveClarifyReply('fourth')).toBe('deep_analyze')
  })

  it('Test 10: ordinal "fifth" → explain', () => {
    expect(resolveClarifyReply('fifth')).toBe('explain')
  })

  it('Test 11: intent label "build" → build', () => {
    expect(resolveClarifyReply('build')).toBe('build')
  })

  it('Test 12: intent label "explain" → explain', () => {
    expect(resolveClarifyReply('explain')).toBe('explain')
  })

  it('Test 13: "the first" → design_edit', () => {
    expect(resolveClarifyReply('the first')).toBe('design_edit')
  })

  it('Test 14: "option b" → build', () => {
    expect(resolveClarifyReply('option b')).toBe('build')
  })

  it('Test 15: whitespace trimmed — "  a  " → design_edit', () => {
    expect(resolveClarifyReply('  a  ')).toBe('design_edit')
  })

  it('Test 16: ambiguous long reply → null', () => {
    expect(resolveClarifyReply('I want to do something with the code')).toBeNull()
  })

  it('Test 17: empty string → null', () => {
    expect(resolveClarifyReply('')).toBeNull()
  })

  it('Test 18: letter "f" (out of range) → null', () => {
    expect(resolveClarifyReply('f')).toBeNull()
  })
})

describe('shouldShortCircuit', () => {
  const clarifyCtx: LastTurnContext = { lastAssistantIntent: 'clarify' }
  const regularCtx: LastTurnContext = { lastAssistantIntent: 'build' }
  const nullCtx: LastTurnContext = { lastAssistantIntent: null }

  it('Test 19: clarify ctx + resolvable reply → true', () => {
    expect(shouldShortCircuit(clarifyCtx, 'a')).toBe(true)
  })

  it('Test 20: clarify ctx + unresolvable reply → false', () => {
    expect(shouldShortCircuit(clarifyCtx, 'what do you mean?')).toBe(false)
  })

  it('Test 21: non-clarify ctx + resolvable reply → false', () => {
    expect(shouldShortCircuit(regularCtx, 'b')).toBe(false)
  })

  it('Test 22: null intent ctx + resolvable reply → false', () => {
    expect(shouldShortCircuit(nullCtx, 'c')).toBe(false)
  })
})
