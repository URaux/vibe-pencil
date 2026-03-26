import { type NodeProps } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { ArchitectNodeData } from '@/lib/types'
import { BaseNode } from './BaseNode'

export function DatabaseNode({ data, selected }: NodeProps) {
  useAppStore((state) => state.locale)

  return (
    <BaseNode
      icon="DB"
      color="bg-violet-100 text-violet-700"
      typeLabel={t('database')}
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
