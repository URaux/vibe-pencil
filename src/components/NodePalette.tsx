'use client'

import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { NodeType } from '@/lib/types'

const paletteItems: Array<{ type: NodeType; labelKey: string; icon: string }> = [
  { type: 'service', labelKey: 'service', icon: 'S' },
  { type: 'frontend', labelKey: 'frontend', icon: 'FE' },
  { type: 'api', labelKey: 'api', icon: 'API' },
  { type: 'database', labelKey: 'database', icon: 'DB' },
  { type: 'queue', labelKey: 'queue', icon: 'Q' },
  { type: 'external', labelKey: 'external', icon: 'EXT' },
]

export function NodePalette() {
  useAppStore((state) => state.locale)

  const onDragStart = (event: React.DragEvent<HTMLButtonElement>, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="vp-panel flex shrink-0 flex-col border-b border-slate-200/80 p-4 text-slate-800 xl:h-full xl:w-56 xl:min-w-[14rem] xl:border-r xl:border-b-0">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{t('nodes')}</h2>
        <p className="mt-1 text-xs text-slate-500">{t('palette_hint')}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-1">
        {paletteItems.map((item) => (
          <button
            key={item.type}
            type="button"
            draggable
            onDragStart={(event) => onDragStart(event, item.type)}
            className="flex w-full cursor-grab items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-orange-300 hover:bg-orange-50/60 active:cursor-grabbing"
          >
            <span className="flex min-w-10 items-center justify-center rounded-xl bg-slate-100 px-2 py-1 text-[10px] font-semibold tracking-wide text-slate-600">
              {item.icon}
            </span>
            <span className="text-sm text-slate-700">{t(item.labelKey)}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
