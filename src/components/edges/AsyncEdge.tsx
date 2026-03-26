import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export function AsyncEdge(props: EdgeProps) {
  const [edgePath] = getSmoothStepPath(props)
  return <BaseEdge path={edgePath} markerEnd="url(#arrow)" style={{ stroke: '#94a3b8', strokeDasharray: '5 5' }} />
}
