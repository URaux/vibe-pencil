import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'

export function AsyncEdge(props: EdgeProps) {
  const isIntraContainer = props.data?.isIntraContainer === true
  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    ...props,
    borderRadius: 8,
    offset: 12,
  })
  const [straightPath, straightLabelX, straightLabelY] = getStraightPath(props)
  const edgePath = isIntraContainer ? straightPath : smoothPath
  const labelX = isIntraContainer ? straightLabelX : smoothLabelX
  const labelY = isIntraContainer ? straightLabelY : smoothLabelY

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd="url(#arrow)"
        style={{ stroke: '#94a3b8', strokeWidth: 1.25, strokeDasharray: '5 5' }}
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
