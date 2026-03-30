'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { extractActionBlocks, extractVisibleChatText } from '@/lib/chat-actions'
import { layoutArchitectureCanvas } from '@/lib/graph-layout'
import { canvasToYaml } from '@/lib/schema-engine'
import { useAppStore, type ChatMessage } from '@/lib/store'
import { getNodeTypeLabel } from '@/lib/ui-text'
import type {
  BlockNodeData,
  BuildStatus,
  CanvasNodeData,
  ContainerColor,
  ContainerNodeData,
  EdgeType,
  VPNodeType,
} from '@/lib/types'

type Message = ChatMessage
type CanvasNode = Node<CanvasNodeData>

interface StreamEvent {
  type: 'chunk' | 'done' | 'error'
  text?: string
  error?: string
}

type CanvasAction =
  | {
      action: 'add-node'
      node: Partial<CanvasNode> & {
        type?: VPNodeType
        position?: { x?: number; y?: number }
        parentId?: string | null
        data?: Partial<CanvasNodeData>
        name?: string
        description?: string
        status?: BuildStatus
        color?: ContainerColor
        collapsed?: boolean
        techStack?: string
      }
    }
  | { action: 'update-node'; target_id: string; data: Partial<CanvasNodeData> }
  | { action: 'remove-node'; target_id: string }
  | {
      action: 'add-edge'
      edge: Partial<Edge> & {
        source: string
        target: string
        type?: EdgeType
      }
    }

const VALID_NODE_TYPES = new Set<VPNodeType>(['container', 'block'])
const VALID_EDGE_TYPES = new Set<EdgeType>(['sync', 'async', 'bidirectional'])
const VALID_BUILD_STATUSES = new Set<BuildStatus>(['idle', 'building', 'done', 'error'])
const VALID_CONTAINER_COLORS = new Set<ContainerColor>([
  'blue',
  'green',
  'purple',
  'amber',
  'rose',
  'slate',
])

function tryRepairJson(text: string) {
  let cleaned = text.trim()
  if (!cleaned) return null

  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const startIdx = Math.max(cleaned.indexOf('{'), cleaned.indexOf('['))
    if (startIdx === -1) return null
    cleaned = cleaned.slice(startIdx)
  }

  let openBraces = 0
  let openBrackets = 0
  let inString = false
  let escaped = false
  let lastValidIdx = 0

  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i]
    if (char === '"' && !escaped) inString = !inString
    if (inString) {
      escaped = char === '\\' && !escaped
      continue
    }

    if (char === '{') openBraces += 1
    else if (char === '}') openBraces -= 1
    else if (char === '[') openBrackets += 1
    else if (char === ']') openBrackets -= 1

    if (openBraces === 0 && openBrackets === 0) {
      lastValidIdx = i + 1
    }
  }

  let candidate = cleaned
  if (openBraces > 0 || openBrackets > 0 || inString) {
    if (inString) candidate += '"'
    candidate += '}'.repeat(Math.max(0, openBraces))
    candidate += ']'.repeat(Math.max(0, openBrackets))
  }

  try {
    return JSON.parse(candidate)
  } catch {
    if (lastValidIdx > 0) {
      try {
        return JSON.parse(cleaned.slice(0, lastValidIdx))
      } catch {
        return null
      }
    }

    return null
  }
}

