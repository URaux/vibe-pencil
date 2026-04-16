interface ParsedOption {
  number: string
  text: string
}

export interface ParsedOptions {
  options: ParsedOption[]
  textBefore: string
  textAfter: string
}

export function parseOptions(content: string): ParsedOptions | null {
  // Match numbered options like:
  // 1. Option text (may span multiple lines)
  // 2、Option text
  // 1) Option text
  const lines = content.split('\n')
  const optionStartPattern = /^\s*(\d+)[.、．)\s]+\s*(.+)$/

  let firstOptionIndex = -1
  let lastOptionIndex = -1
  const options: ParsedOption[] = []
  const optionStartLines: number[] = []

  // First pass: find all option start lines
  for (let i = 0; i < lines.length; i++) {
    const match = optionStartPattern.exec(lines[i])
    if (match) {
      if (firstOptionIndex === -1) firstOptionIndex = i
      lastOptionIndex = i
      optionStartLines.push(i)
      // Collect continuation lines (indented or until next option/blank paragraph)
      let fullText = match[2].trim()
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]
        // Stop at next option, blank line, or non-indented line
        if (!nextLine.trim() || optionStartPattern.test(nextLine)) break
        // Continuation line (indented or just wrapped text)
        fullText += ' ' + nextLine.trim()
        lastOptionIndex = j
      }
      options.push({ number: match[1], text: fullText })
    }
  }

  // Need at least 2 options to trigger card rendering
  if (options.length < 2) return null

  // Check options are roughly in the same region
  const optionLineSpan = lastOptionIndex - firstOptionIndex + 1
  if (optionLineSpan > options.length * 4) return null

  const textBefore = lines.slice(0, firstOptionIndex).join('\n').trim()
  const textAfter = lines.slice(lastOptionIndex + 1).join('\n').trim()

  // Strip markdown formatting from textBefore for decision detection
  const plainTextBefore = textBefore.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
  // Check if this looks like a decision prompt vs an informational list
  const isDecision = /[？?]\s*$/.test(plainTextBefore) ||
    /哪[种个些里]|选择|偏好|确认|决策|回答|模式|什么|怎[么样]|prefer|choose|which|what.*want|decide|confirm/i.test(plainTextBefore)
  const isInfoList = /包含|包括|如下|组成|涵盖|contain|include|consist/i.test(plainTextBefore) &&
    !/选择|确认|决策|choose|confirm|decide|哪/i.test(plainTextBefore)

  if ((!isDecision) || isInfoList) return null

  // Filter out items that look like questions (not selectable options)
  const actualOptions = options.filter(o => !/[？?]\s*$/.test(o.text.trim()))

  // Need at least 2 actual options after filtering
  if (actualOptions.length < 2) return null

  // Strip markdown formatting from option text for cleaner card display
  const cleanOptions = actualOptions.map(o => {
    const cleaned = o.text
      .replace(/\*\*(.+?)\*\*/g, '$1')  // remove bold
      .replace(/\s*[—–-]\s*.*$/, '')     // remove description after em dash (keep label only)
      .trim()
    // max 60 chars for card text; add ellipsis when truncated so it doesn't look like a render bug
    const text = cleaned.length > 60 ? cleaned.slice(0, 59) + '\u2026' : cleaned
    return { number: o.number, text }
  })

  return { options: cleanOptions, textBefore, textAfter }
}
