'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ContextMenu } from '@/components/ContextMenu'
import SchemaEditor from '@/components/SchemaEditor'
import { edgeTypes } from '@/components/edges/edgeTypes'
import { nodeTypes } from '@/components/nodes/nodeTypes'
import {
  BLOCK_HEIGHT,
  BLOCK_WIDTH,
  COLLAPSED_CONTAINER_HEIGHT,
  CONTAINER_PADDING,
  layoutArchitectureCanvas,
} from '@/lib/graph-layout'
import { useBuildActions } from '@/hooks/useBuildActions'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import {
  CONTAINER_COLOR_OPTIONS,
  formatContainerColorLabel,
  getNodeTypeLabel,
} from '@/lib/ui-text'
import type {
  BlockSchema,
  BlockNodeData,
  CanvasNodeData,
  ContainerColor,
  ContainerNodeData,
  SchemaColumn,
  SchemaTable,
  VPNodeType,
} from '@/lib/types'

type CanvasNode = Node<CanvasNodeData>
type ContextMenuState =
  | { kind: 'canvas'; x: number; y: number }
  | { kind: 'node'; x: number; y: number; nodeId: string }
  | null

interface CanvasProps {
  onOpenImportDialog: () => void
}

const DEFAULT_CONTAINER_WIDTH = 400
const DEFAULT_CONTAINER_HEIGHT = 300
const BLOCK_MARGIN = 12

