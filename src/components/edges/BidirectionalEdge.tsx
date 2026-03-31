import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'
import { routeCrossContainerEdge, type ContainerBox } from '@/lib/edge-routing'

function getContainerBox(
  nodeId: string | undefined,
  nodeMap: Map<string, { position: { x: number; y: number }; style?: React.CSSProperties }>
): ContainerBox | null {
  if (!nodeId) return null
  const node = nodeMap.get(nodeId)
  if (!node) return null
  const w = typeof node.style?.width === 'number' ? node.style.width : 0
  const h = typeof node.style?.height === 'number' ? node.style.height : 0
  if (w === 0 || h === 0) return null
  return { x: node.position.x, y: node.position.y, width: w, height: h }
}

export function BidirectionalEdge(props: EdgeProps) {
  const { getNodes } = useReactFlow()

  const isIntraContainer = props.data?.isIntraContainer as boolean | undefined

  let edgePath: string
  let labelX: number
  let labelY: number

  if (!isIntraContainer) {
    const nodes = getNodes()
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))

    const sourceNode = nodeMap.get(props.source)
    const targetNode = nodeMap.get(props.target)

    const sourceContainer = getContainerBox(
      sourceNode?.parentId,
      nodeMap as Map<string, { position: { x: number; y: number }; style?: React.CSSProperties }>
    )
    const targetContainer = getContainerBox(
      targetNode?.parentId,
      nodeMap as Map<string, { position: { x: number; y: number }; style?: React.CSSProperties }>
    )

    const result = routeCrossContainerEdge(
      props.sourceX,
      props.sourceY,
      props.sourceHandleId,
      props.targetX,
      props.targetY,
      props.targetHandleId,
      sourceContainer,
      targetContainer
    )

    if (result) {
      edgePath = result.path
      labelX = result.labelX
      labelY = result.labelY
    } else {
      const [p] = getSmoothStepPath({ ...props, borderRadius: 10 })
      edgePath = p
      labelX = (props.sourceX ?? 0) * 0.4 + (props.targetX ?? 0) * 0.6
      labelY = (props.sourceY ?? 0) * 0.4 + (props.targetY ?? 0) * 0.6
    }
  } else {
    const [p] = getSmoothStepPath({ ...props, borderRadius: 10 })
    edgePath = p
    labelX = (props.sourceX ?? 0) * 0.4 + (props.targetX ?? 0) * 0.6
    labelY = (props.sourceY ?? 0) * 0.4 + (props.targetY ?? 0) * 0.6
  }

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd="url(#arrow)"
        markerStart="url(#arrow-reverse)"
        style={{ stroke: '#94a3b8', strokeWidth: 1.25 }}
      />
      {props.label ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              zIndex: 1000,
            }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
