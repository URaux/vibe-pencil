'use client'

import { useBuildActions } from '@/hooks/useBuildActions'
import { useAppStore } from '@/lib/store'

export function BuildButton() {
  const nodes = useAppStore((state) => state.nodes)
  const { buildAll, buildSelected, isBuilding, selectedCount } = useBuildActions()

  return (
    <div className="flex items-center gap-2">
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={buildSelected}
          disabled={isBuilding}
          className="rounded-full border border-cyan-500/60 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Build Selected ({selectedCount})
        </button>
      ) : null}
      <button
        type="button"
        onClick={buildAll}
        disabled={nodes.length === 0 || isBuilding}
        className="rounded-full border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Build All
      </button>
    </div>
  )
}
