import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function ApiNode({ data, selected }: NodeProps) {
  return (
    <BaseNode
      icon="API"
      color="bg-orange-600"
      typeLabel="接口"
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
