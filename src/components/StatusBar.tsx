'use client'

import { useState } from 'react'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import { getAgentBackendLabel } from '@/lib/ui-text'
import { ProgressWidget } from './ProgressWidget'

interface StatusBarProps {
  onOpenSettings: () => void
}

function getBuildLabel(active: boolean, currentWave: number, totalWaves: number) {
  if (!active || totalWaves === 0) {
    return t('idle')
  }

  return `${t('building_wave')} ${currentWave}/${totalWaves}`
}

export function StatusBar({ onOpenSettings }: StatusBarProps) {
  const projectName = useAppStore((state) => state.projectName)
  const setProjectName = useAppStore((state) => state.setProjectName)
  const saveState = useAppStore((state) => state.saveState)
  const buildState = useAppStore((state) => state.buildState)
  const backend = useAppStore((state) => state.config.agent)
  useAppStore((state) => state.locale)
  const [isEditingName, setIsEditingName] = useState(false)
  const [editValue, setEditValue] = useState('')

  return (
    <footer className="vp-panel flex flex-wrap items-center justify-between gap-4 border-t border-slate-200/80 px-5 py-3 text-sm text-slate-600">
      <div className="flex flex-wrap items-center gap-3">
        {isEditingName ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => {
              if (editValue.trim()) setProjectName(editValue.trim())
              setIsEditingName(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (editValue.trim()) setProjectName(editValue.trim())
                setIsEditingName(false)
              }
              if (e.key === 'Escape') setIsEditingName(false)
            }}
            className="w-40 rounded border border-slate-300 bg-white px-2 py-0.5 text-sm font-semibold text-slate-800 focus:border-blue-400 focus:outline-none"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditValue(projectName)
              setIsEditingName(true)
            }}
            className="font-semibold text-slate-800 hover:text-blue-600 hover:underline"
            title="Click to rename"
          >
            {projectName}
          </button>
        )}
        <span
          className={`rounded-full border px-2 py-1 text-xs uppercase tracking-wide ${
            saveState === 'error'
              ? 'border-rose-300 bg-rose-50 text-rose-700'
              : 'border-slate-200 bg-white text-slate-500'
          }`}
        >
          {saveState === 'saving'
            ? t('saving')
            : saveState === 'error'
              ? t('save_failed')
              : t('saved')}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-[0.2em] text-slate-500">
        <ProgressWidget />
        <span>{getBuildLabel(buildState.active, buildState.currentWave, buildState.totalWaves)}</span>
        <span>
          {t('agent_backend')} {getAgentBackendLabel(backend)}
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="vp-button-secondary rounded-full px-3 py-1 text-xs"
        >
          {t('settings')}
        </button>
      </div>
    </footer>
  )
}
