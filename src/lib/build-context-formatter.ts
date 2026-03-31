import type { Node } from '@xyflow/react'
import type { BuildStatus, BlockNodeData, BuildSummary } from './types'

interface BuildStateSnapshot {
  active: boolean
  currentWave: number
  totalWaves: number
  waves: string[][]
  startedAt?: number
  completedAt?: number
  nodeTimings: Record<string, { startedAt?: number; finishedAt?: number }>
  blockedNodes: Record<string, string>
  targetNodeIds: string[]
}

/**
 * Format current build state + node statuses into a text block
 * suitable for injection into L3 context (buildSummaryContext).
 *
 * Returns null if no build is active and no recent build completed.
 * Output is capped at ~2000 chars to avoid eating the chat context window.
 */
export function formatBuildContext(
  buildState: BuildStateSnapshot,
  nodes: Node[],
  buildOutputLog: Record<string, string>
): string | null {
  const targetNodeIds = buildState.targetNodeIds

  if (!buildState.active && !buildState.completedAt) return null
  if (targetNodeIds.length === 0) return null

  const lines: string[] = []
  const elapsed = buildState.startedAt
    ? Math.floor(((buildState.completedAt ?? Date.now()) - buildState.startedAt) / 1000)
    : 0

  if (buildState.active) {
    lines.push(`## Live Build Status (in progress)`)
    lines.push(`Wave ${buildState.currentWave}/${buildState.totalWaves} | Elapsed: ${elapsed}s`)
  } else {
    lines.push(`## Recent Build Result`)
    lines.push(`Completed in ${elapsed}s total`)
  }

  lines.push('')

  // When there are many nodes, only show error/building nodes plus a summary of the rest
  const errorAndBuildingIds = targetNodeIds.filter((id) => {
    const node = nodes.find((n) => n.id === id)
    const status = (node?.data as BlockNodeData | undefined)?.status
    return status === 'error' || status === 'building' || status === 'blocked'
  })

  const doneCount = targetNodeIds.filter((id) => {
    const node = nodes.find((n) => n.id === id)
    return (node?.data as BlockNodeData | undefined)?.status === 'done'
  }).length

  const waitingCount = targetNodeIds.filter((id) => {
    const node = nodes.find((n) => n.id === id)
    const status = (node?.data as BlockNodeData | undefined)?.status
    return status === 'waiting' || status === 'idle'
  }).length

  // Show summary counts when there are many nodes (20+)
  const showSummaryOnly = targetNodeIds.length >= 20

  if (showSummaryOnly) {
    lines.push(`Nodes: ${doneCount} done, ${errorAndBuildingIds.length} active/failed, ${waitingCount} waiting (${targetNodeIds.length} total)`)
    lines.push('')
  }

  // Always show the table for manageable counts, or just errors/building for large sets
  const idsToShow = showSummaryOnly ? errorAndBuildingIds : targetNodeIds

  if (idsToShow.length > 0) {
    lines.push('| Node | Status | Duration | Details |')
    lines.push('|------|--------|----------|---------|')

    for (const nodeId of idsToShow) {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node || node.type !== 'block') continue

      const data = node.data as BlockNodeData
      const name = data.name || nodeId
      const status: BuildStatus = data.status ?? 'idle'
      const timing = buildState.nodeTimings[nodeId]

      let duration = '-'
      if (timing?.startedAt && timing?.finishedAt) {
        duration = `${Math.round((timing.finishedAt - timing.startedAt) / 1000)}s`
      } else if (timing?.startedAt) {
        duration = `${Math.round((Date.now() - timing.startedAt) / 1000)}s (running)`
      }

      let detail = ''
      if (status === 'error') {
        const blockedBy = buildState.blockedNodes[nodeId]
        if (blockedBy) {
          const blocker = nodes.find((n) => n.id === blockedBy)
          detail = `Blocked by ${(blocker?.data as BlockNodeData | undefined)?.name || blockedBy}`
        } else {
          const output = buildOutputLog[nodeId] ?? ''
          const lastLine = output.split(/\r?\n/).filter(Boolean).at(-1)
          detail = lastLine ? lastLine.slice(0, 120) : (data.errorMessage?.slice(0, 120) ?? 'Unknown error')
        }
      } else if (status === 'blocked') {
        const blockedBy = buildState.blockedNodes[nodeId]
        if (blockedBy) {
          const blocker = nodes.find((n) => n.id === blockedBy)
          detail = `Blocked by ${(blocker?.data as BlockNodeData | undefined)?.name || blockedBy}`
        }
      } else if (status === 'done') {
        const summary = data.buildSummary as BuildSummary | undefined
        if (summary) {
          detail = `${summary.filesCreated.length} files`
          if (summary.dependencies.length > 0) {
            detail += `, deps: ${summary.dependencies.slice(0, 3).join(', ')}`
          }
        }
      } else if (status === 'building') {
        const output = buildOutputLog[nodeId] ?? ''
        const lastLine = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1)
        detail = lastLine ? lastLine.slice(0, 80) : 'Starting...'
      }

      const statusIcon: Record<BuildStatus, string> = {
        done: 'DONE',
        error: 'ERROR',
        building: 'BUILDING',
        waiting: 'WAITING',
        blocked: 'BLOCKED',
        idle: 'IDLE',
      }

      lines.push(`| ${name} | ${statusIcon[status] ?? status} | ${duration} | ${detail} |`)
    }
  }

  const result = lines.join('\n')

  // Hard cap at 2000 chars to protect context window budget
  if (result.length > 2000) {
    return result.slice(0, 1997) + '...'
  }

  return result
}
