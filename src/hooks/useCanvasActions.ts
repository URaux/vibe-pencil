'use client'

import { useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { layoutArchitectureCanvas } from '@/lib/graph-layout'
import { useAppStore } from '@/lib/store'
import type { BlockNodeData, CanvasNodeData, ContainerNodeData } from '@/lib/types'
import {
  type CanvasAction,
  VALID_BUILD_STATUSES,
  VALID_CONTAINER_COLORS,
  VALID_EDGE_TYPES,
  VALID_NODE_TYPES,
  tryRepairJson,
} from '@/lib/canvas-action-types'
import { cloneCanvas } from '@/lib/canvas-utils'

type CanvasNode = Node<CanvasNodeData>

function applyActionToSnapshot(
  action: CanvasAction,
  currentNodes: CanvasNode[],
  currentEdges: Edge[],
  droppedEdges?: { source: string; target: string; reason: string }[]
): { nodes: CanvasNode[]; edges: Edge[] } {
  if (action.action === 'add-node') {
    const node = action.node ?? {}
    const type = VALID_NODE_TYPES.has(node.type ?? 'block') ? (node.type ?? 'block') : 'block'

    // Generate ID: prefer explicit id, then kebab-case from name, then UUID fallback
    const rawName = (node.data as Record<string, unknown>)?.name ?? node.name
    const kebabFromName = typeof rawName === 'string' && rawName
      ? rawName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
      : ''
    let id =
      typeof node.id === 'string' && node.id
        ? node.id
        : kebabFromName
          ? kebabFromName
          : `${type}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`
    // Dedupe: if id already exists, append -2, -3 etc.
    if (currentNodes.some((n) => n.id === id)) {
      let suffix = 2
      while (currentNodes.some((n) => n.id === `${id}-${suffix}`)) suffix++
      id = `${id}-${suffix}`
    }

    if (type === 'container') {
      const data = node.data as Partial<ContainerNodeData> | undefined
      const colorCandidate =
        typeof data?.color === 'string'
          ? data.color
          : typeof node.color === 'string'
            ? node.color
            : 'blue'

      const newNode: CanvasNode = {
        id,
        type,
        position: {
          x: typeof node.position?.x === 'number' ? node.position.x : 80 + (currentNodes.length % 3) * 280,
          y: typeof node.position?.y === 'number' ? node.position.y : 80 + Math.floor(currentNodes.length / 3) * 220,
        },
        style: {
          width:
            typeof node.style === 'object' && node.style && typeof node.style.width === 'number'
              ? node.style.width
              : 400,
          height:
            typeof node.style === 'object' && node.style && typeof node.style.height === 'number'
              ? node.style.height
              : 300,
        },
        data: {
          name:
            typeof data?.name === 'string'
              ? data.name
              : typeof node.name === 'string'
                ? node.name
                : id,
          description:
            typeof data?.description === 'string'
              ? data.description
              : typeof node.description === 'string'
                ? node.description
                : '',
          color: VALID_CONTAINER_COLORS.has(colorCandidate as ContainerNodeData['color'])
            ? (colorCandidate as ContainerNodeData['color'])
            : 'blue',
          collapsed:
            typeof data?.collapsed === 'boolean'
              ? data.collapsed
              : typeof node.collapsed === 'boolean'
                ? node.collapsed
                : false,
        } as CanvasNodeData,
      }
      return { nodes: [...currentNodes, newNode], edges: currentEdges }
    }

    const data = node.data as Partial<BlockNodeData> | undefined
    // Resolve parentId: try exact match first, then fuzzy match by kebab-case name
    let parentId: string | undefined
    if (typeof node.parentId === 'string' && node.parentId) {
      const exactMatch = currentNodes.find((entry) => entry.id === node.parentId && entry.type === 'container')
      if (exactMatch) {
        parentId = exactMatch.id
      } else {
        // Fuzzy: try matching parentId against container name (kebab-case)
        const needle = node.parentId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        const fuzzyMatch = currentNodes.find((entry) => {
          if (entry.type !== 'container') return false
          const entryName = (entry.data as { name?: string }).name ?? ''
          const entryKebab = entryName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
          return entry.id === needle || entryKebab === needle || entryKebab.includes(needle) || needle.includes(entryKebab)
        })
        if (fuzzyMatch) parentId = fuzzyMatch.id
      }
    }
    const statusCandidate =
      typeof data?.status === 'string' ? data.status : typeof node.status === 'string' ? node.status : 'idle'

    const newNode: CanvasNode = {
      id,
      type,
      position: {
        x: typeof node.position?.x === 'number' ? node.position.x : parentId ? 24 : 80 + (currentNodes.length % 3) * 240,
        y: typeof node.position?.y === 'number' ? node.position.y : parentId ? 72 : 80 + Math.floor(currentNodes.length / 3) * 180,
      },
      ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      data: {
        name:
          typeof data?.name === 'string'
            ? data.name
            : typeof node.name === 'string'
              ? node.name
              : id,
        description:
          typeof data?.description === 'string'
            ? data.description
            : typeof node.description === 'string'
              ? node.description
              : '',
        status: VALID_BUILD_STATUSES.has(statusCandidate as BlockNodeData['status'])
          ? (statusCandidate as BlockNodeData['status'])
          : 'idle',
        ...(typeof data?.summary === 'string' ? { summary: data.summary } : {}),
        ...(typeof data?.errorMessage === 'string' ? { errorMessage: data.errorMessage } : {}),
        ...(typeof data?.techStack === 'string'
          ? { techStack: data.techStack }
          : typeof node.techStack === 'string'
            ? { techStack: node.techStack }
            : {}),
        ...(node.data?.schema ? { schema: node.data.schema } : (node as Record<string, unknown>).schema ? { schema: (node as Record<string, unknown>).schema as BlockNodeData['schema'] } : {}),
      } as CanvasNodeData,
    }
    return { nodes: [...currentNodes, newNode], edges: currentEdges }
  }

  if (action.action === 'update-node') {
    return {
      nodes: currentNodes.map((n) =>
        n.id === action.target_id ? { ...n, data: { ...n.data, ...action.data } } : n
      ),
      edges: currentEdges,
    }
  }

  if (action.action === 'remove-node') {
    return {
      nodes: currentNodes.filter((n) => n.id !== action.target_id),
      edges: currentEdges.filter(
        (e) => e.source !== action.target_id && e.target !== action.target_id
      ),
    }
  }

  if (action.action === 'add-edge') {
    const edge = action.edge

    // Fuzzy resolve source and target node IDs
    const resolveNodeId = (ref: string) => {
      // Exact match first
      const exact = currentNodes.find((n) => n.id === ref)
      if (exact) return exact.id
      // Kebab-case fuzzy match
      const needle = ref.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const fuzzy = currentNodes.find((n) => {
        const name = (n.data as { name?: string }).name ?? ''
        const nameKebab = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
        return n.id === needle || nameKebab === needle || nameKebab.includes(needle) || needle.includes(nameKebab)
      })
      return fuzzy?.id ?? null
    }

    const resolvedSource = resolveNodeId(edge.source)
    const resolvedTarget = resolveNodeId(edge.target)

    if (!resolvedSource || !resolvedTarget) {
      // Skip edges referencing non-existent nodes instead of throwing,
      // but record the drop so the UI can surface it instead of silently losing the edge.
      if (droppedEdges) {
        const missing: string[] = []
        if (!resolvedSource) missing.push(`source="${edge.source}"`)
        if (!resolvedTarget) missing.push(`target="${edge.target}"`)
        droppedEdges.push({
          source: edge.source,
          target: edge.target,
          reason: `unresolved ${missing.join(' + ')}`,
        })
      }
      return { nodes: currentNodes, edges: currentEdges }
    }

    const type = VALID_EDGE_TYPES.has(edge.type ?? 'sync') ? (edge.type ?? 'sync') : 'sync'

    const newEdge: Edge = {
      id:
        typeof edge.id === 'string' && edge.id
          ? edge.id
          : `edge-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`,
      source: resolvedSource,
      target: resolvedTarget,
      type,
      ...(edge.label ? { label: edge.label } : {}),
    }
    return { nodes: currentNodes, edges: [...currentEdges, newEdge] }
  }

  return { nodes: currentNodes, edges: currentEdges }
}

export function useCanvasActions() {
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})

  async function applyCanvasActions(rawActions: string[], messageIndex: number): Promise<void> {
    if (rawActions.length === 0) {
      return
    }

    // Read current canvas — always incremental, no hasExistingCanvas branch
    const { nodes, edges } = useAppStore.getState()
    const canvasBefore = cloneCanvas(nodes, edges)

    // Use a string key for error tracking based on messageIndex
    const errorKey = String(messageIndex)

    try {
      let workingNodes: CanvasNode[] = [...canvasBefore.nodes]
      let workingEdges: Edge[] = [...canvasBefore.edges]
      const droppedEdges: { source: string; target: string; reason: string }[] = []

      for (const rawAction of rawActions) {
        const parsed = tryRepairJson(rawAction)
        if (!parsed) {
          throw new Error('Invalid JSON action block.')
        }

        const rawList = Array.isArray(parsed) ? parsed : [parsed]
        // Sort: add-node (containers first, then blocks) → update-node → remove-node → add-edge
        const actionOrder: Record<string, number> = { 'add-node': 0, 'update-node': 1, 'remove-node': 2, 'add-edge': 3 }
        const actions = (rawList as CanvasAction[]).sort((a, b) => {
          const oa = actionOrder[a.action] ?? 1
          const ob = actionOrder[b.action] ?? 1
          if (oa !== ob) return oa - ob
          // Within add-node, containers before blocks
          if (a.action === 'add-node' && b.action === 'add-node') {
            const aIsContainer = a.node?.type === 'container' ? 0 : 1
            const bIsContainer = b.node?.type === 'container' ? 0 : 1
            return aIsContainer - bIsContainer
          }
          return 0
        })
        for (const action of actions) {
          const result = applyActionToSnapshot(action, workingNodes, workingEdges, droppedEdges)
          workingNodes = result.nodes
          workingEdges = result.edges
        }
      }

      // Filter out invalid edges — both endpoints must exist and be block nodes
      const blockIds = new Set(workingNodes.filter((n) => n.type === 'block').map((n) => n.id))
      const validEdges = workingEdges.filter(
        (e) => blockIds.has(e.source) && blockIds.has(e.target)
      )
      const arranged = await layoutArchitectureCanvas(workingNodes, validEdges)
      useAppStore.getState().setCanvas(arranged.nodes, arranged.edges)

      const canvasAfter = cloneCanvas(arranged.nodes, arranged.edges)

      // Attach canvasBefore + canvasAfter to the message at messageIndex
      useAppStore.getState().updateActiveChatMessages((msgs) => {
        const updated = [...msgs]
        if (updated[messageIndex] && updated[messageIndex].role === 'assistant') {
          updated[messageIndex] = {
            ...updated[messageIndex],
            canvasBefore,
            canvasAfter,
          }
        }
        return updated
      })

      // Save canvas snapshot to current chat session for session switching
      const { activeChatSessionId, chatSessions } = useAppStore.getState()
      if (activeChatSessionId) {
        const updatedSessions = chatSessions.map((s) =>
          s.id === activeChatSessionId
            ? { ...s, canvasSnapshot: { nodes: arranged.nodes, edges: arranged.edges } }
            : s
        )
        useAppStore.setState({ chatSessions: updatedSessions })
      }

      setActionErrors((current) => {
        const next = { ...current }
        if (droppedEdges.length > 0) {
          const knownIds = arranged.nodes
            .filter((n) => n.type === 'block')
            .map((n) => n.id)
            .slice(0, 20)
          const lines = droppedEdges.map(
            (d) => `  • ${d.source} → ${d.target} (${d.reason})`
          )
          next[errorKey] = [
            `${droppedEdges.length} edge(s) dropped — referenced block IDs not found:`,
            ...lines,
            `Known block IDs (first 20): ${knownIds.join(', ')}`,
          ].join('\n')
        } else {
          delete next[errorKey]
        }
        return next
      })
    } catch (applyError) {
      setActionErrors((current) => ({
        ...current,
        [errorKey]:
          applyError instanceof Error ? applyError.message : t('apply_canvas_failed'),
      }))
    }
  }

  function restoreSnapshot(snapshot: { nodes: CanvasNode[]; edges: Edge[] }): void {
    const store = useAppStore.getState()
    store.pushCanvasSnapshot()
    store.setCanvas(snapshot.nodes, snapshot.edges)
    // Update session canvasSnapshot
    const { activeChatSessionId, chatSessions } = useAppStore.getState()
    if (activeChatSessionId) {
      const updated = chatSessions.map((s) =>
        s.id === activeChatSessionId
          ? { ...s, canvasSnapshot: { nodes: snapshot.nodes, edges: snapshot.edges } }
          : s
      )
      useAppStore.setState({ chatSessions: updated })
    }
  }

  return {
    applyCanvasActions,
    restoreSnapshot,
    actionErrors,
  }
}
