/**
 * IR summary pruner — phase3/dispatch-context-pruner.
 *
 * Trims an IrSummary so its JSON-stringified form fits within a token budget
 * before it is sent to the classifier. Strategy:
 *   1. Truncate techStacks to top 5.
 *   2. Sort topContainers by blockCount descending, then slice to top-N.
 *   3. Reduce N until JSON.stringify fits maxTokens (rough 1 token ≈ 4 chars).
 */

import type { IrSummary } from './types'

const MAX_TECH_STACKS = 5
const CHARS_PER_TOKEN = 4

export function pruneIrSummary(summary: IrSummary, maxTokens = 600): IrSummary {
  const maxChars = maxTokens * CHARS_PER_TOKEN

  const techStacks = summary.techStacks.slice(0, MAX_TECH_STACKS)

  // Sort containers by blockCount desc so we keep the most populated ones
  const sortedContainers = summary.topContainers
    .slice()
    .sort((a, b) => b.blockCount - a.blockCount)

  // Binary-search the max number of containers that fits the budget
  let lo = 0
  let hi = sortedContainers.length

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    const candidate: IrSummary = { ...summary, techStacks, topContainers: sortedContainers.slice(0, mid) }
    if (JSON.stringify(candidate).length <= maxChars) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }

  return {
    ...summary,
    techStacks,
    topContainers: sortedContainers.slice(0, lo),
  }
}