function getMenuPosition(event: Pick<React.MouseEvent, 'clientX' | 'clientY'>) {
  const menuWidth = 224
  const menuHeight = 176
  const padding = 12

  return {
    x: Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding)),
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function cloneCanvas(nodes: CanvasNode[], edges: Edge[]) {
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

function getContainerDimensions(node: Node<ContainerNodeData>) {
  return {
    width:
      typeof node.style?.width === 'number' ? node.style.width : DEFAULT_CONTAINER_WIDTH,
    height:
      typeof node.style?.height === 'number' ? node.style.height : DEFAULT_CONTAINER_HEIGHT,
  }
}

function getAbsolutePosition(node: CanvasNode, nodes: CanvasNode[]) {
  if (!node.parentId) {
    return node.position
  }

  const parent = nodes.find((entry) => entry.id === node.parentId)

  if (!parent) {
    return node.position
  }

  return {
    x: parent.position.x + node.position.x,
    y: parent.position.y + node.position.y,
  }
}

function getRelativeBlockPosition(
  absolutePosition: { x: number; y: number },
  container: Node<ContainerNodeData>
) {
  const { width, height } = getContainerDimensions(container)
  const maxX = Math.max(BLOCK_MARGIN, width - BLOCK_WIDTH - BLOCK_MARGIN)
  const maxY = Math.max(CONTAINER_PADDING, height - BLOCK_HEIGHT - BLOCK_MARGIN)

  return {
    x: clamp(absolutePosition.x - container.position.x, BLOCK_MARGIN, maxX),
    y: clamp(absolutePosition.y - container.position.y, CONTAINER_PADDING, maxY),
  }
}

function getDropTargetContainer(
  candidates: Node[],
  excludeId?: string
) {
  return candidates
    .filter(
      (node): node is Node<ContainerNodeData> =>
        node.type === 'container' &&
        node.id !== excludeId &&
        !(node.data as ContainerNodeData).collapsed
    )
    .at(-1)
}

function isDataLayerName(name: string) {
  return /data|数据|database|db/i.test(name)
}

function mergeSchemas(schemas: BlockSchema[]) {
  const tables: SchemaTable[] = []
  const seen = new Set<string>()

  for (const schema of schemas) {
    for (const table of schema.tables ?? []) {
      const key = table.name.trim().toLowerCase()
      if (!key || seen.has(key)) {
        continue
      }
      seen.add(key)
      tables.push(table)
    }
  }

  return tables.length > 0 ? { tables } : undefined
}

function normalizeTableKey(name: string | undefined) {
  return typeof name === 'string' ? name.trim().toLowerCase() : ''
}

function normalizeColumnKey(name: string | undefined) {
  return typeof name === 'string' ? name.trim().toLowerCase() : ''
}

function buildNormalizedFieldRefMap(fieldRefs: Record<string, string[]> | undefined) {
  if (!fieldRefs) {
    return undefined
  }

  const normalized = new Map<string, Set<string>>()

  for (const [tableName, fields] of Object.entries(fieldRefs)) {
    const tableKey = normalizeTableKey(tableName)
    if (!tableKey) {
      continue
    }

    const fieldSet = normalized.get(tableKey) ?? new Set<string>()
    for (const fieldName of fields) {
      const fieldKey = normalizeColumnKey(fieldName)
      if (fieldKey) {
        fieldSet.add(fieldKey)
      }
    }

    if (fieldSet.size > 0) {
      normalized.set(tableKey, fieldSet)
    }
  }

  return normalized.size > 0 ? normalized : undefined
}

function getSchemaRefsFromTables(schema: BlockSchema | undefined) {
  if (!schema) {
    return []
  }

  const refs: string[] = []
  const seen = new Set<string>()

  for (const table of schema.tables) {
    const name = table.name.trim()
    const key = normalizeTableKey(name)
    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    refs.push(name)
  }

  return refs
}

function getSchemaFieldRefsFromTables(schema: BlockSchema | undefined) {
  if (!schema) {
    return undefined
  }

  const refs: Record<string, string[]> = {}
  const seenTables = new Set<string>()

  for (const table of schema.tables) {
    const tableName = table.name.trim()
    const tableKey = normalizeTableKey(tableName)
    if (!tableKey || seenTables.has(tableKey)) {
      continue
    }

    const columns: string[] = []
    const seenColumns = new Set<string>()

    for (const column of table.columns) {
      const columnName = column.name.trim()
      const columnKey = normalizeColumnKey(columnName)
      if (!columnKey || seenColumns.has(columnKey)) {
        continue
      }

      seenColumns.add(columnKey)
      columns.push(columnName)
    }

    if (columns.length > 0) {
      refs[tableName] = columns
      seenTables.add(tableKey)
    }
  }

  return Object.keys(refs).length > 0 ? refs : undefined
}

function pickSchemaByRefs(
  schema: BlockSchema | undefined,
  refs: string[] | undefined,
  fieldRefs: Record<string, string[]> | undefined
) {
  if (!schema || !refs || refs.length === 0) {
    return undefined
  }

  const refSet = new Set(refs.map(normalizeTableKey))
  const normalizedFieldRefs = buildNormalizedFieldRefMap(fieldRefs)
  const tables = schema.tables
    .filter((table) => refSet.has(normalizeTableKey(table.name)))
    .map((table) => {
      if (!normalizedFieldRefs) {
        return table
      }

      const fieldSet = normalizedFieldRefs.get(normalizeTableKey(table.name))
      if (!fieldSet || fieldSet.size === 0) {
        return { ...table, columns: [] }
      }

      const columns = table.columns.filter((col) => fieldSet.has(normalizeColumnKey(col.name)))
      return { ...table, columns }
    })
    .filter((table) => table.columns.length > 0)

  return tables.length > 0 ? { tables } : undefined
}

function mergeSchemaTables(
  base: BlockSchema | undefined,
  updates: BlockSchema | undefined
): BlockSchema | undefined {
  if (!updates || updates.tables.length === 0) {
    return base
  }

  const nextTables: SchemaTable[] = []
  const seen = new Set<string>()

  const baseTables = base?.tables ?? []
  const updateMap = new Map(
    updates.tables.map((table) => [normalizeTableKey(table.name), table])
  )

  for (const table of baseTables) {
    const key = normalizeTableKey(table.name)
    const nextTable = updateMap.get(key) ?? table
    if (!seen.has(key) && key) {
      seen.add(key)
      nextTables.push(nextTable)
    }
  }

  for (const [key, table] of updateMap.entries()) {
    if (!seen.has(key) && key) {
      seen.add(key)
      nextTables.push(table)
    }
  }

  return nextTables.length > 0 ? { tables: nextTables } : undefined
}

function mergeColumns(
  baseColumns: SchemaColumn[],
  updates: SchemaColumn[]
) {
  if (updates.length === 0) {
    return baseColumns
  }

  const next: SchemaColumn[] = []
  const seen = new Set<string>()
  const updateMap = new Map(
    updates.map((column) => [normalizeColumnKey(column.name), column])
  )

  for (const column of baseColumns) {
    const key = normalizeColumnKey(column.name)
    const nextColumn = updateMap.get(key) ?? column
    if (!seen.has(key) && key) {
      seen.add(key)
      next.push(nextColumn)
    }
  }

  for (const [key, column] of updateMap.entries()) {
    if (!seen.has(key) && key) {
      seen.add(key)
      next.push(column)
    }
  }

  return next
}

function mergeIndexes(
  baseIndexes: SchemaTable['indexes'] | undefined,
  updates: SchemaTable['indexes'] | undefined
) {
  const base = baseIndexes ?? []
  const up = updates ?? []
  if (up.length === 0) {
    return baseIndexes
  }

  const next: NonNullable<SchemaTable['indexes']> = []
  const seen = new Set<string>()
  const updateMap = new Map(
    up.map((index) => [normalizeTableKey(index.name), index])
  )

  for (const index of base) {
    const key = normalizeTableKey(index.name)
    const nextIndex = updateMap.get(key) ?? index
    if (!seen.has(key) && key) {
      seen.add(key)
      next.push(nextIndex)
    }
  }

  for (const [key, index] of updateMap.entries()) {
    if (!seen.has(key) && key) {
      seen.add(key)
      next.push(index)
    }
  }

  return next
}

function mergeSchemaTablesWithColumns(
  base: BlockSchema | undefined,
  updates: BlockSchema | undefined
): BlockSchema | undefined {
  if (!updates || updates.tables.length === 0) {
    return base
  }

  const nextTables: SchemaTable[] = []
  const seen = new Set<string>()
  const updateMap = new Map(
    updates.tables.map((table) => [normalizeTableKey(table.name), table])
  )

  const baseTables = base?.tables ?? []

  for (const table of baseTables) {
    const key = normalizeTableKey(table.name)
    const updateTable = updateMap.get(key)
    const nextTable = updateTable
      ? {
          ...table,
          columns: mergeColumns(table.columns, updateTable.columns),
          indexes: mergeIndexes(table.indexes, updateTable.indexes),
        }
      : table
    if (!seen.has(key) && key) {
      seen.add(key)
      nextTables.push(nextTable)
    }
  }

  for (const [key, table] of updateMap.entries()) {
    if (!seen.has(key) && key) {
      seen.add(key)
      nextTables.push(table)
    }
  }

  return nextTables.length > 0 ? { tables: nextTables } : undefined
}

export function Canvas({ onOpenImportDialog }: CanvasProps) {
  const nodes = useAppStore((state) => state.nodes)
  const edges = useAppStore((state) => state.edges)
  const canvasVersion = useAppStore((state) => state.canvasVersion)
  const onNodesChange = useAppStore((state) => state.onNodesChange)
  const onEdgesChange = useAppStore((state) => state.onEdgesChange)
  const onConnect = useAppStore((state) => state.onConnect)
  const addNode = useAppStore((state) => state.addNode)
  const removeNode = useAppStore((state) => state.removeNode)
  const setCanvas = useAppStore((state) => state.setCanvas)
  const setSelectedNodeId = useAppStore((state) => state.setSelectedNodeId)
  const setChatOpen = useAppStore((state) => state.setChatOpen)
  const updateNodeData = useAppStore((state) => state.updateNodeData)
  useAppStore((state) => state.locale)
  const { fitView, screenToFlowPosition, getIntersectingNodes } = useReactFlow()
  const { buildAll, buildNode, isBuilding } = useBuildActions()
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')
  const [draftTechStack, setDraftTechStack] = useState('')
  const [draftSchema, setDraftSchema] = useState<BlockSchema | undefined>(undefined)
  const [draftColor, setDraftColor] = useState<ContainerColor>('blue')

  const dataLayerInfo = useMemo(() => {
    const containerNames = new Map(
      nodes
        .filter((node): node is Node<ContainerNodeData> => node.type === 'container')
        .map((container) => [container.id, container.data.name ?? ''])
    )
    const dataLayerBlockIds = new Set<string>()
    const schemaSources: string[] = []
    const schemas: BlockSchema[] = []
    const dataLayerBlocks: Node<BlockNodeData>[] = []

    for (const node of nodes) {
      if (node.type !== 'block' || !node.parentId) {
        continue
      }
      const parentName = containerNames.get(node.parentId) ?? ''
      if (!isDataLayerName(parentName)) {
        continue
      }
      dataLayerBlockIds.add(node.id)
      dataLayerBlocks.push(node as Node<BlockNodeData>)
      const blockData = node.data as BlockNodeData
      if (blockData.schema) {
        schemas.push(blockData.schema)
        schemaSources.push(blockData.name || node.id)
      }
    }

    const primarySchemaBlock =
      dataLayerBlocks.find((block) => Boolean((block.data as BlockNodeData).schema)) ??
      dataLayerBlocks[0] ??
      null

    return {
      dataLayerBlockIds,
      sharedSchema: mergeSchemas(schemas),
      schemaSources,
      primarySchemaBlock,
    }
  }, [nodes])

  const toggleContainerCollapse = useCallback(
    async (nodeId: string) => {
      const canvas = cloneCanvas(nodes, edges)
      const target = canvas.nodes.find(
        (node): node is Node<ContainerNodeData> => node.id === nodeId && node.type === 'container'
      )

      if (!target) {
        return
      }

      const nextCollapsed = !target.data.collapsed
      const nextNodes = canvas.nodes.map((node) => {
        if (node.id === nodeId && node.type === 'container') {
          return {
            ...node,
            data: { ...node.data, collapsed: nextCollapsed },
            style: {
              ...node.style,
              ...(nextCollapsed ? { height: COLLAPSED_CONTAINER_HEIGHT } : {}),
            },
          }
        }

        if (node.type === 'block' && node.parentId === nodeId) {
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

      const arranged = await layoutArchitectureCanvas(nextNodes, canvas.edges)
      setCanvas(arranged.nodes, arranged.edges)
    },
    [edges, nodes, setCanvas]
  )

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()

      const rawType = event.dataTransfer.getData('application/reactflow')
      if (rawType !== 'container' && rawType !== 'block') {
        return
      }

      const type = rawType as VPNodeType
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      if (type === 'container') {
        useAppStore.getState().pushCanvasSnapshot()
        addNode({
          id: `container-${Date.now()}`,
          type: 'container',
          position,
          style: { width: DEFAULT_CONTAINER_WIDTH, height: DEFAULT_CONTAINER_HEIGHT },
          data: { name: '', color: 'blue', collapsed: false },
        })
        return
      }

      const targetContainer = getDropTargetContainer(
        getIntersectingNodes({
          x: position.x,
          y: position.y,
          width: BLOCK_WIDTH,
          height: BLOCK_HEIGHT,
        })
      )

      useAppStore.getState().pushCanvasSnapshot()
      addNode({
        id: `block-${Date.now()}`,
        type: 'block',
        position: targetContainer ? getRelativeBlockPosition(position, targetContainer) : position,
        ...(targetContainer
          ? { parentId: targetContainer.id, extent: 'parent' as const }
          : {}),
        data: { name: '', description: '', status: 'idle' },
      })
    },
    [addNode, getIntersectingNodes, screenToFlowPosition]
  )

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: CanvasNode) => {
      if (draggedNode.type !== 'block') {
        return
      }

      const absolutePosition = getAbsolutePosition(draggedNode, nodes)
      const targetContainer = getDropTargetContainer(
        getIntersectingNodes(draggedNode),
        draggedNode.id
      )
      const nextParentId = targetContainer?.id ?? null

      if ((draggedNode.parentId ?? null) === nextParentId) {
        return
      }

      useAppStore.getState().pushCanvasSnapshot()

      const nextNodes = nodes.map((node) => {
        if (node.id !== draggedNode.id || node.type !== 'block') {
          return node
        }

        return {
          ...node,
          position: nextParentId && targetContainer
            ? getRelativeBlockPosition(absolutePosition, targetContainer)
            : absolutePosition,
          ...(nextParentId
            ? { parentId: nextParentId, extent: 'parent' as const }
            : { parentId: undefined, extent: undefined }),
        }
      })

      setCanvas(nextNodes, edges)
    },
    [edges, getIntersectingNodes, nodes, setCanvas]
  )

  useEffect(() => {
    if (canvasVersion <= 0 || nodes.length === 0) {
      return
    }

    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.1, duration: 300 })
    }, 100)

    return () => window.clearTimeout(timer)
  }, [canvasVersion, fitView, nodes.length])

  // Refit on window resize so layout adapts to viewport changes
  useEffect(() => {
    let resizeTimer: ReturnType<typeof setTimeout>
    const handleResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        if (nodes.length > 0) {
          void fitView({ padding: 0.1, duration: 200 })
        }
      }, 200)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      clearTimeout(resizeTimer)
    }
  }, [fitView, nodes.length])

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
      setDraftSchema(undefined)
    }

    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useAppStore.getState().undo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        useAppStore.getState().redo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault()
        useAppStore.getState().redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  function openNodeEditor(nodeId: string) {
    const node = nodes.find((entry) => entry.id === nodeId)

    if (!node) {
      return
    }

    setEditingNodeId(nodeId)
    setDraftName(node.data.name ?? '')

    if (node.type === 'container') {
      const containerData = node.data as ContainerNodeData
      setDraftColor(containerData.color)
      setDraftDescription('')
      setDraftTechStack('')
      setDraftSchema(undefined)
    } else {
      const blockData = node.data as BlockNodeData
      const isDataLayer = dataLayerInfo.dataLayerBlockIds.has(node.id)
      setDraftDescription(blockData.description)
      setDraftTechStack(blockData.techStack ?? '')
      const linkedSchema = pickSchemaByRefs(
        dataLayerInfo.sharedSchema,
        blockData.schemaRefs,
        blockData.schemaFieldRefs
      )
      setDraftSchema(isDataLayer ? blockData.schema : linkedSchema)
      setDraftColor('blue')
    }

    setContextMenu(null)
  }

  function closeNodeEditor() {
    setEditingNodeId(null)
    setDraftName('')
    setDraftDescription('')
    setDraftTechStack('')
    setDraftSchema(undefined)
    setDraftColor('blue')
  }

  function saveNodeEdits(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!editingNodeId) {
      return
    }

    const node = nodes.find((entry) => entry.id === editingNodeId)

    if (!node) {
      return
    }

    if (node.type === 'container') {
      updateNodeData(editingNodeId, {
        name: draftName.trim(),
        color: draftColor,
      })
    } else {
      const isDataLayer = dataLayerInfo.dataLayerBlockIds.has(node.id)
      const nextNodeData: Partial<BlockNodeData> = {
        name: draftName.trim(),
        description: draftDescription.trim(),
        techStack: draftTechStack.trim(),
      }

      if (isDataLayer) {
        nextNodeData.schema = draftSchema
      } else {
        const nextRefs = getSchemaRefsFromTables(draftSchema)
        const nextFieldRefs = getSchemaFieldRefsFromTables(draftSchema)
        nextNodeData.schemaRefs = nextRefs
        nextNodeData.schemaFieldRefs = nextFieldRefs

        const primaryBlock = dataLayerInfo.primarySchemaBlock
        if (primaryBlock) {
          const primaryData = primaryBlock.data as BlockNodeData
          const mergedSchema = mergeSchemaTablesWithColumns(primaryData.schema, draftSchema)
          updateNodeData(primaryBlock.id, { schema: mergedSchema })
        } else if (draftSchema) {
          // Fallback: no data layer found, persist locally to avoid losing edits.
          nextNodeData.schema = draftSchema
        }
      }

      updateNodeData(editingNodeId, nextNodeData)
    }

    closeNodeEditor()
  }

  const editingNode = editingNodeId ? nodes.find((node) => node.id === editingNodeId) ?? null : null
  const contextNode =
    contextMenu?.kind === 'node'
      ? nodes.find((node) => node.id === contextMenu.nodeId) ?? null
      : null

  const nodeMenuItems =
    contextMenu?.kind === 'node' && contextNode
      ? contextNode.type === 'container'
        ? [
            {
              label: t('edit'),
              onSelect: () => openNodeEditor(contextNode.id),
            },
            {
              label: (contextNode.data as ContainerNodeData).collapsed ? t('expand') : t('collapse'),
              onSelect: () => {
                void toggleContainerCollapse(contextNode.id)
              },
            },
            {
              label: t('delete'),
              onSelect: () => removeNode(contextNode.id),
              tone: 'danger' as const,
            },
          ]
        : [
            {
              label: t('discuss_with_ai'),
              onSelect: () => {
                setSelectedNodeId(contextNode.id)
                setChatOpen(true)
              },
            },
            {
              label: t('build_this_node'),
              onSelect: () => buildNode(contextNode.id),
              disabled: isBuilding,
            },
            {
              label: t('edit'),
              onSelect: () => openNodeEditor(contextNode.id),
            },
            {
              label: t('delete'),
              onSelect: () => removeNode(contextNode.id),
              tone: 'danger' as const,
            },
          ]
      : []

  const canvasMenuItems =
    contextMenu?.kind === 'canvas'
      ? [
          {
            label: t('build_all'),
            onSelect: buildAll,
            disabled: nodes.filter((node) => node.type === 'block').length === 0 || isBuilding,
          },
          {
            label: t('import_project'),
            onSelect: onOpenImportDialog,
          },
        ]
      : []

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-50">
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
        onNodeDragStop={onNodeDragStop}
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
        className="vp-flow bg-[#f8fafc]"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.1}
          color="rgba(203, 213, 225, 0.9)"
        />
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
          className="!bg-white/95"
          maskColor="rgba(248, 250, 252, 0.76)"
          nodeColor="#cbd5e1"
        />
        <Controls className="!bg-white/95 !text-slate-600" />
      </ReactFlow>
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.kind === 'node' ? nodeMenuItems : canvasMenuItems}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-x-6 top-6 z-10 flex justify-center">
          <div className="max-w-md rounded-3xl border border-dashed border-slate-300 bg-white/92 px-4 py-3 text-center text-sm text-slate-500 shadow-lg shadow-slate-200/70 backdrop-blur">
            <p className="text-slate-700">{t('canvas_empty_title')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('canvas_empty_hint')}</p>
          </div>
        </div>
      ) : null}
      {editingNode ? (
        <div
          className="vp-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeNodeEditor()
            }
          }}
        >
          <div
            className={`vp-dialog-card flex max-h-[90vh] w-full flex-col overflow-hidden rounded-[2rem] ${
              editingNode.type === 'block' ? 'max-w-5xl' : 'max-w-lg'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200/80 bg-white/95 px-6 py-4 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{t('edit_node')}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {t('update_node_copy', { type: getNodeTypeLabel(editingNode.type) })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeNodeEditor}
                  aria-label={t('close')}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
                >
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M4 4L12 12M12 4L4 12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5">
              <form onSubmit={saveNodeEdits} className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {t('name')}
                  </span>
                  <input
                    type="text"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    placeholder={editingNode.type === 'container' ? t('container') : t('block')}
                    className="vp-input rounded-2xl px-4 py-3 text-sm"
                  />
                </label>

                {editingNode.type === 'container' ? (
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      {t('color')}
                    </span>
                    <select
                      value={draftColor}
                      onChange={(event) => setDraftColor(event.target.value as ContainerColor)}
                      className="vp-input w-full rounded-2xl px-4 py-3 text-sm"
                    >
                      {CONTAINER_COLOR_OPTIONS.map((color) => (
                        <option key={color} value={color}>
                          {formatContainerColorLabel(color)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        {t('description')}
                      </span>
                      <textarea
                        value={draftDescription}
                        onChange={(event) => setDraftDescription(event.target.value)}
                        rows={4}
                        placeholder={t('node_desc_placeholder')}
                        className="vp-input rounded-2xl px-4 py-3 text-sm"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        {t('tech_stack')}
                      </span>
                      <input
                        type="text"
                        value={draftTechStack}
                        onChange={(event) => setDraftTechStack(event.target.value)}
                        placeholder="React 19 + Next.js 16"
                        className="vp-input rounded-2xl px-4 py-3 text-sm"
                      />
                    </label>

                    <SchemaEditor
                      schema={draftSchema}
                      onChange={setDraftSchema}
                      hint={
                        !dataLayerInfo.dataLayerBlockIds.has(editingNode.id)
                          ? dataLayerInfo.schemaSources.length > 0
                            ? `Edits sync to data layer. This module only links to selected tables. Sources: ${dataLayerInfo.schemaSources.join(', ')}`
                            : 'Edits sync to data layer. This module only links to selected tables.'
                          : undefined
                      }
                    />
                  </>
                )}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeNodeEditor}
                    className="vp-button-secondary rounded-xl px-4 py-2 text-sm"
                  >
                    {t('cancel')}
                  </button>
                  <button type="submit" className="vp-button-primary rounded-xl px-4 py-2 text-sm font-medium">
                    {t('save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
