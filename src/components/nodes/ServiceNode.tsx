import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function ServiceNode({ data, selected }: NodeProps) {
  return <BaseNode icon="🟦" color="bg-blue-600" typeLabel="Service" data={data as ArchitectNodeData} selected={selected} />
}
