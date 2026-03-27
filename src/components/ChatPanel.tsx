'use client'

import { useMemo, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { canvasToYaml } from '@/lib/schema-engine'
import { useAppStore, type ChatMessage } from '@/lib/store'
import { getNodeTypeLabel } from '@/lib/ui-text'
import type { ArchitectNodeData, BuildStatus, EdgeType, NodeType } from '@/lib/types'

type Message = ChatMessage

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
const CANVAS_ACTION_BLOCK = /```(?:json)?(?::canvas-action)?\s*([\s\S]*?)```/gi
const VALID_NODE_TYPES = new Set<NodeType>(['service', 'frontend', 'api', 'database', 'queue', 'external'])
const VALID_EDGE_TYPES = new Set<EdgeType>(['sync', 'async', 'bidirectional'])
const VALID_BUILD_STATUSES = new Set<BuildStatus>(['idle', 'building', 'done', 'error'])

function getChatKey(nodeId: string | null) {
  return nodeId ?? GLOBAL_CHAT_KEY
}

function tryRepairJson(text: string) {
  let cleaned = text.trim()
  if (!cleaned) return null

  // If it doesn't start with { or [, it's definitely not what we want
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const startIdx = Math.max(cleaned.indexOf('{'), cleaned.indexOf('['))
    if (startIdx === -1) return null
    cleaned = cleaned.slice(startIdx)
  }

  // Self-healing: count braces and brackets
  let openBraces = 0
  let openBrackets = 0
  let inString = false
  let escaped = false
  let lastValidIdx = 0

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]
    if (char === '"' && !escaped) inString = !inString
    if (inString) {
      escaped = char === '\\' && !escaped
      continue
    }

    if (char === '{') openBraces++
    else if (char === '}') openBraces--
    else if (char === '[') openBrackets++
    else if (char === ']') openBrackets--

    // If we've balanced the root object/array, mark this as a potential valid end
    if (openBraces === 0 && openBrackets === 0) {
      lastValidIdx = i + 1
    }
  }

  // If cut off, try to force close it
  let candidate = cleaned
  if (openBraces > 0 || openBrackets > 0 || inString) {
    if (inString) candidate += '"'
    candidate += '}'.repeat(Math.max(0, openBraces))
    candidate += ']'.repeat(Math.max(0, openBrackets))
  }

  try {
    return JSON.parse(candidate)
  } catch {
    // If repair failed, try the last known balanced point
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

function extractActionBlocks(content: string) {
  // 1. Try traditional markdown blocks
  const blocks = Array.from(content.matchAll(CANVAS_ACTION_BLOCK), (match) => match[1].trim())
  
  // 2. If no valid blocks or they look truncated, look for raw JSON patterns
  // This helps when the AI forgets the closing ```
  if (blocks.length === 0 || content.trim().endsWith(blocks[blocks.length - 1])) {
    const rawJsonMatches = content.match(/\{(?:[^{}]|(\{[^{}]*\}))*"action"\s*:\s*"[^"]+"[\s\S]*?(?=\s*```|$)/g)
    if (rawJsonMatches) {
      for (const match of rawJsonMatches) {
        if (!blocks.includes(match.trim())) {
          blocks.push(match.trim())
        }
      }
    }
  }

  return blocks.filter(block => block.includes('"action"') || block.includes("'action'"))
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
  const backend = useAppStore((state) => state.config.agent)
  const model = useAppStore((state) => state.config.model)
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const chatOpen = useAppStore((state) => state.chatOpen)
  const setChatOpen = useAppStore((state) => state.setChatOpen)
  const addNode = useAppStore((state) => state.addNode)
  const addCanvasEdge = useAppStore((state) => state.addCanvasEdge)
  const removeNode = useAppStore((state) => state.removeNode)
  const updateNodeData = useAppStore((state) => state.updateNodeData)
  const chatHistories = useAppStore((state) => state.chatHistories)
  const updateChatHistory = useAppStore((state) => state.updateChatHistory)
  useAppStore((state) => state.locale)
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})

  const activeChatKey = getChatKey(selectedNodeId)
  const activeMessages = chatHistories.get(activeChatKey) ?? []
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null
  const nodeContext = useMemo(
    () => buildNodeContext(selectedNodeId, nodes, edges),
    [edges, nodes, selectedNodeId]
  )

  function appendAssistantText(chatKey: string, text: string) {
    updateChatHistory(chatKey, (current) => {
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
      const parsed = tryRepairJson(rawAction)
      if (!parsed) {
        throw new Error(t('invalid_json_format') || 'Invalid JSON format')
      }

      const actions = Array.isArray(parsed) ? parsed : [parsed]

      for (const action of actions) {
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
      }

      setActionErrors((current) => {
        const next = { ...current }
        delete next[actionKey]
        return next
      })
    } catch (applyError) {
      setActionErrors((current) => ({
        ...current,
        [actionKey]: applyError instanceof Error ? applyError.message : t('apply_canvas_failed'),
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
    updateChatHistory(chatKey, () => [...nextHistory, { role: 'assistant', content: '' }])

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
            appendAssistantText(chatKey, streamEvent.text)
            continue
          }

          if (streamEvent.type === 'error') {
            throw new Error(streamEvent.error ?? t('chat_failed'))
          }
        }
      }

      // Automatically apply canvas actions after stream completes
      const actionBlocks = extractActionBlocks(fullAssistantText)
      for (let i = 0; i < actionBlocks.length; i++) {
        applyCanvasAction(actionBlocks[i], `auto-${chatKey}-${Date.now()}-${i}`)
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t('send_failed'))
      updateChatHistory(chatKey, (current) => {
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
              const actionBlocks = entry.role === 'assistant' ? extractActionBlocks(entry.content) : []

              return (
                <div
                  key={`${activeChatKey}-${messageIndex}`}
                  className={`rounded-[1.5rem] border px-4 py-3 text-sm shadow-sm ${
                    entry.role === 'user'
                      ? 'ml-6 border-orange-200 bg-orange-50 text-orange-900'
                      : 'mr-6 border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                    {entry.role === 'user' ? t('user') : t('assistant')}
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
                              className="vp-button-primary rounded-full px-3 py-1 text-xs font-medium"
                            >
                              {t('apply_to_canvas')}
                            </button>
                            {actionErrors[actionKey] ? (
                              <div className="text-xs text-rose-600">{actionErrors[actionKey]}</div>
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

          <form onSubmit={handleSubmit} className="border-t border-slate-200 pt-4">
            {error ? <div className="mb-3 text-sm text-rose-600">{error}</div> : null}
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
