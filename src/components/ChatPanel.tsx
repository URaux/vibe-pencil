'use client'

import { useMemo, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { canvasToYaml } from '@/lib/schema-engine'
import { useAppStore } from '@/lib/store'
import { getNodeTypeLabel } from '@/lib/ui-text'
import type { ArchitectNodeData, BuildStatus, EdgeType, NodeType } from '@/lib/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface StreamEvent {
  type: 'chunk' | 'done' | 'error'
  text?: string
  error?: string
}

type CanvasAction =
  | {
      action: 'add-node'
      node: Partial<Node<ArchitectNodeData>> & {
        type?: NodeType
        position?: { x?: number; y?: number }
        data?: Partial<ArchitectNodeData>
        name?: string
        description?: string
        status?: BuildStatus
      }
    }
  | { action: 'update-node'; target_id: string; data: Partial<ArchitectNodeData> }
  | { action: 'remove-node'; target_id: string }
  | {
      action: 'add-edge'
      edge: Partial<Edge> & {
        source: string
        target: string
        type?: EdgeType
      }
    }

const GLOBAL_CHAT_KEY = '__global__'
const CANVAS_ACTION_BLOCK = /```json:canvas-action\s*([\s\S]*?)```/gi
const VALID_NODE_TYPES = new Set<NodeType>(['service', 'frontend', 'api', 'database', 'queue', 'external'])
const VALID_EDGE_TYPES = new Set<EdgeType>(['sync', 'async', 'bidirectional'])
const VALID_BUILD_STATUSES = new Set<BuildStatus>(['idle', 'building', 'done', 'error'])

function getChatKey(nodeId: string | null) {
  return nodeId ?? GLOBAL_CHAT_KEY
}

function extractActionBlocks(content: string) {
  return Array.from(content.matchAll(CANVAS_ACTION_BLOCK), (match) => match[1].trim())
}

