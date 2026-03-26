import { Handle, Position } from '@xyflow/react'
import type { ArchitectNodeData } from '@/lib/types'

const statusIcons: Record<string, string> = {
  idle: '⚪',
  building: '🔵',
  done: '🟢',
  error: '🔴',
}

interface BaseNodeProps {
  icon: string
  color: string
  typeLabel: string
  data: ArchitectNodeData
  selected?: boolean
}

export function BaseNode({ icon, color, typeLabel, data, selected }: BaseNodeProps) {
  return (
    <div className={`rounded-lg border-2 bg-gray-800 min-w-[200px] max-w-[280px] shadow-lg ${
      selected ? 'border-blue-400' : 'border-gray-600'
    }`}>
      <Handle type="target" position={Position.Left} className="!bg-gray-400" />
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg ${color}`}>
        <span>{icon}</span>
        <span className="font-semibold text-white text-sm truncate">{data.name || 'Untitled'}</span>
        <span className="ml-auto text-xs bg-black/20 px-1.5 py-0.5 rounded text-white/70">{typeLabel}</span>
      </div>
      <div className="px-3 py-2 text-gray-300 text-xs">
        {data.description || <span className="text-gray-500 italic">Double-click to add description</span>}
      </div>
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-700">
        <span className="text-xs">{statusIcons[data.status]} {data.status}</span>
        {data.summary && <span className="text-xs text-gray-400 truncate ml-2">{data.summary}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-gray-400" />
    </div>
  )
}
