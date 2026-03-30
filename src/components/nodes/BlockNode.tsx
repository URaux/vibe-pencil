import { Handle, Position, type NodeProps } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { BlockNodeData } from '@/lib/types'

const statusDotClasses = {
  idle: 'bg-slate-300',
  building: 'bg-amber-400 animate-pulse',
  done: 'bg-green-400',
  error: 'bg-red-400',
} satisfies Record<BlockNodeData['status'], string>

export function BlockNode({ data, selected }: NodeProps) {
  useAppStore((state) => state.locale)
  const blockData = data as BlockNodeData
  const handleClasses = '!h-2.5 !w-2.5 !bg-slate-300'

  return (
    <div
      className={`relative min-h-[100px] w-[200px] rounded-[8px] border bg-white px-4 py-3 shadow-sm ${
        selected ? 'border-orange-300' : 'border-slate-200'
      }`}
    >
      <Handle id="t-top" type="target" position={Position.Top} className={handleClasses} />
      <Handle id="t-bottom" type="target" position={Position.Bottom} className={handleClasses} />
      <Handle
        id="t-left"
        type="target"
        position={Position.Left}
        className={handleClasses}
        style={{ top: '50%' }}
      />
      <Handle
        id="t-right"
        type="target"
        position={Position.Right}
        className={handleClasses}
        style={{ top: '50%' }}
      />
      <div className="pr-5">
        <div className="text-[14px] font-semibold text-slate-900">
          {blockData.name || t('block')}
        </div>
        <div className="mt-1 text-[11px] leading-4 text-slate-400">
          {blockData.description || t('double_click_desc')}
        </div>
        {blockData.techStack ? (
          <div className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            {blockData.techStack}
          </div>
        ) : null}
      </div>
      <span
        className={`absolute bottom-3 right-3 h-2.5 w-2.5 rounded-full ${statusDotClasses[blockData.status]}`}
        aria-label={blockData.status}
      />
      <Handle id="s-top" type="source" position={Position.Top} className={handleClasses} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} className={handleClasses} />
      <Handle
        id="s-left"
        type="source"
        position={Position.Left}
        className={handleClasses}
        style={{ top: '50%' }}
      />
      <Handle
        id="s-right"
        type="source"
        position={Position.Right}
        className={handleClasses}
        style={{ top: '50%' }}
      />
    </div>
  )
}
