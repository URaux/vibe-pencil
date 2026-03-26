import { type NodeProps } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { ArchitectNodeData } from '@/lib/types'
import { BaseNode } from './BaseNode'

export function ApiNode({ data, selected }: NodeProps) {
  useAppStore((state) => state.locale)

  return (
    <BaseNode
      icon="API"
      color="bg-amber-100 text-amber-700"
      typeLabel={t('api')}
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
