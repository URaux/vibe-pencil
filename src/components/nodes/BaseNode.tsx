import { Handle, Position } from '@xyflow/react'
import type { ArchitectNodeData } from '@/lib/types'
import { buildStatusLabels } from '@/lib/ui-text'

const statusClasses: Record<string, string> = {
  idle: 'border-slate-200 bg-slate-50 text-slate-500',
  building: 'border-orange-200 bg-orange-50 text-orange-700',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
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
      className={`vp-node vp-node--${data.status} min-w-[220px] max-w-[300px] rounded-3xl border bg-white shadow-xl shadow-slate-200/70 ${
        selected ? 'border-orange-300' : 'border-slate-200'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-300" />
      <div className={`flex items-center gap-2 rounded-t-[1.4rem] px-3 py-2.5 ${color}`}>
        <span>{icon}</span>
        <span className="truncate text-sm font-semibold">{data.name || '未命名'}</span>
        <span className="ml-auto rounded-full bg-white/65 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-current/70">
          {typeLabel}
        </span>
      </div>
      <div className="px-3 py-3 text-xs leading-5 text-slate-600">
        {data.description || <span className="italic text-slate-400">双击添加描述</span>}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <span
          className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
            statusClasses[data.status]
          }`}
        >
          {buildStatusLabels[data.status]}
        </span>
        {data.summary ? <span className="truncate text-xs text-slate-400">{data.summary}</span> : null}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-slate-300" />
    </div>
  )
}
