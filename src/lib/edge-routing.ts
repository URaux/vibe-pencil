/**
 * Container-aware edge routing for cross-container edges.
 *
 * Routing strategy:
 *   source handle → exit point (container edge + margin) →
 *   horizontal/vertical inter-container segment →
 *   entry point (target container edge + margin) → target handle
 *
 * Corners are rounded with SVG quadratic bezier (Q command).
 */

export interface ContainerBox {
  x: number
  y: number
  width: number
  height: number
}

export interface RouteResult {
  path: string
  labelX: number
  labelY: number
}

type Side = 'top' | 'bottom' | 'left' | 'right'

function parseSide(handle: string | null | undefined): Side {
  if (!handle) return 'right'
  if (handle.includes('top')) return 'top'
  if (handle.includes('bottom')) return 'bottom'
  if (handle.includes('left')) return 'left'
  return 'right'
}

/** Exit/entry direction vector for a given side. */
function sideVector(side: Side): { dx: number; dy: number } {
  switch (side) {
    case 'top':    return { dx: 0,  dy: -1 }
    case 'bottom': return { dx: 0,  dy:  1 }
    case 'left':   return { dx: -1, dy:  0 }
    case 'right':  return { dx:  1, dy:  0 }
  }
}

/** Returns the absolute coordinate of the container's edge on the given side. */
function containerEdgeCoord(box: ContainerBox, side: Side): number {
  switch (side) {
    case 'top':    return box.y
    case 'bottom': return box.y + box.height
    case 'left':   return box.x
    case 'right':  return box.x + box.width
  }
}

/**
 * Build a rounded-corner SVG path segment through a sequence of points.
 * Each interior corner is replaced by a quadratic bezier with the given radius.
 */
function buildRoundedPath(pts: { x: number; y: number }[], r: number): string {
  if (pts.length < 2) return ''

  const parts: string[] = [`M ${pts[0].x} ${pts[0].y}`]

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    const next = i < pts.length - 1 ? pts[i + 1] : null

    if (!next) {
      // Last point — straight line to end
      parts.push(`L ${curr.x} ${curr.y}`)
      continue
    }

    // Direction into corner and out of corner
    const inDx = curr.x - prev.x
    const inDy = curr.y - prev.y
    const outDx = next.x - curr.x
    const outDy = next.y - curr.y

    const inLen = Math.sqrt(inDx * inDx + inDy * inDy)
    const outLen = Math.sqrt(outDx * outDx + outDy * outDy)

    if (inLen < 1 || outLen < 1) {
      parts.push(`L ${curr.x} ${curr.y}`)
      continue
    }

    const clampedR = Math.min(r, inLen / 2, outLen / 2)

    const beforeX = curr.x - (inDx / inLen) * clampedR
    const beforeY = curr.y - (inDy / inLen) * clampedR
    const afterX  = curr.x + (outDx / outLen) * clampedR
    const afterY  = curr.y + (outDy / outLen) * clampedR

    parts.push(`L ${beforeX} ${beforeY}`)
    parts.push(`Q ${curr.x} ${curr.y} ${afterX} ${afterY}`)
  }

  return parts.join(' ')
}

/**
 * Route a cross-container edge with container-aware path generation.
 *
 * When either container box is null (orphan node), falls back to null
 * so the caller can use getSmoothStepPath instead.
 */
export function routeCrossContainerEdge(
  sourceX: number,
  sourceY: number,
  sourceHandle: string | null | undefined,
  targetX: number,
  targetY: number,
  targetHandle: string | null | undefined,
  sourceContainer: ContainerBox | null,
  targetContainer: ContainerBox | null,
  margin: number = 20,
  cornerRadius: number = 8
): RouteResult | null {
  // Fallback: no container info available
  if (!sourceContainer || !targetContainer) return null

  const srcSide = parseSide(sourceHandle)
  const tgtSide = parseSide(targetHandle)
  const srcVec  = sideVector(srcSide)
  const tgtVec  = sideVector(tgtSide)

  // Exit point: from handle, travel outward past container edge + margin
  const srcEdge  = containerEdgeCoord(sourceContainer, srcSide)
  const srcExitCoord = srcSide === 'left' || srcSide === 'right'
    ? srcEdge + srcVec.dx * margin   // horizontal exit: adjust x
    : srcEdge + srcVec.dy * margin   // vertical exit: adjust y

  const exitPt = {
    x: srcSide === 'left' || srcSide === 'right' ? srcExitCoord : sourceX,
    y: srcSide === 'top'  || srcSide === 'bottom' ? srcExitCoord : sourceY,
  }

  // Entry point: from handle, travel inward past container edge + margin
  const tgtEdge = containerEdgeCoord(targetContainer, tgtSide)
  // tgtVec points outward from target; entry is the opposite direction
  const tgtEntryCoord = tgtSide === 'left' || tgtSide === 'right'
    ? tgtEdge + tgtVec.dx * margin
    : tgtEdge + tgtVec.dy * margin

  const entryPt = {
    x: tgtSide === 'left' || tgtSide === 'right' ? tgtEntryCoord : targetX,
    y: tgtSide === 'top'  || tgtSide === 'bottom' ? tgtEntryCoord : targetY,
  }

  // Build intermediate waypoints connecting exitPt to entryPt.
  // Strategy: determine dominant axis of the gap and add at most two turns.
  const midPts: { x: number; y: number }[] = []

  const bothVertical =
    (srcSide === 'bottom' || srcSide === 'top') &&
    (tgtSide === 'top' || tgtSide === 'bottom')

  const bothHorizontal =
    (srcSide === 'left' || srcSide === 'right') &&
    (tgtSide === 'left' || tgtSide === 'right')

  if (bothVertical) {
    // Both exits are vertical — bridge in the vertical gap.
    // Mid-y: halfway between the two exit coords
    const midY = (exitPt.y + entryPt.y) / 2
    midPts.push({ x: exitPt.x, y: midY })
    midPts.push({ x: entryPt.x, y: midY })
  } else if (bothHorizontal) {
    // Both exits are horizontal — bridge in the horizontal gap.
    const midX = (exitPt.x + entryPt.x) / 2
    midPts.push({ x: midX, y: exitPt.y })
    midPts.push({ x: midX, y: entryPt.y })
  } else {
    // Mixed axes (e.g. source exits bottom, target enters from left).
    // Route with a single elbow: turn at the exit point's axis.
    if (srcSide === 'bottom' || srcSide === 'top') {
      // Source exits vertically → go to target x first, then to entry
      midPts.push({ x: entryPt.x, y: exitPt.y })
    } else {
      // Source exits horizontally → go to target y first, then to entry
      midPts.push({ x: exitPt.x, y: entryPt.y })
    }
  }

  const allPts = [
    { x: sourceX, y: sourceY },
    exitPt,
    ...midPts,
    entryPt,
    { x: targetX, y: targetY },
  ]

  // Deduplicate consecutive identical points to avoid degenerate segments
  const dedupedPts = allPts.filter((pt, i) => {
    if (i === 0) return true
    const prev = allPts[i - 1]
    return Math.abs(pt.x - prev.x) > 0.1 || Math.abs(pt.y - prev.y) > 0.1
  })

  const path = buildRoundedPath(dedupedPts, cornerRadius)

  // Label at midpoint of the inter-container segment (exitPt → entryPt midpoint)
  const labelX = (exitPt.x + entryPt.x) / 2
  const labelY = (exitPt.y + entryPt.y) / 2

  return { path, labelX, labelY }
}
