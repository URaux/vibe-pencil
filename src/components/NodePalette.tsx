'use client'

import type { NodeType } from '@/lib/types'

const paletteItems: Array<{ type: NodeType; label: string; icon: string }> = [
  { type: 'service', label: '服务', icon: 'S' },
  { type: 'frontend', label: '前端', icon: 'FE' },
  { type: 'api', label: '接口', icon: 'API' },
  { type: 'database', label: '数据库', icon: 'DB' },
  { type: 'queue', label: '消息队列', icon: 'Q' },
  { type: 'external', label: '外部服务', icon: 'EXT' },
]

export function NodePalette() {
  const onDragStart = (event: React.DragEvent<HTMLButtonElement>, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="vp-panel flex shrink-0 flex-col border-b border-slate-200/80 p-4 text-slate-800 xl:h-full xl:w-56 xl:min-w-[14rem] xl:border-r xl:border-b-0">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">节点</h2>
        <p className="mt-1 text-xs text-slate-500">拖拽到画布即可创建新节点。</p>
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
            <span className="text-sm text-slate-700">{item.label}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
