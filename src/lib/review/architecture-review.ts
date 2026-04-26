/**
 * Architecture review — Phase 3 PR review bot.
 *
 * Library function that takes a DriftReport + IR summary + LLM config,
 * makes ONE LLM call asking for a 3-sentence architectural review of the
 * drift, and returns the review string. Designed to be called from the
 * drift workflow (after the existing comment is built) when the project's
 * policy.yaml opts in via `review.deepAnalyzeOnDrift: true`.
 *
 * Why one LLM call instead of the full deep_analyze 5-perspective fan-out?
 * Cost. PR-time review needs to be cheap enough to run on every PR with
 * drift. The full 5-analyst pipeline is reserved for the on-demand
 * `deep_analyze` chat intent.
 *
 * Direct fetch — no CLI dependency — so this works in vanilla CI runners.
 */

import type { DriftReport } from '@/lib/drift/detect'
import { summarizeDrift } from '@/lib/drift/detect'
import { renderDriftMarkdown } from '@/lib/drift/render'
import type { IrSummary } from '@/lib/orchestrator/types'

export interface ReviewLlmConfig {
  apiBase: string
  apiKey: string
  model: string
}

export interface ArchitectureReviewOptions {
  driftReport: DriftReport
  irSummary: IrSummary
  config: ReviewLlmConfig
  /** Per-call timeout (ms). Default 20000. */
  timeoutMs?: number
  /** Override fetch (for tests). */
  fetchFn?: typeof fetch
}

export interface ArchitectureReviewResult {
  review: string
  modelUsed: string
  durationMs: number
  /** When set, the call short-circuited because there was no drift. */
  skipped?: 'no-drift'
}

const SYSTEM_PROMPT =
  'You are an architecture reviewer for ArchViber. Given a drift report (changes between the diagram-of-record and current code) and an IR summary of the project, output a 3-sentence review covering: (1) what changed, in plain English; (2) the most likely architectural risk; (3) one suggested next step. No preamble, no bullet lists, no markdown headers. Plain prose only.'

export async function runArchitectureReview(
  opts: ArchitectureReviewOptions,
): Promise<ArchitectureReviewResult> {
  const start = Date.now()

  if (opts.driftReport.clean) {
    return {
      review: 'No drift detected; nothing to review.',
      modelUsed: opts.config.model,
      durationMs: Date.now() - start,
      skipped: 'no-drift',
    }
  }

  const summary = summarizeDrift(opts.driftReport)
  const driftMarkdown = renderDriftMarkdown(opts.driftReport)

  const userPrompt = JSON.stringify({
    task: 'review architectural drift',
    irSummary: opts.irSummary,
    summary,
    driftMarkdown,
  })

  const fetchImpl = opts.fetchFn ?? fetch
  const timeoutMs = opts.timeoutMs ?? 20_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(`${opts.config.apiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.config.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      throw new Error(`review LLM HTTP ${res.status}`)
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = body?.choices?.[0]?.message?.content?.trim()
    if (!content) {
      throw new Error('review LLM returned empty content')
    }
    return {
      review: content,
      modelUsed: opts.config.model,
      durationMs: Date.now() - start,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Format the review as a PR-comment-ready section that slots beneath the drift summary. */
export function renderReviewSection(result: ArchitectureReviewResult): string {
  if (result.skipped === 'no-drift') return ''
  return `**Architectural review** _(model: ${result.modelUsed}, ${result.durationMs}ms)_:\n\n${result.review}`
}
