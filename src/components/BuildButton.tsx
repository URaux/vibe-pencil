'use client'

import { useState } from 'react'
import { BuildPlanDialog } from '@/components/BuildPlanDialog'
import { useBuildActions } from '@/hooks/useBuildActions'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'

export function BuildButton() {
  const nodes = useAppStore((state) => state.nodes)
  useAppStore((state) => state.locale)
  const { buildAll, buildSelected, computeBuildPlan, isBuilding, selectedCount } = useBuildActions()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [buildPlan, setBuildPlan] = useState<ReturnType<typeof computeBuildPlan>>(null)
  const [pendingMode, setPendingMode] = useState<'all' | 'selected'>('all')

  function handleBuildAll() {
    const plan = computeBuildPlan('all')
    if (plan) {
      setBuildPlan(plan)
      setPendingMode('all')
      setDialogOpen(true)
    }
  }

  function handleBuildSelected() {
    const plan = computeBuildPlan('selected')
    if (plan) {
      setBuildPlan(plan)
      setPendingMode('selected')
      setDialogOpen(true)
    }
  }

  function handleConfirm() {
    setDialogOpen(false)
    if (pendingMode === 'selected') {
      buildSelected()
    } else {
      buildAll()
    }
  }

  return (
    <div className="flex items-center gap-2">
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={handleBuildSelected}
          disabled={isBuilding}
          className="vp-button-secondary rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('build_selected')} ({selectedCount})
        </button>
      ) : null}
      <button
        type="button"
        onClick={handleBuildAll}
        disabled={nodes.length === 0 || isBuilding}
        className="vp-button-primary rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('build_all')}
      </button>

      <BuildPlanDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleConfirm}
        waves={buildPlan?.waves ?? []}
        nodeNames={buildPlan?.nodeNames ?? new Map()}
        mode={pendingMode}
      />
    </div>
  )
}