function buildNodeContext(
  selectedNodeId: string | null,
  nodes: Node<ArchitectNodeData>[],
  edges: Edge[]
) {
  if (!selectedNodeId) {
    return null
  }

  const selectedNode = nodes.find((node) => node.id === selectedNodeId)

  if (!selectedNode) {
    return `Selected node ${selectedNodeId} is no longer on the canvas.`
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
    `Node type: ${selectedNode.type ?? 'service'}`,
    `Node name: ${selectedNode.data.name || selectedNode.id}`,
    `Description: ${selectedNode.data.description || 'None provided.'}`,
    `Status: ${selectedNode.data.status}`,
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
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const chatOpen = useAppStore((state) => state.chatOpen)
  const setChatOpen = useAppStore((state) => state.setChatOpen)
  const addNode = useAppStore((state) => state.addNode)
  const addCanvasEdge = useAppStore((state) => state.addCanvasEdge)
  const removeNode = useAppStore((state) => state.removeNode)
  const updateNodeData = useAppStore((state) => state.updateNodeData)
  const [message, setMessage] = useState('')
  const [histories, setHistories] = useState<Map<string, Message[]>>(() => new Map())
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})

  const activeChatKey = getChatKey(selectedNodeId)
  const activeMessages = histories.get(activeChatKey) ?? []
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null
  const nodeContext = useMemo(
    () => buildNodeContext(selectedNodeId, nodes, edges),
    [edges, nodes, selectedNodeId]
  )

  function updateHistory(chatKey: string, updater: (messages: Message[]) => Message[]) {
    setHistories((current) => {
      const next = new Map(current)
      next.set(chatKey, updater(next.get(chatKey) ?? []))
      return next
    })
  }

  function appendAssistantText(chatKey: string, text: string) {
    updateHistory(chatKey, (current) => {
      if (current.length === 0) {
        return [{ role: 'assistant', content: text }]
      }

      const lastMessage = current.at(-1)

      if (!lastMessage || lastMessage.role !== 'assistant') {
        return [...current, { role: 'assistant', content: text }]
      }

      return [...current.slice(0, -1), { ...lastMessage, content: lastMessage.content + text }]
    })
  }

  function applyCanvasAction(rawAction: string, actionKey: string) {
    try {
      const action = JSON.parse(rawAction) as CanvasAction

      if (action.action === 'add-node') {
        const node = action.node ?? {}
        const index = nodes.length
        const type = VALID_NODE_TYPES.has(node.type ?? 'service') ? (node.type ?? 'service') : 'service'
        const data: Partial<ArchitectNodeData> = node.data ?? {}
        const statusCandidate = typeof data.status === 'string' ? data.status : node.status
        const id =
          typeof node.id === 'string' && node.id
            ? node.id
            : `${type}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`

        addNode({
          id,
          type,
          position: {
            x: typeof node.position?.x === 'number' ? node.position.x : 80 + (index % 3) * 240,
            y: typeof node.position?.y === 'number' ? node.position.y : 80 + Math.floor(index / 3) * 180,
          },
          data: {
            name:
              typeof data.name === 'string'
                ? data.name
                : typeof node.name === 'string'
                  ? node.name
                  : id,
            description:
              typeof data.description === 'string'
                ? data.description
                : typeof node.description === 'string'
                  ? node.description
                  : '',
            status: VALID_BUILD_STATUSES.has(statusCandidate as BuildStatus)
              ? (statusCandidate as BuildStatus)
              : 'idle',
            ...(typeof data.summary === 'string' ? { summary: data.summary } : {}),
            ...(typeof data.errorMessage === 'string'
              ? { errorMessage: data.errorMessage }
              : {}),
          },
        })
      } else if (action.action === 'update-node') {
        updateNodeData(action.target_id, action.data)
      } else if (action.action === 'remove-node') {
        removeNode(action.target_id)
      } else if (action.action === 'add-edge') {
        const edge = action.edge
        const type = VALID_EDGE_TYPES.has(edge.type ?? 'sync') ? (edge.type ?? 'sync') : 'sync'

        addCanvasEdge({
          id:
            typeof edge.id === 'string' && edge.id
              ? edge.id
              : `edge-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`,
          source: edge.source,
          target: edge.target,
          type,
          ...(edge.label ? { label: edge.label } : {}),
        })
      }

      setActionErrors((current) => {
        const next = { ...current }
        delete next[actionKey]
        return next
      })
    } catch (applyError) {
      setActionErrors((current) => ({
        ...current,
        [actionKey]: applyError instanceof Error ? applyError.message : '应用到画布失败。',
      }))
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedMessage = message.trim()

    if (!trimmedMessage || isSending) {
      return
    }

    const chatKey = activeChatKey
    const nextHistory = [...activeMessages, { role: 'user' as const, content: trimmedMessage }]

    setMessage('')
    setError(null)
    setIsSending(true)
    updateHistory(chatKey, () => [...nextHistory, { role: 'assistant', content: '' }])

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
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error('启动对话失败。')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()

        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = parseStreamEvents(buffer)
        buffer = rest

        for (const streamEvent of events) {
          if (streamEvent.type === 'chunk' && streamEvent.text) {
            appendAssistantText(chatKey, streamEvent.text)
            continue
          }

          if (streamEvent.type === 'error') {
            throw new Error(streamEvent.error ?? 'AI 对话失败。')
          }
        }
      }
    } catch (sendError) {
      const errorMessage =
        sendError instanceof Error ? sendError.message : '发送消息时出现问题。'

      setError(errorMessage)
      updateHistory(chatKey, (current) => {
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
        className={`flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3 text-left ${
          chatOpen ? 'bg-white/5' : 'min-h-[4.5rem] xl:flex-1 xl:flex-col xl:justify-center'
        }`}
      >
        <div className={`${chatOpen ? '' : 'xl:flex xl:flex-col xl:items-center xl:gap-2'}`}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-200">AI对话</h2>
          {chatOpen ? (
            <p className="mt-1 text-xs text-gray-500">
              {selectedNode
                ? `节点模式：${selectedNode.data.name || selectedNode.id}`
                : '全局模式：讨论整个画布'}
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-500 xl:mt-0">点击展开</p>
          )}
        </div>
        <div className={`${chatOpen ? 'flex items-center gap-2' : 'xl:flex xl:flex-col xl:items-center'}`}>
          {chatOpen && selectedNode ? (
            <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
              {getNodeTypeLabel(selectedNode.type)}
            </span>
          ) : null}
          <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-gray-400">
            {chatOpen ? '收起' : '展开'}
          </span>
        </div>
      </button>

      {chatOpen ? (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-4">
            {activeMessages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-700 bg-gray-800/40 p-4 text-sm text-gray-500">
                可以讨论架构取舍、实现顺序，或直接让 AI 调整画布。
              </div>
            ) : null}

            {activeMessages.map((entry, messageIndex) => {
              const actionBlocks = entry.role === 'assistant' ? extractActionBlocks(entry.content) : []

              return (
                <div
                  key={`${activeChatKey}-${messageIndex}`}
                  className={`rounded-2xl border px-4 py-3 text-sm shadow-lg shadow-black/10 ${
                    entry.role === 'user'
                      ? 'ml-6 border-cyan-500/30 bg-cyan-500/10 text-cyan-50'
                      : 'mr-6 border-gray-700 bg-gray-800/60 text-gray-100'
                  }`}
                >
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                    {entry.role === 'user' ? '用户' : 'AI'}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{entry.content || '...'}</div>
                  {actionBlocks.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {actionBlocks.map((rawAction, actionIndex) => {
                        const actionKey = `${activeChatKey}-${messageIndex}-${actionIndex}`

                        return (
                          <div key={actionKey} className="space-y-2">
                            <button
                              type="button"
                              onClick={() => applyCanvasAction(rawAction, actionKey)}
                              className="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-500/20"
                            >
                              应用到画布
                            </button>
                            {actionErrors[actionKey] ? (
                              <div className="text-xs text-rose-300">{actionErrors[actionKey]}</div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-white/10 pt-4">
            {error ? <div className="mb-3 text-sm text-rose-300">{error}</div> : null}
            <div className="flex gap-2">
              <input
                type="text"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={selectedNode ? '输入你想讨论的节点问题...' : '输入你想讨论的架构问题...'}
                className="flex-1 rounded-xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
                disabled={isSending}
              />
              <button
                type="submit"
                disabled={isSending || !message.trim()}
                className="rounded-xl border border-cyan-500/60 bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSending ? '发送中...' : '发送'}
              </button>
            </div>
          </form>
        </>
      ) : null}
    </div>
  )
}
