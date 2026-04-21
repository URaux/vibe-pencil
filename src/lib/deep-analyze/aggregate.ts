import { PERSPECTIVE_LABELS, PERSPECTIVE_NAMES } from './types'
import type { PerspectiveRunResult } from './runner'

export function aggregateReports(
  results: PerspectiveRunResult[],
  opts: { projectName?: string } = {}
): string {
  const projectName = opts.projectName?.trim() || 'Untitled project'
  const byPerspective = new Map(results.map((result) => [result.perspective, result]))
  const successCount = results.filter((result) => result.status === 'success').length

  const lines = [
    `# Deep analysis — ${projectName}`,
    '',
    `${successCount}/5 perspectives succeeded`,
  ]

  for (const perspective of PERSPECTIVE_NAMES) {
    const result = byPerspective.get(perspective)
    lines.push('', `## ${PERSPECTIVE_LABELS[perspective]}`, '')

    if (result?.status === 'success') {
      lines.push(result.markdown.trim() || 'No issues found.')
      continue
    }

    lines.push(`> Analyst failed: ${result?.errorMessage ?? 'Unknown error'}`)
  }

  return lines.join('\n').trim()
}
