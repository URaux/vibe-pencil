import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function ApiNode({ data, selected }: NodeProps) {
  return (
    <BaseNode
      icon="API"
      color="bg-amber-100 text-amber-700"
      typeLabel="接口"
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
