import { type NodeProps } from '@xyflow/react'
import { BaseNode } from './BaseNode'
import type { ArchitectNodeData } from '@/lib/types'

export function FrontendNode({ data, selected }: NodeProps) {
  return <BaseNode icon="🟩" color="bg-green-600" typeLabel="Frontend" data={data as ArchitectNodeData} selected={selected} />
}
