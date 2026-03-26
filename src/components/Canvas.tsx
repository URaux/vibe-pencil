'use client'

import { useCallback } from 'react'
import {
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { edgeTypes } from '@/components/edges/edgeTypes'
import { nodeTypes } from '@/components/nodes/nodeTypes'
import { useAppStore } from '@/lib/store'
import type { ArchitectNodeData, NodeType } from '@/lib/types'

export function Canvas() {
  const nodes = useAppStore((state) => state.nodes)
  const edges = useAppStore((state) => state.edges)
  const onNodesChange = useAppStore((state) => state.onNodesChange)
  const onEdgesChange = useAppStore((state) => state.onEdgesChange)
  const onConnect = useAppStore((state) => state.onConnect)
  const addNode = useAppStore((state) => state.addNode)
  const { screenToFlowPosition } = useReactFlow()

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

  return (
    <div className="h-full w-full bg-gray-800">
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
    </div>
  )
}
