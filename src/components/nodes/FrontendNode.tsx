import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function FrontendNode({ data, selected }: NodeProps) {
  return (
    <BaseNode
      icon="FE"
      color="bg-emerald-100 text-emerald-700"
      typeLabel="前端"
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
