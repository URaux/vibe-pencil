import { type NodeProps } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { ArchitectNodeData } from '@/lib/types'
import { BaseNode } from './BaseNode'

export function ServiceNode({ data, selected }: NodeProps) {
  useAppStore((state) => state.locale)

  return (
    <BaseNode
      icon="S"
      color="bg-sky-100 text-sky-700"
      typeLabel={t('service')}
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
