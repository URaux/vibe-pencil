import fs from 'fs'
import path from 'path'
import { INTENTS } from '@/lib/orchestrator/types'
import type { Intent, IrSummary } from '@/lib/orchestrator/types'

export interface EvalFixture {
  id: string
  userPrompt: string
  expectedIntent: Intent
  irSummary: IrSummary
}

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/intents.jsonl')

export function loadFixtures(filePath = FIXTURE_PATH): EvalFixture[] {
  const raw = fs.readFileSync(filePath, 'utf8')
  const fixtures: EvalFixture[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    // skip blanks and comment lines
    if (!trimmed || trimmed.startsWith('//')) continue

    const parsed = JSON.parse(trimmed) as Record<string, unknown>

    if (typeof parsed.id !== 'string') throw new Error(`Fixture missing 'id': ${trimmed}`)
    if (typeof parsed.userPrompt !== 'string') throw new Error(`Fixture ${parsed.id}: missing 'userPrompt'`)
    if (!INTENTS.includes(parsed.expectedIntent as Intent)) {
      throw new Error(`Fixture ${parsed.id}: invalid expectedIntent '${String(parsed.expectedIntent)}'`)
    }
    if (!parsed.irSummary || typeof parsed.irSummary !== 'object') {
      throw new Error(`Fixture ${parsed.id}: missing 'irSummary'`)
    }

    fixtures.push({
      id: parsed.id,
      userPrompt: parsed.userPrompt,
      expectedIntent: parsed.expectedIntent as Intent,
      irSummary: parsed.irSummary as IrSummary,
    })
  }

  return fixtures
}
