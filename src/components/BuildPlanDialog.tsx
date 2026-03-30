'use client'

import { useEffect } from 'react'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'

interface BuildPlanDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  waves: string[][]
  nodeNames: Map<string, string>
  mode: 'all' | 'selected'
}

export function BuildPlanDialog({
  open,
  onClose,
  onConfirm,
  waves,
  nodeNames,
}: BuildPlanDialogProps) {
  const config = useAppStore((state) => state.config)
  useAppStore((state) => state.locale)

  const totalNodes = waves.reduce((sum, wave) => sum + wave.length, 0)

  // Close on Escape key
  useEffect(() => {
    if (!open) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) {
    return null
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="vp-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-6"
      onClick={handleBackdropClick}
    >
      <div className="vp-dialog-card w-full max-w-lg rounded-[2rem] p-6">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {t('build_plan_title')}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {t('build_plan_subtitle', { count: totalNodes, waves: waves.length })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="vp-button-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em]"
          >
            {t('close')}
          </button>
        </div>

        {/* Config summary */}
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {t('config_summary')}
          </p>
          <div className="space-y-1 text-sm text-slate-700">
            <div className="flex gap-2">
              <span className="w-28 shrink-0 text-slate-500">{t('agent_backend')}</span>
              <span className="font-medium">{config.agent}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-28 shrink-0 text-slate-500">{t('model')}</span>
              <span className="font-medium">{config.model}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-28 shrink-0 text-slate-500">{t('work_directory')}</span>
              <span className="truncate font-medium">{config.workDir}</span>
            </div>
            <div className="flex gap-2">
              <span className="w-28 shrink-0 text-slate-500">{t('max_parallel')}</span>
              <span className="font-medium">{config.maxParallel}</span>
            </div>
          </div>
        </div>

        {/* Wave breakdown */}
        <div className="mb-6 max-h-64 space-y-3 overflow-y-auto">
          {waves.map((wave, index) => {
            const names = wave.map((id) => nodeNames.get(id) ?? id)
            return (
              <div key={index} className="rounded-2xl border border-slate-200 px-4 py-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {t('build_plan_wave', { n: index + 1 })}
                </p>
                <p className="text-sm text-slate-700">{names.join(', ')}</p>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="vp-button-secondary rounded-full px-5 py-2 text-sm"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="vp-button-primary rounded-full px-5 py-2 text-sm"
          >
            {t('start_build')}
          </button>
        </div>
      </div>
    </div>
  )
}
