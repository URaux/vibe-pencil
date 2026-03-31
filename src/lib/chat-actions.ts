const CANVAS_ACTION_FENCE = /```json:canvas-action/i
const CANVAS_ACTION_BLOCK = /```json:canvas-action\s*([\s\S]*?)```/gi

export function extractActionBlocks(content: string) {
  const blocks = Array.from(content.matchAll(CANVAS_ACTION_BLOCK), (match) => match[1].trim())

  if (blocks.length === 0 || content.trim().endsWith(blocks[blocks.length - 1])) {
    const rawJsonMatches = content.match(/\{(?:[^{}]|(\{[^{}]*\}))*"action"\s*:\s*"[^"]+"[\s\S]*?(?=\s*```|$)/g)
    if (rawJsonMatches) {
      for (const match of rawJsonMatches) {
        if (!blocks.includes(match.trim())) {
          blocks.push(match.trim())
        }
      }
    }
  }

  return Array.from(
    new Set(blocks.filter((block) => block.includes('"action"') || block.includes("'action'")))
  )
}

function dedupeRepeatedResponse(content: string) {
  const compact = content.replace(/\n{3,}/g, '\n\n').trim()

  // Check if the content is the same text repeated twice (concatenated)
  if (compact.length > 20) {
    const half = Math.floor(compact.length / 2)
    // Try exact half split
    if (compact.slice(0, half).trim() === compact.slice(half).trim()) {
      return compact.slice(0, half).trim()
    }
    // Try splitting by repeated paragraph pattern
    const lines = compact.split('\n')
    if (lines.length >= 4) {
      const halfLines = Math.floor(lines.length / 2)
      const firstHalf = lines.slice(0, halfLines).join('\n').trim()
      const secondHalf = lines.slice(halfLines).join('\n').trim()
      if (firstHalf === secondHalf) {
        return firstHalf
      }
    }
  }

  // Original section-based dedup
  const sections = compact
    .split(/(?:\n\s*-{3,}\s*\n)+|(?:\n\s*){3,}/)
    .map((section) => section.trim())
    .filter(Boolean)

  if (sections.length > 1 && sections.every((section) => section === sections[0])) {
    return sections[0]
  }

  return compact
}

export function extractVisibleChatText(content: string) {
  let visible = ''
  let cursor = 0

  while (cursor < content.length) {
    const remainder = content.slice(cursor)
    const match = remainder.match(CANVAS_ACTION_FENCE)

    if (!match || match.index === undefined) {
      visible += remainder
      break
    }

    const blockStart = cursor + match.index
    visible += content.slice(cursor, blockStart)

    const blockEnd = content.indexOf('```', blockStart + match[0].length)
    if (blockEnd === -1) {
      break
    }

    cursor = blockEnd + 3
    if (!visible.trim()) {
      while (content[cursor] === '\n' || content[cursor] === '\r') {
        cursor += 1
      }
    }
  }

  // Strip hidden title tags and user-choice blocks before returning
  return dedupeRepeatedResponse(visible)
    .replace(/<!--\s*title:\s*.+?\s*-->/g, '')
    .replace(/```json:user-choice[\s\S]*?```/gi, '')
    .trim()
}

export interface UserChoice {
  question: string
  options: string[]
}

export function extractUserChoices(content: string): UserChoice[] {
  const CHOICE_BLOCK = /```json:user-choice\s*([\s\S]*?)```/gi
  const choices: UserChoice[] = []
  for (const match of content.matchAll(CHOICE_BLOCK)) {
    try {
      const parsed = JSON.parse(match[1].trim()) as { question?: string; options?: string[] }
      if (parsed.question && Array.isArray(parsed.options) && parsed.options.length >= 2) {
        choices.push({ question: parsed.question, options: parsed.options })
      }
    } catch { /* skip invalid */ }
  }
  return choices
}
