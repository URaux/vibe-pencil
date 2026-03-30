import type { NodeTypes } from '@xyflow/react'
import { BlockNode } from './BlockNode'
import { ContainerNode } from './ContainerNode'

export const nodeTypes: NodeTypes = {
  container: ContainerNode,
  block: BlockNode,
}
