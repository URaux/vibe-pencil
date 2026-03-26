import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export function BidirectionalEdge(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath(props)
  return <BaseEdge path={edgePath} markerEnd="url(#arrow)" markerStart="url(#arrow-reverse)" style={{ stroke: '#94a3b8' }} />
}
