import { useState } from 'react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import { COLLAPSED_CONTAINER_HEIGHT, layoutArchitectureCanvas } from '@/lib/graph-layout'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import { getContainerColorClasses } from '@/lib/ui-text'
import type { CanvasNodeData, ContainerNodeData } from '@/lib/types'

function cloneCanvas(nodes: Node<CanvasNodeData>[], edges: Edge[]) {
  return {
    nodes: nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      data: { ...node.data },
      ...(node.style ? { style: { ...node.style } } : {}),
    })),
    edges: edges.map((edge) => ({ ...edge })),
  }
}

export function ContainerNode({ id, data, selected }: NodeProps<Node<ContainerNodeData>>) {
  useAppStore((state) => state.locale)
  const [isUpdating, setIsUpdating] = useState(false)
  const nodeData = data as ContainerNodeData
  const colorClasses = getContainerColorClasses(nodeData.color)

  async function handleToggleCollapse() {
    if (isUpdating) {
      return
    }

    const { nodes, edges, setCanvas } = useAppStore.getState()
    const nextCollapsed = !nodeData.collapsed
    const canvas = cloneCanvas(nodes, edges)
    const nextNodes = canvas.nodes.map((node) => {
      if (node.id === id && node.type === 'container') {
        return {
          ...node,
          data: { ...node.data, collapsed: nextCollapsed },
          style: {
            ...node.style,
            ...(nextCollapsed ? { height: COLLAPSED_CONTAINER_HEIGHT } : {}),
          },
        }
      }

      if (node.type === 'block' && node.parentId === id) {
        return {
          ...node,
          hidden: nextCollapsed,
        }
      }

      return node
    })

    if (nextCollapsed) {
      setCanvas(nextNodes, canvas.edges)
      return
    }

    setIsUpdating(true)

    try {
      const arranged = await layoutArchitectureCanvas(nextNodes, canvas.edges)
      setCanvas(arranged.nodes, arranged.edges)
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div
      className={`h-full w-full overflow-hidden rounded-[12px] border ${colorClasses.background} ${
        colorClasses.border
      } ${selected ? 'ring-2 ring-orange-300/70 ring-offset-2 ring-offset-transparent' : ''}`}
    >
      <div className="flex items-start justify-between gap-3 p-3">
        <span
          className={`inline-flex rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white ${colorClasses.title}`}
        >
          {nodeData.name || t('container')}
        </span>
        <button
          type="button"
          className="nodrag nopan rounded-full border border-white/70 bg-white/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => {
            void handleToggleCollapse()
          }}
          aria-label={nodeData.collapsed ? t('expand') : t('collapse')}
          disabled={isUpdating}
        >
          {nodeData.collapsed ? t('expand') : t('collapse')}
        </button>
      </div>
    </div>
  )
}
