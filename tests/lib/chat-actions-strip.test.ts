import { describe, expect, it } from 'vitest'
import { extractVisibleChatText } from '@/lib/chat-actions'

describe('chat-actions progress strip', () => {
  it('strips progress HTML comments from visible text', () => {
    const input = 'Here is my analysis.\n\n<!-- progress: dimensions_covered=3/6 round=4/8 -->'
    const result = extractVisibleChatText(input)

    expect(result).not.toContain('progress:')
    expect(result).not.toContain('dimensions_covered')
    expect(result).toContain('Here is my analysis.')
  })

  it('strips progress with extra whitespace', () => {
    const input = 'Text before <!--  progress:  dimensions_covered=5/6  round=7/8  --> text after'
    const result = extractVisibleChatText(input)

    expect(result).not.toContain('progress:')
    expect(result).toContain('Text before')
    expect(result).toContain('text after')
  })

  it('strips both title and progress comments', () => {
    const input = 'Hello <!-- title: My Project --> world <!-- progress: dimensions_covered=1/6 round=1/8 --> end'
    const result = extractVisibleChatText(input)

    expect(result).not.toContain('title:')
    expect(result).not.toContain('progress:')
    expect(result).toContain('Hello')
    expect(result).toContain('world')
    expect(result).toContain('end')
  })

  it('leaves content intact when no progress comment exists', () => {
    const input = 'Just normal text with no comments.'
    const result = extractVisibleChatText(input)

    expect(result).toBe('Just normal text with no comments.')
  })
})
