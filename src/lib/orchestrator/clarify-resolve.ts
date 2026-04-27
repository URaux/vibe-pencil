/**
 * Clarify-response resolver — phase3/orchestrator-clarify-classify.
 *
 * When the previous assistant turn was a clarify message ("did you mean a, b,
 * c, d, or e?"), the user's reply is often just "a", "the first one", or the
 * intent label itself. This module detects those patterns and short-circuits
 * the full classifier.
 *
 * The clarify message always uses this fixed mapping:
 *   (a) edit the design   → design_edit
 *   (b) build/run         → build
 *   (c) modify a block    → modify
 *   (d) deep-analyze      → deep_analyze
 *   (e) get an explanation → explain
 */

import type { Intent } from './types'
import { INTENTS } from './types'

// ---------------------------------------------------------------------------
// Letter / ordinal / label maps
// ---------------------------------------------------------------------------

const LETTER_TO_INTENT: Record<string, Intent> = {
  a: 'design_edit',
  b: 'build',
  c: 'modify',
  d: 'deep_analyze',
  e: 'explain',
}

const ORDINAL_TO_INTENT: Record<string, Intent> = {
  first: 'design_edit',
  second: 'build',
  third: 'modify',
  fourth: 'deep_analyze',
  fifth: 'explain',
  '1st': 'design_edit',
  '2nd': 'build',
  '3rd': 'modify',
  '4th': 'deep_analyze',
  '5th': 'explain',
}

// Maps intent label strings to their Intent value
const LABEL_TO_INTENT: Record<string, Intent> = Object.fromEntries(
  INTENTS.map((i) => [i, i]),
) as Record<string, Intent>

// ---------------------------------------------------------------------------
// Core resolution logic
// ---------------------------------------------------------------------------

/**
 * Attempt to resolve a user reply to an intent when the last turn was a clarify.
 *
 * Returns the resolved `Intent` if the reply matches a known pattern, or `null`
 * if it cannot be confidently resolved (caller should fall back to classify).
 */
export function resolveClarifyReply(userReply: string): Intent | null {
  const trimmed = userReply.trim()

  // Reject multi-word replies that don't match ordinals — too ambiguous
  const words = trimmed.toLowerCase().split(/\s+/)

  // Single letter: "a", "b", "c", "d", "e"
  if (words.length === 1) {
    const word = words[0]

    // Letter match
    if (LETTER_TO_INTENT[word]) return LETTER_TO_INTENT[word]

    // Intent label match (e.g. "build", "explain", "modify")
    if (LABEL_TO_INTENT[word]) return LABEL_TO_INTENT[word]

    // Ordinal match (e.g. "first", "second")
    if (ORDINAL_TO_INTENT[word]) return ORDINAL_TO_INTENT[word]
  }

  // Two-word phrases: "the first", "option a", "choice b", "option one"
  if (words.length === 2) {
    const [prefix, key] = words
    const isArticle = prefix === 'the' || prefix === 'option' || prefix === 'choice'
    if (isArticle) {
      if (LETTER_TO_INTENT[key]) return LETTER_TO_INTENT[key]
      if (ORDINAL_TO_INTENT[key]) return ORDINAL_TO_INTENT[key]
      if (LABEL_TO_INTENT[key]) return LABEL_TO_INTENT[key]
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Context check
// ---------------------------------------------------------------------------

export interface LastTurnContext {
  /** The intent of the last assistant turn. 'clarify' when it was a clarify message. */
  lastAssistantIntent: string | null
}

/**
 * Returns true when the last assistant turn was a clarify response and the
 * current user reply can be resolved to a specific intent.
 */
export function shouldShortCircuit(
  context: LastTurnContext,
  userReply: string,
): boolean {
  if (context.lastAssistantIntent !== 'clarify') return false
  return resolveClarifyReply(userReply) !== null
}
