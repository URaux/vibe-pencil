import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function DatabaseNode({ data, selected }: NodeProps) {
  return (
    <BaseNode
      icon="DB"
      color="bg-violet-100 text-violet-700"
      typeLabel="数据库"
      data={data as ArchitectNodeData}
      selected={selected}
    />
  )
}
