/**
 * Conversation history compressor.
 *
 * Rolling LLM summary + hot-window:
 *   - If estimated history tokens exceed TOKEN_THRESHOLD, summarize all older
 *     messages into a single paragraph via a cheap LLM call, keep the last
 *     KEEP_RECENT_TURNS user/assistant pairs verbatim.
 *   - Output shape is a single formatted string compatible with the existing
 *     `conversationHistory` field in the 7-layer context engine.
 *
 * This module is intentionally stateless — the summary is recomputed each
 * turn the threshold is crossed. The cost of one small LLM call per "long"
 * request is negligible with DeepSeek-class models (~$0.001/call), and the
 * statelessness keeps the server side trivially scalable.
 *
 * Design notes for interview:
 *   - Why LLM summary over RAG over chat history?
 *       RAG fragments the conversation; a summary preserves the narrative arc.
 *   - Why rolling (summary only of older messages), not full recompress?
 *       Recent turns carry the tightest semantic dependency with the new user
 *       message — lossy compression there loses the most value.
 *   - Why keep 6 recent turns, not more?
 *       6 turns ≈ 3 user/assistant pairs, which is the typical horizon for
 *       coreference and "as we discussed above" kinds of references.
 *   - Why not use the main agent backend to summarize?
 *       Summaries should be cheap and bounded; routing through a CLI subprocess
 *       would add seconds of cold-start. Direct HTTP via streamChat is faster.
 */

import { streamChat, type LlmConfig } from './llm-client'

export interface CompressorChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface CompressOptions {
  /** Threshold in estimated tokens above which compression kicks in. */
  tokenThreshold?: number
  /** How many most-recent messages to keep verbatim (not summarized). */
  keepRecentMessages?: number
  /** Direct-API LLM config used for the summarization call. */
  llmConfig?: LlmConfig
  /** Abort signal forwarded to the summarizer LLM request. */
  signal?: AbortSignal
}

export interface CompressedHistory {
  /** Final formatted string to feed into the context engine. */
  formatted: string
  /** True iff compression actually ran (LLM summary was produced). */
  compressed: boolean
  /** Estimated token count of the original history (before compression). */
  originalTokens: number
  /** Estimated token count of the output string (after compression). */
  compressedTokens: number
}

const DEFAULT_THRESHOLD = 6000      // Trigger compression past ~6k tokens
const DEFAULT_KEEP_RECENT = 6       // Last 6 messages kept verbatim (≈3 turns)

/** Fast char-based token estimator (OpenAI-ish, 4 chars per token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function formatMessages(messages: CompressorChatMessage[]): string {
  return messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n\n')
}

const SUMMARY_SYSTEM_PROMPT = [
  'You are a conversation summarizer for an AI architecture design platform.',
  'You will be given an older segment of a user/assistant chat about software architecture.',
  'Produce a concise summary that preserves:',
  '  1) architectural decisions the user committed to (what to build, what to cut, module splits),',
  '  2) open questions still unresolved,',
  '  3) alternatives that were explicitly rejected and why,',
  '  4) any schema / data model shape the user converged on.',
  'Do NOT include pleasantries, self-references, or meta-commentary.',
  'Output at most ~250 words of plain prose, no bullet headers, no markdown.',
].join('\n')

async function summarizeSegment(
  messages: CompressorChatMessage[],
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<string> {
  const transcript = formatMessages(messages)
  const user = [
    'Summarize the following earlier discussion:',
    '',
    transcript,
  ].join('\n')

  let summary = ''
  for await (const chunk of streamChat(
    SUMMARY_SYSTEM_PROMPT,
    [{ role: 'user', content: user }],
    config,
    signal,
  )) {
    summary += chunk
  }
  return summary.trim()
}

/**
 * Compress a chat history into a single formatted string suitable for the
 * 7-layer context engine's `conversationHistory` slot.
 *
 * Behavior:
 *   - If the estimated tokens of the joined history ≤ threshold, returns the
 *     uncompressed formatted string verbatim (compressed=false).
 *   - Else, splits history into (older, recent); summarizes `older` via LLM;
 *     returns `"## Summary of earlier discussion\n<summary>\n\n## Recent messages\n<recent>"`.
 *   - If no `llmConfig` is provided or the summarizer call fails, falls back
 *     to a head-and-tail slice so behavior is never worse than before.
 */
export async function compressHistory(
  history: CompressorChatMessage[] | undefined,
  options: CompressOptions = {},
): Promise<CompressedHistory> {
  const {
    tokenThreshold = DEFAULT_THRESHOLD,
    keepRecentMessages = DEFAULT_KEEP_RECENT,
    llmConfig,
    signal,
  } = options

  if (!history || history.length === 0) {
    return { formatted: 'No prior conversation.', compressed: false, originalTokens: 0, compressedTokens: 0 }
  }

  const rawFormatted = formatMessages(history)
  const originalTokens = estimateTokens(rawFormatted)

  if (originalTokens <= tokenThreshold || history.length <= keepRecentMessages) {
    return { formatted: rawFormatted, compressed: false, originalTokens, compressedTokens: originalTokens }
  }

  const splitIndex = history.length - keepRecentMessages
  const older = history.slice(0, splitIndex)
  const recent = history.slice(splitIndex)

  // Summarize older segment via LLM, with graceful fallback on failure.
  let summary: string
  if (llmConfig) {
    try {
      summary = await summarizeSegment(older, llmConfig, signal)
      if (!summary) throw new Error('Empty summary returned')
    } catch (err) {
      console.warn('[history-compressor] LLM summarize failed, falling back to head-tail slice:', err)
      summary = fallbackHeadTail(older)
    }
  } else {
    summary = fallbackHeadTail(older)
  }

  const formatted = [
    '## Summary of earlier discussion',
    '',
    summary,
    '',
    '## Recent messages',
    '',
    formatMessages(recent),
  ].join('\n')

  return {
    formatted,
    compressed: true,
    originalTokens,
    compressedTokens: estimateTokens(formatted),
  }
}

/**
 * Offline fallback when no LLM config is available (e.g., local dev without
 * VIBE_LLM_API_KEY). Returns a deterministic head-tail slice of the older
 * segment so at least *some* compression happens.
 */
function fallbackHeadTail(older: CompressorChatMessage[]): string {
  const headTurns = older.slice(0, 2)
  const tailTurns = older.slice(-4)
  const head = formatMessages(headTurns)
  const tail = formatMessages(tailTurns)
  const omitted = Math.max(0, older.length - headTurns.length - tailTurns.length)
  return [
    '(LLM summarizer unavailable — head/tail slice fallback; ' + omitted + ' middle messages omitted)',
    '',
    head,
    '',
    '...',
    '',
    tail,
  ].join('\n')
}
