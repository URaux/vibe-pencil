'use client'

import { useAppStore } from '@/lib/store'

function getBuildLabel(active: boolean, currentWave: number, totalWaves: number) {
  if (!active || totalWaves === 0) {
    return 'Build idle'
  }

  return `Building wave ${currentWave}/${totalWaves}`
}

export function StatusBar() {
  const projectName = useAppStore((state) => state.projectName)
  const saveState = useAppStore((state) => state.saveState)
  const buildState = useAppStore((state) => state.buildState)
  const backend = useAppStore((state) => state.config.agent)

  return (
    <footer className="flex items-center justify-between gap-4 border-t border-gray-800 bg-gray-950/95 px-5 py-3 text-sm text-gray-300">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-white">{projectName}</span>
        <span className="rounded-full border border-gray-700 px-2 py-1 text-xs uppercase tracking-wide text-gray-400">
          {saveState === 'saving' ? 'Saving...' : 'Saved'}
        </span>
      </div>
      <div className="flex items-center gap-4 text-xs uppercase tracking-[0.2em] text-gray-400">
        <span>{getBuildLabel(buildState.active, buildState.currentWave, buildState.totalWaves)}</span>
        <span>{backend}</span>
      </div>
    </footer>
  )
}
