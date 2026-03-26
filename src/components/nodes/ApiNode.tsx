import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function ApiNode({ data, selected }: NodeProps) {
  return <BaseNode icon="🟧" color="bg-orange-600" typeLabel="API" data={data as ArchitectNodeData} selected={selected} />
}
