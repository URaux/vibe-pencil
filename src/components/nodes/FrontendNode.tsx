import { type NodeProps } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { ArchitectNodeData } from '@/lib/types'
import { BaseNode } from './BaseNode'

export function FrontendNode({ data, selected }: NodeProps) {
  useAppStore((state) => state.locale)

  return (
    <BaseNode
      icon="FE"
      color="bg-emerald-100 text-emerald-700"
      typeLabel={t('frontend')}
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
