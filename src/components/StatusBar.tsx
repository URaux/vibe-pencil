'use client'

import { useAppStore } from '@/lib/store'
import { agentBackendLabels } from '@/lib/ui-text'

function getBuildLabel(active: boolean, currentWave: number, totalWaves: number) {
  if (!active || totalWaves === 0) {
    return '构建待命'
  }

  return `构建波次 ${currentWave}/${totalWaves}`
}

export function StatusBar() {
  const projectName = useAppStore((state) => state.projectName)
  const saveState = useAppStore((state) => state.saveState)
  const buildState = useAppStore((state) => state.buildState)
  const backend = useAppStore((state) => state.config.agent)

  return (
    <footer className="vp-panel flex flex-wrap items-center justify-between gap-4 border-t border-white/10 px-5 py-3 text-sm text-gray-300">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-white">{projectName}</span>
        <span className="rounded-full border border-white/10 px-2 py-1 text-xs uppercase tracking-wide text-gray-400">
          {saveState === 'saving' ? '保存中...' : '已保存'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-[0.2em] text-gray-400">
        <span>{getBuildLabel(buildState.active, buildState.currentWave, buildState.totalWaves)}</span>
        <span>后端 {agentBackendLabels[backend]}</span>
      </div>
    </footer>
  )
}
