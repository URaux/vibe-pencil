'use client'

import { useAppStore } from '@/lib/store'
import { agentBackendLabels } from '@/lib/ui-text'

interface StatusBarProps {
  onOpenSettings: () => void
}

function getBuildLabel(active: boolean, currentWave: number, totalWaves: number) {
  if (!active || totalWaves === 0) {
    return '未开始'
  }

  return `构建波次 ${currentWave}/${totalWaves}`
}

export function StatusBar({ onOpenSettings }: StatusBarProps) {
  const projectName = useAppStore((state) => state.projectName)
  const saveState = useAppStore((state) => state.saveState)
  const buildState = useAppStore((state) => state.buildState)
  const backend = useAppStore((state) => state.config.agent)

  return (
    <footer className="vp-panel flex flex-wrap items-center justify-between gap-4 border-t border-slate-200/80 px-5 py-3 text-sm text-slate-600">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold text-slate-800">{projectName}</span>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs uppercase tracking-wide text-slate-500">
          {saveState === 'saving' ? '保存中...' : '已保存'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-[0.2em] text-slate-500">
        <span>{getBuildLabel(buildState.active, buildState.currentWave, buildState.totalWaves)}</span>
        <span>后端 {agentBackendLabels[backend]}</span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="vp-button-secondary rounded-full px-3 py-1 text-xs"
        >
          设置
        </button>
      </div>
    </footer>
  )
}
