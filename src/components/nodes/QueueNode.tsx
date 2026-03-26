import { type NodeProps } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { ArchitectNodeData } from '@/lib/types'
import { BaseNode } from './BaseNode'

export function QueueNode({ data, selected }: NodeProps) {
  useAppStore((state) => state.locale)

  return (
    <BaseNode
      icon="MQ"
      color="bg-rose-100 text-rose-700"
      typeLabel={t('queue')}
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
