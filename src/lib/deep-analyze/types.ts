import type { Ir } from '@/lib/ir/schema'

/**
 * Canonical deep_analyze perspective names. Each perspective is a separate
 * analyst subagent with its own system prompt (see .claude/agents/) and a
 * fixed output contract. W3.D1 locks this set in place before W3.D2 builds
 * the parallel runner on top.
 */
export const PERSPECTIVE_NAMES = [
  'architect',
  'redteam',
  'reproducibility',
  'static',
  'product',
] as const

export type PerspectiveName = (typeof PERSPECTIVE_NAMES)[number]

/** Short human-readable label shown in UI / logs. */
export const PERSPECTIVE_LABELS: Record<PerspectiveName, string> = {
  architect: 'Architecture health',
  redteam: 'Security red-team',
  reproducibility: 'Reproducibility / ops',
  static: 'Static quality',
  product: 'Product slice',
}

/**
 * Each perspective commits to exactly four H2 sections in its markdown output.
 * Downstream aggregation and eval harness assertions key on these strings.
 */
export const PERSPECTIVE_SECTIONS: Record<PerspectiveName, readonly [string, string, string, string]> = {
  architect: [
    'Layering violations',
    'Coupling hotspots',
    'Missing abstractions',
    'Blast radius assessment',
  ],
  redteam: [
    'Attack surface',
    'Trust boundary violations',
    'Secrets and credentials exposure',
    'Auth/authz gaps',
  ],
  reproducibility: [
    'Environment coupling',
    'Non-determinism',
    'Observability gaps',
    'Deployment fragility',
  ],
  static: [
    'Dead code candidates',
    'Type safety gaps',
    'Test coverage holes',
    'Complexity outliers',
  ],
  product: [
    'Feature completeness',
    'User journey gaps',
    'Missing feedback loops',
    'UX-visible technical debt',
  ],
}

/** The name convention mapped back to the `.claude/agents/<subagent>.md` id. */
export function perspectiveToAgentId(name: PerspectiveName): string {
  return `archviber-analyst-${name}`
}

/**
 * Fixed envelope passed to every analyst subagent as the user message body.
 * Analysts read ONLY what's in `irYaml` plus the file list derived from
 * `code_anchors` — the prompt-builder below produces this structure.
 */
export interface AnalystInput {
  perspective: PerspectiveName
  projectRoot: string
  irYaml: string
  anchorPaths: string[]
  wordBudget: number
}

/** Expected output contract — what an analyst subagent must produce. */
export interface AnalystReport {
  perspective: PerspectiveName
  markdown: string
}

export type IrForPrompt = Pick<Ir, 'project' | 'containers' | 'blocks' | 'edges'>