function buildNodeContext(
  selectedNodeId: string | null,
  nodes: CanvasNode[],
  edges: Edge[]
) {
  if (!selectedNodeId) {
    return null
  }

  const selectedNode = nodes.find((node) => node.id === selectedNodeId)

  if (!selectedNode) {
    return `Selected node ${selectedNodeId} is no longer on the canvas.`
  }

  if (selectedNode.type === 'container') {
    const childBlocks = nodes.filter((node) => node.type === 'block' && node.parentId === selectedNode.id)

    return [
      `Node id: ${selectedNode.id}`,
      `Node type: ${selectedNode.type}`,
      `Node name: ${selectedNode.data.name || selectedNode.id}`,
      `Color: ${selectedNode.data.color}`,
      `Collapsed: ${selectedNode.data.collapsed ? 'yes' : 'no'}`,
      `Child blocks: ${childBlocks.length}`,
      ...childBlocks.map((block) => `- ${block.data.name || block.id}`),
    ].join('\n')
  }

  const connectedEdges = edges.filter(
    (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId
  )
  const nodeNames = new Map(nodes.map((node) => [node.id, node.data.name || node.id]))
  const edgeSummary =
    connectedEdges.length > 0
      ? connectedEdges
          .map((edge) => {
            const sourceName = nodeNames.get(edge.source) ?? edge.source
            const targetName = nodeNames.get(edge.target) ?? edge.target
            const label = edge.label ? ` [${String(edge.label)}]` : ''

            return `- ${sourceName} -> ${targetName} (${edge.type ?? 'sync'})${label}`
          })
          .join('\n')
      : '- No connected edges.'

  return [
    `Node id: ${selectedNode.id}`,
    `Node type: ${selectedNode.type}`,
    `Node name: ${selectedNode.data.name || selectedNode.id}`,
    `Description: ${selectedNode.data.description || 'None provided.'}`,
    `Status: ${selectedNode.data.status}`,
    `Tech stack: ${selectedNode.data.techStack || 'Not specified.'}`,
    'Connected edges:',
    edgeSummary,
  ].join('\n')
}

function parseStreamEvents(buffer: string) {
  const events: StreamEvent[] = []
  let rest = buffer

  while (true) {
    const boundary = rest.indexOf('\n\n')

    if (boundary === -1) {
      break
    }

    const rawEvent = rest.slice(0, boundary)
    rest = rest.slice(boundary + 2)

    const dataLine = rawEvent
      .split('\n')
      .find((line) => line.startsWith('data:'))

    if (!dataLine) {
      continue
    }

    try {
      events.push(JSON.parse(dataLine.slice(5).trim()) as StreamEvent)
    } catch {
      continue
    }
  }

  return { events, rest }
}

export function ChatPanel() {
  const nodes = useAppStore((state) => state.nodes)
  const edges = useAppStore((state) => state.edges)
  const projectName = useAppStore((state) => state.projectName)
  const backend = useAppStore((state) => state.config.agent)
  const model = useAppStore((state) => state.config.model)
  const locale = useAppStore((state) => state.locale)
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const chatOpen = useAppStore((state) => state.chatOpen)
  const setChatOpen = useAppStore((state) => state.setChatOpen)
  const setCanvas = useAppStore((state) => state.setCanvas)
  const chatSessions = useAppStore((state) => state.chatSessions)
  const activeChatSessionId = useAppStore((state) => state.activeChatSessionId)
  const createChatSession = useAppStore((state) => state.createChatSession)
  const updateActiveChatMessages = useAppStore((state) => state.updateActiveChatMessages)
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [lastCanvasSnapshot, setLastCanvasSnapshot] = useState<{
    nodes: CanvasNode[]
    edges: Edge[]
  } | null>(null)
  const [lastAppliedActionKey, setLastAppliedActionKey] = useState<string | null>(null)

  const activeSession = chatSessions.find((s) => s.id === activeChatSessionId)
  const activeMessages = activeSession?.messages ?? []
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null

  // Auto-restore canvas when switching to a session without saved snapshot
  const prevSessionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeChatSessionId || activeChatSessionId === prevSessionRef.current) return
    prevSessionRef.current = activeChatSessionId
    const session = chatSessions.find((s) => s.id === activeChatSessionId)
    if (session?.canvasSnapshot) return // already has snapshot, store handled it
    // Find last message with add-node actions and auto-apply
    const lastActionMsg = [...(session?.messages ?? [])].reverse().find(
      (m) => m.role === 'assistant' && m.actions?.some((a) => a.includes('"add-node"'))
    )
    if (lastActionMsg?.actions) {
      const actionKey = `${activeChatSessionId}-auto-restore`
      void applyCanvasActions(lastActionMsg.actions, actionKey)
    }
  }, [activeChatSessionId, chatSessions])
  const nodeContext = useMemo(
    () => buildNodeContext(selectedNodeId, nodes, edges),
    [edges, nodes, selectedNodeId]
  )

  function updateAssistantMessage(content: string, actions?: string[]) {
    updateActiveChatMessages((current) => {
      if (current.length === 0) {
        return [{ role: 'assistant', content, ...(actions ? { actions } : {}) }]
      }

      const lastMessage = current.at(-1)

      if (!lastMessage || lastMessage.role !== 'assistant') {
        return [...current, { role: 'assistant', content, ...(actions ? { actions } : {}) }]
      }

      return [...current.slice(0, -1), { ...lastMessage, content, ...(actions ? { actions } : {}) }]
    })
  }

  function cloneCanvasSnapshot() {
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

  function applyActionToSnapshot(
    action: CanvasAction,
    currentNodes: CanvasNode[],
    currentEdges: Edge[]
  ): { nodes: CanvasNode[]; edges: Edge[] } {
    if (action.action === 'add-node') {
      const node = action.node ?? {}
      const type = VALID_NODE_TYPES.has(node.type ?? 'block') ? (node.type ?? 'block') : 'block'
      const id =
        typeof node.id === 'string' && node.id
          ? node.id
          : `${type}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`

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
            color: VALID_CONTAINER_COLORS.has(colorCandidate as ContainerColor)
              ? (colorCandidate as ContainerColor)
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
      const parentId =
        typeof node.parentId === 'string' &&
        currentNodes.some((entry) => entry.id === node.parentId && entry.type === 'container')
          ? node.parentId
          : undefined
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
          status: VALID_BUILD_STATUSES.has(statusCandidate as BuildStatus)
            ? (statusCandidate as BuildStatus)
            : 'idle',
          ...(typeof data?.summary === 'string' ? { summary: data.summary } : {}),
          ...(typeof data?.errorMessage === 'string' ? { errorMessage: data.errorMessage } : {}),
          ...(typeof data?.techStack === 'string'
            ? { techStack: data.techStack }
            : typeof node.techStack === 'string'
              ? { techStack: node.techStack }
              : {}),
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

      if (
        !currentNodes.some((n) => n.id === edge.source) ||
        !currentNodes.some((n) => n.id === edge.target)
      ) {
        // Skip edges referencing non-existent nodes instead of throwing
        return { nodes: currentNodes, edges: currentEdges }
      }

      const type = VALID_EDGE_TYPES.has(edge.type ?? 'sync') ? (edge.type ?? 'sync') : 'sync'

      const newEdge: Edge = {
        id:
          typeof edge.id === 'string' && edge.id
            ? edge.id
            : `edge-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`,
        source: edge.source,
        target: edge.target,
        type,
        ...(edge.label ? { label: edge.label } : {}),
      }
      return { nodes: currentNodes, edges: [...currentEdges, newEdge] }
    }

    return { nodes: currentNodes, edges: currentEdges }
  }

  async function applyCanvasActions(rawActions: string[], actionKey: string) {
    if (rawActions.length === 0) {
      return
    }

    const snapshot = cloneCanvasSnapshot()

    try {
      // Full canvas replacement — AI actions describe the complete architecture
      let workingNodes: CanvasNode[] = []
      let workingEdges: Edge[] = []

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
          const result = applyActionToSnapshot(action, workingNodes, workingEdges)
          workingNodes = result.nodes
          workingEdges = result.edges
        }
      }

      const arranged = await layoutArchitectureCanvas(workingNodes, workingEdges)
      setCanvas(arranged.nodes, arranged.edges)
      // Save canvas snapshot to current chat session for session switching
      if (activeChatSessionId) {
        const sessions = useAppStore.getState().chatSessions
        const updated = sessions.map((s) =>
          s.id === activeChatSessionId
            ? { ...s, canvasSnapshot: { nodes: arranged.nodes, edges: arranged.edges } }
            : s
        )
        useAppStore.setState({ chatSessions: updated })
      }
      setLastCanvasSnapshot(snapshot)
      setLastAppliedActionKey(actionKey)
      setActionErrors((current) => {
        const next = { ...current }
        delete next[actionKey]
        return next
      })
    } catch (applyError) {
      setActionErrors((current) => ({
        ...current,
        [actionKey]:
          applyError instanceof Error ? applyError.message : t('apply_canvas_failed'),
      }))
    }
  }

  function restorePreviousCanvasVersion(actionKey: string) {
    if (!lastCanvasSnapshot || lastAppliedActionKey !== actionKey) {
      return
    }

    setCanvas(lastCanvasSnapshot.nodes, lastCanvasSnapshot.edges)
    setLastCanvasSnapshot(null)
    setLastAppliedActionKey(null)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedMessage = message.trim()

    if (!trimmedMessage || isSending) {
      return
    }

    const sessionId = activeChatSessionId ?? createChatSession()
    const nextHistory = [...activeMessages, { role: 'user' as const, content: trimmedMessage }]
    const shouldAutoApply = activeMessages.length === 0
    const assistantActionKey = `${sessionId}-${nextHistory.length}`

    setMessage('')
    setError(null)
    setIsSending(true)
    updateActiveChatMessages(() => [...nextHistory, { role: 'assistant', content: '' }])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmedMessage,
          history: nextHistory,
          nodeContext,
          architecture_yaml: canvasToYaml(nodes, edges, projectName),
          backend,
          model,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error(t('chat_start_failed'))
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullAssistantText = ''
      let visibleAssistantText = ''

      while (true) {
        const { value, done } = await reader.read()

        if (done) {
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk
        const { events, rest } = parseStreamEvents(buffer)
        buffer = rest

        for (const streamEvent of events) {
          if (streamEvent.type === 'chunk' && streamEvent.text) {
            fullAssistantText += streamEvent.text
            const nextVisibleText = extractVisibleChatText(fullAssistantText)
            if (nextVisibleText !== visibleAssistantText) {
              visibleAssistantText = nextVisibleText
              updateAssistantMessage(visibleAssistantText)
            }
            continue
          }

          if (streamEvent.type === 'error') {
            throw new Error(streamEvent.error ?? t('chat_failed'))
          }
        }
      }

      const actionBlocks = extractActionBlocks(fullAssistantText)
      updateAssistantMessage(extractVisibleChatText(fullAssistantText), actionBlocks)
      if (shouldAutoApply && actionBlocks.length > 0) {
        await applyCanvasActions(actionBlocks, assistantActionKey)
      }
      // Auto-generate session title via AI summary
      const currentSession = useAppStore.getState().chatSessions.find((s) => s.id === activeChatSessionId)
      if (currentSession && !currentSession.title && activeChatSessionId) {
        const sid = activeChatSessionId
        const visibleText = extractVisibleChatText(fullAssistantText)
        // Fire-and-forget: ask AI for a short title
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Based on this conversation, generate a short title (max 20 chars, Chinese preferred). Just output the title, nothing else.\n\nUser: ${trimmedMessage}\nAssistant: ${visibleText.slice(0, 500)}`,
            history: [],
            nodeContext: '',
            architecture_yaml: '',
            backend,
            model,
          }),
        }).then(async (res) => {
          if (!res.ok || !res.body) return
          const reader = res.body.getReader()
          const dec = new TextDecoder()
          let title = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            for (const line of dec.decode(value, { stream: true }).split('\n')) {
              if (line.startsWith('data:')) {
                try {
                  const evt = JSON.parse(line.slice(5).trim()) as { text?: string }
                  if (evt.text) title += evt.text
                } catch { /* skip */ }
              }
            }
          }
          const cleaned = title.replace(/^["'`]|["'`]$/g, '').trim()
          if (cleaned) {
            useAppStore.getState().renameChatSession(sid, cleaned.slice(0, 30))
          }
        }).catch(() => { /* title generation is best-effort */ })
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t('send_failed'))
      updateActiveChatMessages((current) => {
        const lastMessage = current.at(-1)

        if (!lastMessage || lastMessage.role !== 'assistant' || lastMessage.content.trim()) {
          return current
        }

        return current.slice(0, -1)
      })
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <button
        type="button"
        aria-expanded={chatOpen}
        onClick={() => setChatOpen(!chatOpen)}
        className={`flex items-center justify-between gap-3 rounded-[1.5rem] border border-slate-200 bg-white px-4 py-3 text-left shadow-sm ${
          chatOpen ? '' : 'min-h-[4.5rem] xl:flex-1 xl:flex-col xl:justify-center'
        }`}
      >
        <div className={`${chatOpen ? '' : 'xl:flex xl:flex-col xl:items-center xl:gap-2'}`}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{t('ai_chat')}</h2>
          {chatOpen ? (
            <p className="mt-1 text-xs text-slate-500">
              {selectedNode
                ? t('node_mode', { name: selectedNode.data.name || selectedNode.id })
                : t('global_mode')}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500 xl:mt-0">{t('click_expand')}</p>
          )}
        </div>
        <div className={`${chatOpen ? 'flex items-center gap-2' : 'xl:flex xl:flex-col xl:items-center'}`}>
          {chatOpen && selectedNode ? (
            <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-700">
              {getNodeTypeLabel(selectedNode.type)}
            </span>
          ) : null}
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
            {chatOpen ? t('collapse') : t('expand')}
          </span>
        </div>
      </button>

      {chatOpen ? (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4">
            {activeMessages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                {t('chat_empty_state')}
              </div>
            ) : null}

            {activeMessages.map((entry, messageIndex) => {
              const rawActionBlocks = entry.role === 'assistant' ? (entry.actions ?? []) : []
              // Only show "Apply to Canvas" if actions contain add-node (full architecture)
              const actionBlocks = rawActionBlocks.some((block) => block.includes('"add-node"'))
                ? rawActionBlocks
                : []

              return (
                <div
                  key={`${activeChatSessionId}-${messageIndex}`}
                  className={`rounded-[1.5rem] border px-4 py-3 text-sm shadow-sm ${
                    entry.role === 'user'
                      ? 'ml-6 border-orange-200 bg-orange-50 text-orange-900'
                      : 'mr-6 border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {entry.role === 'user' ? t('user') : t('assistant')}
                  </div>
                  <div className="whitespace-pre-wrap break-words">
                    {entry.content || (entry.role === 'assistant' && actionBlocks.length > 0 ? '' : '...')}
                  </div>
                  {actionBlocks.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(() => {
                        const actionKey = `${activeChatSessionId}-${messageIndex}`

                        return (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  void applyCanvasActions(actionBlocks, actionKey)
                                }}
                                className="vp-button-primary rounded-full px-3 py-1 text-xs font-medium"
                              >
                                {t('apply_to_canvas')}
                              </button>
                              {lastCanvasSnapshot && lastAppliedActionKey === actionKey ? (
                                <button
                                  type="button"
                                  onClick={() => restorePreviousCanvasVersion(actionKey)}
                                  className="vp-button-secondary rounded-full px-3 py-1 text-xs font-medium"
                                >
                                  {locale === 'zh' ? '恢复上一个版本' : 'Restore Previous Version'}
                                </button>
                              ) : null}
                            </div>
                            {actionErrors[actionKey] ? (
                              <div className="max-h-16 overflow-y-auto text-xs text-rose-600">{actionErrors[actionKey]}</div>
                            ) : null}
                          </div>
                        )
                      })()}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-slate-200 pt-4">
            {error ? <div className="mb-3 max-h-20 overflow-y-auto text-sm text-rose-600">{error}</div> : null}
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={t('type_message')}
                className="vp-input flex-1 rounded-xl px-4 py-3 text-sm"
                disabled={isSending}
              />
              <button
                type="submit"
                disabled={isSending || !message.trim()}
                className="vp-button-primary rounded-xl px-4 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSending ? t('sending') : t('send')}
              </button>
            </div>
          </form>
        </>
      ) : null}
    </div>
  )
}
