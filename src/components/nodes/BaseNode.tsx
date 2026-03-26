import { Handle, Position } from '@xyflow/react'
import type { ArchitectNodeData } from '@/lib/types'
import { buildStatusLabels } from '@/lib/ui-text'

const statusClasses: Record<string, string> = {
  idle: 'border-slate-600/70 bg-slate-900 text-slate-300',
  building: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100',
  done: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-100',
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
    <div
      className={`vp-node vp-node--${data.status} min-w-[220px] max-w-[300px] rounded-2xl border-2 bg-slate-900/95 shadow-xl shadow-black/30 ${
        selected ? 'border-blue-400' : 'border-gray-600'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-400" />
      <div className={`flex items-center gap-2 rounded-t-2xl px-3 py-2 ${color}`}>
        <span>{icon}</span>
        <span className="truncate text-sm font-semibold text-white">{data.name || '未命名'}</span>
        <span className="ml-auto rounded-full bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-white/70">
          {typeLabel}
        </span>
      </div>
      <div className="px-3 py-3 text-xs text-gray-300">
        {data.description || <span className="italic text-gray-500">双击添加描述</span>}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2">
        <span
          className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
            statusClasses[data.status]
          }`}
        >
          {buildStatusLabels[data.status]}
        </span>
        {data.summary ? <span className="truncate text-xs text-gray-400">{data.summary}</span> : null}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-gray-400" />
    </div>
  )
}
