/**
 * run-eval-live.mjs — Phase 3 live-LLM eval.
 *
 * Runs the orchestrator classifier against the existing fixture set using a
 * REAL LLM (via direct HTTP, no CLI dependency) instead of the MockRunner.
 * Captures per-fixture pass/fail + overall accuracy. Used by the weekly
 * GH Actions cron to detect classifier regression as the prompt or model
 * changes.
 *
 * Required env (any OpenAI-compatible endpoint):
 *   VIBE_LLM_API_BASE   e.g. https://api.openai.com/v1
 *   VIBE_LLM_API_KEY    bearer token
 *   VIBE_LLM_MODEL      e.g. gpt-4o-mini, deepseek-chat, claude-haiku
 *
 * Optional:
 *   EVAL_LIVE_OUT       output JSON path (default: eval-live-results.json)
 *   EVAL_LIVE_FAIL_AT   fraction below which to exit 1 (default: 0.8)
 *   EVAL_LIVE_TIMEOUT   per-call timeout ms (default: 15000)
 *
 * Always writes the JSON snapshot. Exits 1 only when accuracy < EVAL_LIVE_FAIL_AT
 * and CI explicitly opted in via --enforce.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import jiti from '../node_modules/jiti/lib/jiti.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const apiBase = process.env.VIBE_LLM_API_BASE
const apiKey = process.env.VIBE_LLM_API_KEY
const model = process.env.VIBE_LLM_MODEL
if (!apiBase || !apiKey || !model) {
  console.error('run-eval-live: missing required env (VIBE_LLM_API_BASE, VIBE_LLM_API_KEY, VIBE_LLM_MODEL)')
  process.exit(1)
}

const outPath = process.env.EVAL_LIVE_OUT ?? path.join(repoRoot, 'eval-live-results.json')
const failAt = Number(process.env.EVAL_LIVE_FAIL_AT ?? '0.8')
const timeoutMs = Number(process.env.EVAL_LIVE_TIMEOUT ?? '15000')
const enforce = process.argv.includes('--enforce')

const require = jiti(__filename, {
  alias: { '@': path.join(repoRoot, 'src') },
  interopDefault: true,
})

const { loadFixtures } = require(path.join(repoRoot, 'tests/eval/orchestrator/load-fixtures.ts'))
const { INTENTS } = require(path.join(repoRoot, 'src/lib/orchestrator/types.ts'))

const SYSTEM_PROMPT = [
  'You are an intent classifier for ArchViber.',
  'Choose exactly one intent from: design_edit, build, modify, deep_analyze, explain.',
  'Return ONLY minified JSON with keys intent, confidence, rationale.',
  'confidence must be a number from 0 to 1.',
  'rationale must be 15 words or fewer.',
  'No markdown, no code fences, no extra text.',
].join(' ')

async function classifyOne(fixture) {
  const userPrompt = JSON.stringify({
    task: 'Classify the user request into one ArchViber intent.',
    userPrompt: fixture.userPrompt,
    irSummary: fixture.irSummary ?? null,
    allowedIntents: INTENTS,
    outputFormat: { intent: 'one allowed intent', confidence: 'number 0..1', rationale: '<=15 words' },
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }
    const body = await res.json()
    const content = body?.choices?.[0]?.message?.content ?? ''
    const m = /\{[\s\S]*\}/.exec(content)
    if (!m) return { ok: false, error: 'no JSON in response', raw: content }
    let parsed
    try {
      parsed = JSON.parse(m[0])
    } catch {
      return { ok: false, error: 'JSON parse fail', raw: content }
    }
    if (!INTENTS.includes(parsed.intent)) {
      return { ok: false, error: `invalid intent: ${parsed.intent}`, raw: content }
    }
    return { ok: true, intent: parsed.intent, confidence: parsed.confidence ?? 0 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  console.log(`[eval-live] model=${model} failAt=${failAt} enforce=${enforce}`)
  const fixtures = loadFixtures()
  console.log(`[eval-live] loaded ${fixtures.length} fixtures`)

  const perFixture = []
  let pass = 0
  for (const f of fixtures) {
    const result = await classifyOne(f)
    const matched = result.ok && result.intent === f.expectedIntent
    if (matched) pass++
    perFixture.push({
      id: f.id,
      expected: f.expectedIntent,
      actual: result.ok ? result.intent : null,
      confidence: result.ok ? result.confidence : null,
      ok: matched,
      error: result.ok ? undefined : result.error,
    })
    process.stdout.write(matched ? '.' : 'x')
  }
  process.stdout.write('\n')

  const accuracy = fixtures.length === 0 ? 0 : pass / fixtures.length
  const byIntent = {}
  for (const i of INTENTS) byIntent[i] = { total: 0, pass: 0 }
  for (let i = 0; i < fixtures.length; i++) {
    const intent = fixtures[i].expectedIntent
    byIntent[intent].total++
    if (perFixture[i].ok) byIntent[intent].pass++
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    model,
    apiBase,
    fixtures: fixtures.length,
    pass,
    accuracy,
    byIntent,
    perFixture,
  }
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8')
  console.log(`[eval-live] accuracy=${(accuracy * 100).toFixed(1)}% (${pass}/${fixtures.length}) → ${outPath}`)

  if (enforce && accuracy < failAt) {
    console.error(`[eval-live] accuracy ${accuracy.toFixed(2)} < failAt ${failAt} — exiting 1 (--enforce)`)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('[eval-live] fatal:', err)
  process.exit(1)
})
