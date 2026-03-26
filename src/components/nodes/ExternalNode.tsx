import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function ExternalNode({ data, selected }: NodeProps) {
  return (
    <BaseNode
      icon="EXT"
      color="bg-gray-600"
      typeLabel="外部服务"
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
