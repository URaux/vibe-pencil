import { describe, expect, it } from 'vitest'
import { extractActionBlocks, extractUserChoices, extractVisibleChatText } from '@/lib/chat-actions'

describe('chat-actions', () => {
  it('extracts visible prose and hides complete canvas action blocks', () => {
    const content = [
      '```json:canvas-action',
      '{"action":"add-node","node":{"id":"n1"}}',
      '```',
      '',
      '这是正常回复。',
    ].join('\n')

    expect(extractVisibleChatText(content)).toBe('这是正常回复。')
    expect(extractActionBlocks(content)).toEqual(['{"action":"add-node","node":{"id":"n1"}}'])
  })

  it('deduplicates repeated action blocks', () => {
    const content = [
      '```json:canvas-action',
      '{"action":"add-node","node":{"id":"n1"}}',
      '```',
      '',
      '```json:canvas-action',
      '{"action":"add-node","node":{"id":"n1"}}',
      '```',
    ].join('\n')

    expect(extractActionBlocks(content)).toEqual(['{"action":"add-node","node":{"id":"n1"}}'])
  })

  it('hides incomplete leading canvas action blocks while streaming', () => {
    const content = [
      '```json:canvas-action',
      '{"action":"update-node","target_id":"n1"',
    ].join('\n')

    expect(extractVisibleChatText(content)).toBe('')
  })

  it('keeps normal prose before an unfinished later block', () => {
    const content = [
      '先说结论。',
      '',
      '```json:canvas-action',
      '{"action":"remove-node","target_id":"n1"',
    ].join('\n')

    expect(extractVisibleChatText(content)).toBe('先说结论。')
  })

  it('collapses duplicated repeated responses', () => {
    const content = [
      'First answer.',
      '',
      '---',
      '',
      'First answer.',
    ].join('\n')

    expect(extractVisibleChatText(content)).toBe('First answer.')
  })

  it('strips hidden progress comments while keeping visible text', () => {
    const content = 'Hello world <!-- progress: dimensions_covered=3/6 round=4/8 --> more text'
    const visible = extractVisibleChatText(content)

    expect(visible).not.toContain('progress:')
    expect(visible).toContain('Hello world')
    expect(visible).toContain('more text')
  })

  it('infers multi-select for preference and stack questions when multi is omitted', () => {
    const content = [
      '```json:user-choice',
      JSON.stringify({
        question: 'Which features and tech stack pieces matter most?',
        options: ['Realtime updates', 'Search', 'Next.js', 'Postgres'],
      }),
      '```',
    ].join('\n')

    expect(extractUserChoices(content)).toEqual([
      {
        question: 'Which features and tech stack pieces matter most?',
        options: ['Realtime updates', 'Search', 'Next.js', 'Postgres'],
        multi: true,
      },
    ])
  })

  it('keeps true either-or questions single-select when multi is omitted', () => {
    const content = [
      '```json:user-choice',
      JSON.stringify({
        question: 'Choose one deployment mode',
        options: ['Single tenant', 'Multi tenant'],
      }),
      '```',
    ].join('\n')

    expect(extractUserChoices(content)).toEqual([
      {
        question: 'Choose one deployment mode',
        options: ['Single tenant', 'Multi tenant'],
      },
    ])
  })
})
