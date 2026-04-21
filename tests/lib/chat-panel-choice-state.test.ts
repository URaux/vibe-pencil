import { describe, expect, it } from 'vitest'
import { resolveChoiceCardState } from '@/components/ChatPanel'

describe('chat panel choice state', () => {
  it('keeps multi-card answers editable while they are only pending', () => {
    const state = resolveChoiceCardState({
      isSending: false,
      isLastAssistant: true,
      isMultiCardTurn: true,
      pendingTrace: { selections: ['Search'], ordered: false },
    })

    expect(state.isAnswered).toBe(true)
    expect(state.disabled).toBe(false)
    expect(state.effectiveTrace?.selections).toEqual(['Search'])
  })

  it('still locks completed single-card answers', () => {
    const state = resolveChoiceCardState({
      isSending: false,
      isLastAssistant: true,
      isMultiCardTurn: false,
      persistedTrace: { selections: ['Search'], ordered: false },
    })

    expect(state.isAnswered).toBe(true)
    expect(state.disabled).toBe(true)
  })
})
