import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function QueueNode({ data, selected }: NodeProps) {
  return (
    <BaseNode
      icon="MQ"
      color="bg-rose-100 text-rose-700"
      typeLabel="消息队列"
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
