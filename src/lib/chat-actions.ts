const CANVAS_ACTION_FENCE = /```(?:json)?(?::canvas-action)?/i
const CANVAS_ACTION_BLOCK = /```(?:json)?(?::canvas-action)?\s*([\s\S]*?)```/gi

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

  return dedupeRepeatedResponse(visible)
}
