import type { Ir } from '@/lib/ir/schema'
import { serializeIr } from '@/lib/ir/serialize'
import {
  PERSPECTIVE_SECTIONS,
  perspectiveToAgentId,
  type AnalystInput,
  type PerspectiveName,
} from './types'

/**
 * Default total-word cap per perspective. CC subagent replies are returned as
 * a single markdown blob; this cap keeps the aggregator's final report under
 * the LLM context budget when all 5 perspectives merge (5 × 600 = 3000 words
 * plus the orchestrator's synthesis). Configurable per call for unit tests.
 */
export const DEFAULT_WORD_BUDGET = 600

/**
 * Collect every file path referenced by any `code_anchors` entry across the
 * IR's blocks. Deduplicated, order-stable (by first occurrence). Analysts use
 * this list to scope their Read/Grep tools — they MUST NOT scan the whole
 * codebase. Primary_entry strings are included ahead of their sibling files
 * so the most representative anchor is first.
 */
export function collectAnchorPaths(ir: Pick<Ir, 'blocks'>): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  const push = (p: string) => {
    if (p && !seen.has(p)) {
      seen.add(p)
      ordered.push(p)
    }
  }
  for (const block of ir.blocks) {
    for (const anchor of block.code_anchors) {
      if (anchor.primary_entry) push(anchor.primary_entry)
      for (const file of anchor.files) {
        push(file.path)
      }
    }
  }
  return ordered
}

/**
 * Build the AnalystInput envelope passed to a single perspective subagent.
 * The returned shape is stable across perspectives — perspective-specific
 * behavior lives entirely in `.claude/agents/archviber-analyst-<name>.md`
 * (the subagent system prompt). This function is pure; callers stringify
 * the result into the subagent's user message however they want.
 */
export function buildAnalystInput(
  perspective: PerspectiveName,
  ir: Ir,
  projectRoot: string,
  options: { wordBudget?: number } = {},
): AnalystInput {
  return {
    perspective,
    projectRoot,
    irYaml: serializeIr(ir),
    anchorPaths: collectAnchorPaths(ir),
    wordBudget: options.wordBudget ?? DEFAULT_WORD_BUDGET,
  }
}

/**
 * Serialize an AnalystInput into the exact user-message text that gets sent
 * to the subagent. Kept separate from buildAnalystInput so tests can assert
 * the envelope shape without committing to a prose format.
 *
 * The emitted message ends with the 4 expected H2 section titles so the
 * subagent sees the output contract inline even if its system prompt is
 * loaded from a slightly stale `.md` file on disk.
 */
export function renderAnalystMessage(input: AnalystInput): string {
  const sections = PERSPECTIVE_SECTIONS[input.perspective]
  const anchorList = input.anchorPaths.length
    ? input.anchorPaths.map((p) => `- ${p}`).join('\n')
    : '(none — block-level findings only)'
  return [
    `# deep_analyze input — ${perspectiveToAgentId(input.perspective)}`,
    '',
    `Project root: ${input.projectRoot}`,
    `Word budget: ${input.wordBudget}`,
    '',
    '## Expected output — exactly four H2 sections, in this order',
    ...sections.map((title) => `- ## ${title}`),
    '',
    '## Anchor files (read-scope)',
    anchorList,
    '',
    '## IR YAML',
    '```yaml',
    input.irYaml.trimEnd(),
    '```',
    '',
  ].join('\n')
}
