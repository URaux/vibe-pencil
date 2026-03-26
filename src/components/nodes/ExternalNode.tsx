import { type NodeProps } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { ArchitectNodeData } from '@/lib/types'
import { BaseNode } from './BaseNode'

export function ExternalNode({ data, selected }: NodeProps) {
  useAppStore((state) => state.locale)

  return (
    <BaseNode
      icon="EXT"
      color="bg-slate-200 text-slate-700"
      typeLabel={t('external')}
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
