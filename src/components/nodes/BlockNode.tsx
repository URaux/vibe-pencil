import { Handle, Position, type NodeProps } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { BlockNodeData, BuildStatus } from '@/lib/types'

const statusDotClasses = {
  idle: 'bg-slate-300',
  waiting: 'bg-slate-200',
  building: 'bg-amber-400 animate-pulse',
  done: 'bg-green-400',
  error: 'bg-red-400',
  blocked: 'bg-slate-300',
} satisfies Record<BuildStatus, string>

const statusNodeClasses: Record<BuildStatus, string> = {
  idle: '',
  waiting: 'vp-node--waiting',
  building: 'vp-node--building',
  done: 'vp-node--done',
  error: 'vp-node--error',
  blocked: 'vp-node--blocked',
}

export function BlockNode({ data, selected }: NodeProps) {
  useAppStore((state) => state.locale)
  const blockData = data as BlockNodeData
  const handleClasses = '!h-2.5 !w-2.5 !bg-slate-300'

  return (
    <div
      className={`relative min-h-[100px] w-[200px] rounded-[8px] border bg-white px-4 py-3 shadow-sm ${
        selected ? 'border-orange-300' : 'border-slate-200'
      } ${statusNodeClasses[blockData.status]}`}
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
        {blockData.status === 'building' && blockData.summary ? (
          <div className="mt-1 truncate text-[10px] text-slate-400">
            {blockData.summary}
          </div>
        ) : null}
        {blockData.status === 'blocked' ? (
          <div className="mt-1 inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-400">
            {t('blocked_status')}
          </div>
        ) : null}
      </div>
      {blockData.status === 'building' ? (
        <span className="absolute bottom-3 right-3 vp-spinner" />
      ) : blockData.status === 'done' ? (
        <span className="absolute bottom-3 right-3 vp-checkmark-pop">
          <svg className="h-3 w-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      ) : blockData.status === 'error' ? (
        <span className="absolute bottom-3 right-3" title={blockData.errorMessage}>
          <svg className="h-3 w-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
      ) : (
        <span
          className={`absolute bottom-3 right-3 h-2.5 w-2.5 rounded-full ${statusDotClasses[blockData.status]}`}
          aria-label={blockData.status}
        />
      )}
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
