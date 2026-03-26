import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function DatabaseNode({ data, selected }: NodeProps) {
  return <BaseNode icon="🟪" color="bg-purple-600" typeLabel="Database" data={data as ArchitectNodeData} selected={selected} />
}
