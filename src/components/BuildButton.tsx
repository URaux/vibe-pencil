'use client'

import { useBuildActions } from '@/hooks/useBuildActions'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'

export function BuildButton() {
  const nodes = useAppStore((state) => state.nodes)
  useAppStore((state) => state.locale)
  const { buildAll, buildSelected, isBuilding, selectedCount } = useBuildActions()

  return (
    <div className="flex items-center gap-2">
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={buildSelected}
          disabled={isBuilding}
          className="vp-button-secondary rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('build_selected')} ({selectedCount})
        </button>
      ) : null}
      <button
        type="button"
        onClick={buildAll}
        disabled={nodes.length === 0 || isBuilding}
        className="vp-button-primary rounded-full px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('build_all')}
      </button>
    </div>
  )
}
