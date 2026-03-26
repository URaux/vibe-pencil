import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function ExternalNode({ data, selected }: NodeProps) {
  return (
    <BaseNode
      icon="EXT"
      color="bg-slate-200 text-slate-700"
      typeLabel="外部服务"
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
