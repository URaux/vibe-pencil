import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function QueueNode({ data, selected }: NodeProps) {
  return <BaseNode icon="🟥" color="bg-red-600" typeLabel="Queue" data={data as ArchitectNodeData} selected={selected} />
}
