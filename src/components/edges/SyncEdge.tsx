import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'

export function SyncEdge(props: EdgeProps) {
  const isIntraContainer = props.data?.isIntraContainer === true
  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    ...props,
    borderRadius: 0,
    offset: 24,
  })
  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath(props)
  const edgePath = isIntraContainer ? bezierPath : smoothPath
  const labelX = isIntraContainer ? bezierLabelX : smoothLabelX
  const labelY = isIntraContainer ? bezierLabelY : smoothLabelY

  return (
    <>
      <BaseEdge path={edgePath} markerEnd="url(#arrow)" style={{ stroke: '#94a3b8', strokeWidth: 1.25 }} />
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
