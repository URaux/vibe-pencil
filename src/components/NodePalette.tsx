'use client'

import type { NodeType } from '@/lib/types'

const paletteItems: Array<{ type: NodeType; label: string; icon: string }> = [
  { type: 'service', label: 'Service', icon: 'S' },
  { type: 'frontend', label: 'Frontend', icon: 'FE' },
  { type: 'api', label: 'API', icon: 'API' },
  { type: 'database', label: 'Database', icon: 'DB' },
  { type: 'queue', label: 'Queue', icon: 'Q' },
  { type: 'external', label: 'External', icon: 'EXT' },
]

export function NodePalette() {
  const onDragStart = (event: React.DragEvent<HTMLButtonElement>, nodeType: NodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="flex h-full w-48 flex-col border-r border-gray-800 bg-gray-900 p-4 text-white">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">Nodes</h2>
        <p className="mt-1 text-xs text-gray-500">Drag onto the canvas to create a new node.</p>
      </div>
      <div className="space-y-2">
        {paletteItems.map((item) => (
          <button
            key={item.type}
            type="button"
            draggable
            onDragStart={(event) => onDragStart(event, item.type)}
            className="flex w-full cursor-grab items-center gap-3 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-left transition hover:border-gray-500 hover:bg-gray-700 active:cursor-grabbing"
          >
            <span className="flex min-w-10 items-center justify-center rounded-md bg-gray-700 px-2 py-1 text-[10px] font-semibold tracking-wide text-gray-200">
              {item.icon}
            </span>
            <span className="text-sm text-gray-100">{item.label}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
