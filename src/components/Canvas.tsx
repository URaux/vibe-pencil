'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ContextMenu } from '@/components/ContextMenu'
import { edgeTypes } from '@/components/edges/edgeTypes'
import { nodeTypes } from '@/components/nodes/nodeTypes'
import { useBuildActions } from '@/hooks/useBuildActions'
import { useAppStore } from '@/lib/store'
import type { ArchitectNodeData, NodeType } from '@/lib/types'

type ContextMenuState =
  | { kind: 'canvas'; x: number; y: number }
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | null

interface CanvasProps {
  onOpenImportDialog: () => void
}

function getMenuPosition(event: Pick<React.MouseEvent, 'clientX' | 'clientY'>) {
  const menuWidth = 224
  const menuHeight = 176
  const padding = 12

  return {
    x: Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding)),
  }
}

export function Canvas({ onOpenImportDialog }: CanvasProps) {
  const nodes = useAppStore((state) => state.nodes)
  const edges = useAppStore((state) => state.edges)
  const onNodesChange = useAppStore((state) => state.onNodesChange)
  const onEdgesChange = useAppStore((state) => state.onEdgesChange)
  const onConnect = useAppStore((state) => state.onConnect)
  const addNode = useAppStore((state) => state.addNode)
  const removeNode = useAppStore((state) => state.removeNode)
  const setSelectedNodeId = useAppStore((state) => state.setSelectedNodeId)
  const setChatOpen = useAppStore((state) => state.setChatOpen)
  const updateNodeData = useAppStore((state) => state.updateNodeData)
  const { screenToFlowPosition } = useReactFlow()
  const { buildAll, buildNode, isBuilding } = useBuildActions()
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()

      const rawType = event.dataTransfer.getData('application/reactflow')
      if (!(rawType in nodeTypes)) {
        return
      }

      const type = rawType as NodeType
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const newNode: Node<ArchitectNodeData> = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: { name: '', description: '', status: 'idle' },
      }

      addNode(newNode)
    },
    [addNode, screenToFlowPosition]
  )

  useEffect(() => {
    if (!editingNodeId) {
      return
    }

    const activeNode = nodes.find((node) => node.id === editingNodeId)

    if (!activeNode) {
      setEditingNodeId(null)
    }
  }, [editingNodeId, nodes])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      setContextMenu(null)
      setEditingNodeId(null)
    }

    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  function openNodeEditor(nodeId: string) {
    const node = nodes.find((entry) => entry.id === nodeId)

    if (!node) {
      return
    }

    setEditingNodeId(nodeId)
    setDraftName(node.data.name)
    setDraftDescription(node.data.description)
    setContextMenu(null)
  }

  function closeNodeEditor() {
    setEditingNodeId(null)
    setDraftName('')
    setDraftDescription('')
  }

  function saveNodeEdits(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!editingNodeId) {
      return
    }

    updateNodeData(editingNodeId, {
      name: draftName.trim(),
      description: draftDescription.trim(),
    })
    closeNodeEditor()
  }

  const editingNode = editingNodeId ? nodes.find((node) => node.id === editingNodeId) ?? null : null
  const nodeMenuItems =
    contextMenu?.kind === 'node'
      ? [
          {
            label: 'Discuss with AI',
            onSelect: () => {
              setSelectedNodeId(contextMenu.nodeId)
              setChatOpen(true)
            },
          },
          {
            label: 'Build this node',
            onSelect: () => buildNode(contextMenu.nodeId),
            disabled: isBuilding,
          },
          {
            label: 'Edit',
            onSelect: () => openNodeEditor(contextMenu.nodeId),
          },
          {
            label: 'Delete',
            onSelect: () => removeNode(contextMenu.nodeId),
            tone: 'danger' as const,
          },
        ]
      : []
  const canvasMenuItems =
    contextMenu?.kind === 'canvas'
      ? [
          {
            label: 'Build All',
            onSelect: buildAll,
            disabled: nodes.length === 0 || isBuilding,
          },
          {
            label: 'Import Project',
            onSelect: onOpenImportDialog,
          },
        ]
      : []

  return (
    <div className="relative h-full w-full bg-gray-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onPaneClick={() => {
          setSelectedNodeId(null)
          setContextMenu(null)
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault()
          setContextMenu({ kind: 'canvas', ...getMenuPosition(event) })
        }}
        onNodeDoubleClick={(_, node) => openNodeEditor(node.id)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault()
          setSelectedNodeId(node.id)
          setContextMenu({ kind: 'node', nodeId: node.id, ...getMenuPosition(event) })
        }}
        onSelectionChange={({ nodes: selectedNodes }) => {
          setSelectedNodeId(selectedNodes[0]?.id ?? null)
        }}
        fitView
        className="bg-gray-800"
      >
        <svg className="absolute h-0 w-0" aria-hidden="true">
          <defs>
            <marker
              id="arrow"
              markerWidth="12"
              markerHeight="12"
              refX="10"
              refY="6"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,12 L12,6 z" fill="#94a3b8" />
            </marker>
            <marker
              id="arrow-reverse"
              markerWidth="12"
              markerHeight="12"
              refX="2"
              refY="6"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M12,0 L12,12 L0,6 z" fill="#94a3b8" />
            </marker>
          </defs>
        </svg>
        <MiniMap
          pannable
          zoomable
          className="!bg-gray-900"
          maskColor="rgba(17, 24, 39, 0.65)"
          nodeColor="#4b5563"
        />
        <Controls className="!bg-gray-900 !text-gray-200" />
      </ReactFlow>
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.kind === 'node' ? nodeMenuItems : canvasMenuItems}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
      {editingNode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/80 p-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl shadow-black/50">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Edit Node</h2>
                <p className="mt-1 text-sm text-gray-400">
                  Update the name and description for {editingNode.type ?? 'node'}.
                </p>
              </div>
              <button
                type="button"
                onClick={closeNodeEditor}
                className="rounded-full border border-gray-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-gray-300 transition hover:border-gray-500 hover:text-white"
              >
                Close
              </button>
            </div>

            <form onSubmit={saveNodeEdits} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                  Name
                </span>
                <input
                  type="text"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="UserService"
                  className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                  Description
                </span>
                <textarea
                  value={draftDescription}
                  onChange={(event) => setDraftDescription(event.target.value)}
                  rows={4}
                  placeholder="What this node is responsible for"
                  className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                />
              </label>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeNodeEditor}
                  className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:border-gray-500 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl border border-cyan-500/60 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
