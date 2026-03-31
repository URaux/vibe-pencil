// Server-side build state that survives client reconnections.
// When the page refreshes during a build, the SSE connection drops.
// This module keeps the last-known build progress in memory so the
// client can call GET /api/agent/build-state to restore it on mount.

export interface BuildProgress {
  active: boolean
  waves: string[][]
  currentWave: number
  nodeStatuses: Record<string, 'idle' | 'building' | 'done' | 'error'>
  startedAt: number
}

let currentBuild: BuildProgress | null = null

export function setBuildProgress(progress: BuildProgress | null): void {
  currentBuild = progress
}

export function getBuildProgress(): BuildProgress | null {
  return currentBuild
}
