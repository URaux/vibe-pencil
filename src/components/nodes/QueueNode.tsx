import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function QueueNode({ data, selected }: NodeProps) {
  return (
    <BaseNode
      icon="MQ"
      color="bg-red-600"
      typeLabel="消息队列"
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
