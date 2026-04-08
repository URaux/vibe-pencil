'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { t } from '@/lib/i18n'
import { getRandomChatThinkingMessage } from '@/lib/loading-messages'
import { extractActionBlocks, extractVisibleChatText, extractUserChoices } from '@/lib/chat-actions'
import { parseOptions } from '@/lib/option-parser'
import { ChatMarkdown } from './ChatMarkdown'
import { OptionCards } from './OptionCards'
import { canvasToYaml } from '@/lib/schema-engine'
import { formatBuildContext } from '@/lib/build-context-formatter'
import { useAppStore } from '@/lib/store'
import { getNodeTypeLabel } from '@/lib/ui-text'
import { useCanvasActions } from '@/hooks/useCanvasActions'
import type {
  BlockNodeData,
  CanvasNodeData,
  ContainerNodeData,
} from '@/lib/types'

type CanvasNode = Node<CanvasNodeData>

interface StreamEvent {
  type: 'chunk' | 'done' | 'error' | 'session'
  text?: string
  error?: string
  ccSessionId?: string
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
    const containerData = selectedNode.data as ContainerNodeData
    const childBlocks = nodes.filter(
      (node) => node.type === 'block' && node.parentId === selectedNode.id
    )
    const childIds = new Set(childBlocks.map((b) => b.id))
    const nodeNames = new Map(nodes.map((node) => [node.id, node.data.name || node.id]))

    // Partition edges into internal (both endpoints are children) vs external (one endpoint is outside)
    const internalEdges = edges.filter(
      (edge) => childIds.has(edge.source) && childIds.has(edge.target)
    )
    const externalEdges = edges.filter(
      (edge) =>
        (childIds.has(edge.source) && !childIds.has(edge.target)) ||
        (!childIds.has(edge.source) && childIds.has(edge.target))
    )

    const sections: string[] = [
      `Selected Container: "${containerData.name || selectedNode.id}" (type: container)`,
      `Color: ${containerData.color}`,
      `Collapsed: ${containerData.collapsed ? 'yes' : 'no'}`,
      '',
      `Child Blocks (${childBlocks.length}):`,
    ]

    for (const block of childBlocks) {
      const bd = block.data as BlockNodeData
      const meta: string[] = []
      if (bd.status) meta.push(`status: ${bd.status}`)
      if (bd.techStack) meta.push(`techStack: ${bd.techStack}`)
      const metaStr = meta.length > 0 ? ` (${meta.join(', ')})` : ''
      sections.push(`  - ${bd.name || block.id}${metaStr}`)
      if (bd.description) {
        sections.push(`    Description: ${bd.description}`)
      }
      if (bd.status === 'error' && bd.errorMessage) {
        sections.push(`    Error: "${bd.errorMessage}"`)
      }
      const bs = bd.buildSummary
      if (bs) {
        const fileParts: string[] = []
        if (bs.filesCreated.length > 0) fileParts.push(`files: [${bs.filesCreated.join(', ')}]`)
        if (bs.dependencies.length > 0) fileParts.push(`deps: [${bs.dependencies.join(', ')}]`)
        if (fileParts.length > 0) {
          sections.push(`    Build: ${fileParts.join(', ')}`)
        }
      }
    }

    if (internalEdges.length > 0) {
      sections.push('')
      sections.push('Internal Connections:')
      for (const edge of internalEdges) {
        const srcName = nodeNames.get(edge.source) ?? edge.source
        const tgtName = nodeNames.get(edge.target) ?? edge.target
        const label = edge.label ? ` [${String(edge.label)}]` : ''
        sections.push(`  - ${srcName} → ${tgtName} (${edge.type ?? 'sync'})${label}`)
      }
    } else {
      sections.push('')
      sections.push('Internal Connections: none')
    }

    if (externalEdges.length > 0) {
      sections.push('')
      sections.push('External Connections:')
      for (const edge of externalEdges) {
        const srcName = nodeNames.get(edge.source) ?? edge.source
        const tgtName = nodeNames.get(edge.target) ?? edge.target
        const label = edge.label ? ` [${String(edge.label)}]` : ''
        const isOutgoing = childIds.has(edge.source)
        const direction = isOutgoing ? 'outgoing to outside' : 'incoming from outside'
        sections.push(
          `  - ${srcName} → ${tgtName} (${edge.type ?? 'sync'})${label} [${direction}]`
        )
      }
    }

    return sections.join('\n')
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

  const sections: string[] = [
    `Node id: ${selectedNode.id}`,
    `Node type: ${selectedNode.type}`,
    `Node name: ${selectedNode.data.name || selectedNode.id}`,
    `Description: ${selectedNode.data.description || 'None provided.'}`,
    `Status: ${selectedNode.data.status}`,
    `Tech stack: ${selectedNode.data.techStack || 'Not specified.'}`,
    'Connected edges:',
    edgeSummary,
  ]

  const blockData = selectedNode.data as BlockNodeData

  // Inject build summary if available
  const bs = blockData.buildSummary
  if (bs) {
    sections.push('')
    sections.push('## Build Results (from last build)')
    sections.push(`Built at: ${new Date(bs.builtAt).toISOString()}`)
    sections.push(`Duration: ${(bs.durationMs / 1000).toFixed(1)}s`)
    sections.push(`Backend: ${bs.backend}${bs.model ? ` (${bs.model})` : ''}`)
    if (bs.filesCreated.length > 0) {
      sections.push(`Files created: ${bs.filesCreated.join(', ')}`)
    }
    if (bs.entryPoint) {
      sections.push(`Entry point: ${bs.entryPoint}`)
    }
    if (bs.dependencies.length > 0) {
      sections.push(`Dependencies: ${bs.dependencies.join(', ')}`)
    }
    if (bs.techDecisions.length > 0) {
      sections.push('Key decisions:')
      for (const d of bs.techDecisions) sections.push(`- ${d}`)
    }
    if (bs.warnings.length > 0) {
      sections.push('Warnings:')
      for (const w of bs.warnings) sections.push(`- ${w}`)
    }
  }

  // Inject build history if available
  const history = blockData.buildHistory
  if (history && history.length > 0) {
    sections.push('')
    sections.push('## Build History')
    history.forEach((attempt, i) => {
      const time = new Date(attempt.builtAt).toISOString()
      const statusLabel = attempt.status === 'done' ? 'SUCCESS' : 'FAILED'
      sections.push(
        `${i + 1}. [${statusLabel}] ${time} (${(attempt.durationMs / 1000).toFixed(0)}s) — ${attempt.summaryDigest}`
      )
      if (attempt.errorDigest) {
        sections.push(`   Error: ${attempt.errorDigest}`)
      }
    })
  }

  // Inject error context if build failed
  if (blockData.status === 'error' && blockData.errorMessage) {
    sections.push('')
    sections.push('## Build Error')
    sections.push(blockData.errorMessage)
  }

  return sections.join('\n')
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

function getAgentDisplayName(backend: string, model: string): string {
  const m = model.toLowerCase()
  // Claude family: claude-*, opus, sonnet, haiku
  if (/claude|opus|sonnet|haiku/.test(m)) return 'Claude'
  // OpenAI family: gpt-*, chatgpt-*, o1, o3, o4-mini
  if (/gpt|chatgpt|^o[1-4]/.test(m)) return 'GPT'
  // Gemini family
  if (/gemini|gemma/.test(m)) return 'Gemini'
  // DeepSeek
  if (/deepseek/.test(m)) return 'DeepSeek'
  // Qwen
  if (/qwen/.test(m)) return 'Qwen'
  // Llama / Meta
  if (/llama|meta/.test(m)) return 'Llama'
  // Mistral
  if (/mistral|mixtral/.test(m)) return 'Mistral'
  // Backend fallbacks
  if (backend === 'claude-code') return 'Claude'
  if (backend === 'codex') return 'Codex'
  if (backend === 'gemini') return 'Gemini'
  if (backend === 'custom-api') return model || 'API'
  return 'AI'
}

export function ChatPanel() {
  const nodes = useAppStore((state) => state.nodes)
  const edges = useAppStore((state) => state.edges)
  const projectName = useAppStore((state) => state.projectName)
  const backend = useAppStore((state) => state.config.agent)
  const rawModel = useAppStore((state) => state.config.model)
  const customApiModel = useAppStore((state) => state.config.customApiModel)
  const model = backend === 'custom-api' && customApiModel ? customApiModel : rawModel
  const customApiBase = useAppStore((state) => state.config.customApiBase)
  const customApiKey = useAppStore((state) => state.config.customApiKey)
  const locale = useAppStore((state) => state.locale)
  const selectedNodeId = useAppStore((state) => state.selectedNodeId)
  const chatOpen = useAppStore((state) => state.chatOpen)
  const setChatOpen = useAppStore((state) => state.setChatOpen)
  const chatSessions = useAppStore((state) => state.chatSessions)
  const activeChatSessionId = useAppStore((state) => state.activeChatSessionId)
  const createChatSession = useAppStore((state) => state.createChatSession)
  const setSessionPhase = useAppStore((state) => state.setSessionPhase)
  const updateActiveChatMessages = useAppStore((state) => state.updateActiveChatMessages)
  const updateChatSession = useAppStore((state) => state.updateChatSession)
  const workDir = useAppStore((state) => state.config.workDir)
  const { applyCanvasActions, restoreSnapshot, actionErrors } = useCanvasActions()
  const [message, setMessage] = useState('')
  const [isSending, setIsSending] = useState(false)
  const sendLockRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [codeContext, setCodeContext] = useState<string | null>(null)
  const [isLoadingCode, setIsLoadingCode] = useState(false)
  const [thinkingMsg, setThinkingMsg] = useState('')

  const activeSession = chatSessions.find((s) => s.id === activeChatSessionId)
  const activeMessages = activeSession?.messages ?? []

  // Memoized brainstorm progress from last real assistant message
  const brainstormProgress = useMemo(() => {
    if (activeSession?.phase !== 'brainstorm') return null
    const lastAssistant = [...activeMessages].reverse().find(m =>
      m.role === 'assistant' && !m.content.startsWith('[构建]') && !m.content.startsWith('[系统]')
    )
    if (!lastAssistant?.content) return null
    // Match the last occurrence of progress comment (not first, to avoid quoted copies)
    const matches = [...lastAssistant.content.matchAll(/<!--\s*progress:\s*dimensions_covered=(\d+)\/(\d+)\s*round=(\d+)\/(\d+)\s*-->/g)]
    const match = matches.length > 0 ? matches[matches.length - 1] : null
    if (!match) return null
    // Clamp to valid ranges
    const dims = Math.min(parseInt(match[1], 10), 6)
    const round = Math.min(Math.max(parseInt(match[3], 10), 1), 8)
    return { dims: String(dims), totalDims: '6', round: String(round), totalRounds: '8' }
  }, [activeSession?.phase, activeMessages])

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
      // Legacy auto-restore: find the message index for snapshot attachment
      const messages = session?.messages ?? []
      const lastActionMsgIndex = messages.length - 1 - [...messages].reverse().findIndex(
        (m) => m.role === 'assistant' && m.actions?.some((a) => a.includes('"add-node"'))
      )
      void applyCanvasActions(lastActionMsg.actions, lastActionMsgIndex)
    }
  }, [activeChatSessionId, chatSessions])
  const nodeContext = useMemo(
    () => buildNodeContext(selectedNodeId, nodes, edges),
    [edges, nodes, selectedNodeId]
  )

  // Clear code context when selected node changes
  const prevSelectedNodeRef = useRef<string | null>(null)
  useEffect(() => {
    if (selectedNodeId !== prevSelectedNodeRef.current) {
      prevSelectedNodeRef.current = selectedNodeId
      setCodeContext(null)
    }
  }, [selectedNodeId])

  // Rotate thinking messages while isSending is true
  useEffect(() => {
    if (!isSending) return
    setThinkingMsg(getRandomChatThinkingMessage())
    const interval = setInterval(() => {
      setThinkingMsg(getRandomChatThinkingMessage())
    }, 4000)
    return () => clearInterval(interval)
  }, [isSending])

  const selectedBlockData = selectedNode?.type === 'block'
    ? (selectedNode.data as BlockNodeData)
    : null
  const hasBuildSummary = Boolean(selectedBlockData?.buildSummary?.filesCreated?.length)

  async function handleLoadCodeContext() {
    if (!selectedBlockData?.buildSummary || !hasBuildSummary) return
    setIsLoadingCode(true)
    try {
      const res = await fetch('/api/build/read-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDir,
          files: selectedBlockData.buildSummary.filesCreated,
          maxTokens: 4000,
        }),
      })
      if (res.ok) {
        const data = (await res.json()) as { content: string }
        setCodeContext(data.content || null)
      }
    } catch {
      // best-effort
    } finally {
      setIsLoadingCode(false)
    }
  }

  function updateAssistantMessage(content: string, actions?: string[]) {
    updateActiveChatMessages((current) => {
      if (current.length === 0) {
        return [{ role: 'assistant', content, ...(actions ? { actions } : {}) }]
      }

      // Find the last assistant message (prefer empty placeholder, fall back to any assistant)
      let targetIdx = -1
      for (let i = current.length - 1; i >= 0; i--) {
        if (current[i].role === 'assistant') {
          if (!current[i].content) {
            // Found empty placeholder — replace it
            targetIdx = i
            break
          }
          if (targetIdx === -1) {
            targetIdx = i
          }
        }
      }

      if (targetIdx === -1) {
        return [...current, { role: 'assistant', content, ...(actions ? { actions } : {}) }]
      }

      const updated = [...current]
      updated[targetIdx] = { ...updated[targetIdx], content, ...(actions ? { actions } : {}) }
      return updated
    })
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedMessage = message.trim()

    if (!trimmedMessage || isSending) {
      return
    }

    const sessionId = activeChatSessionId ?? createChatSession()
    const nextHistory = [...activeMessages, { role: 'user' as const, content: trimmedMessage }]
    // messageIndex points to the assistant message that will be appended after nextHistory
    const messageIndex = nextHistory.length

    setMessage('')
    setError(null)
    setIsSending(true)
    updateActiveChatMessages(() => [...nextHistory, { role: 'assistant', content: '' }])

    // Auto-switch from brainstorm to design phase when user confirms design
    const currentPhase = activeSession?.phase ?? 'brainstorm'
    let effectivePhase = currentPhase
    if (currentPhase === 'brainstorm') {
      const confirmPatterns = /方案确认|确认方案|生成架构|开始设计|design confirm|start design|generate.*architect/i
      if (confirmPatterns.test(trimmedMessage)) {
        effectivePhase = 'design'
        setSessionPhase(sessionId, 'design')
      }
    }

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
          codeContext: codeContext ?? undefined,
          architecture_yaml: canvasToYaml(nodes, edges, projectName),
          backend,
          model,
          locale,
          phase: effectivePhase,
          buildSummaryContext: formatBuildContext(
            useAppStore.getState().buildState,
            useAppStore.getState().nodes,
            useAppStore.getState().buildOutputLog
          ) ?? undefined,
          customApiBase,
          customApiKey,
          customApiModel,
          ccSessionId: activeSession?.ccSessionId,
        }),
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: t('chat_start_failed') })) as { error?: string }
        throw new Error(errBody.error ?? t('chat_start_failed'))
      }

      let fullAssistantText = ''

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        // Non-streaming JSON response (CC spawn path)
        const data = await response.json() as { content?: string; ccSessionId?: string; error?: string }
        if (data.error) throw new Error(data.error)
        fullAssistantText = data.content ?? ''
        if (data.ccSessionId) {
          updateChatSession(sessionId, { ccSessionId: data.ccSessionId })
        }
      } else {
        // SSE streaming response (direct-api / custom-api path)
        if (!response.body) throw new Error(t('chat_start_failed'))
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let visibleAssistantText = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const { events, rest } = parseStreamEvents(buffer)
          buffer = rest

          for (const streamEvent of events) {
            if (streamEvent.type === 'session' && streamEvent.ccSessionId) {
              updateChatSession(sessionId, { ccSessionId: streamEvent.ccSessionId })
              continue
            }
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
      }

      const actionBlocks = extractActionBlocks(fullAssistantText)
      updateAssistantMessage(extractVisibleChatText(fullAssistantText), actionBlocks)
      // Auto-apply canvas actions when not in brainstorm phase
      const currentPhase = useAppStore.getState().chatSessions.find((s) => s.id === sessionId)?.phase ?? 'brainstorm'
      if (actionBlocks.length > 0 && currentPhase !== 'brainstorm') {
        await applyCanvasActions(actionBlocks, messageIndex)
        // Auto-transition from design to iterate after first successful apply
        if (currentPhase === 'design') {
          useAppStore.getState().setSessionPhase(sessionId, 'iterate')

          // Post-generation completeness check: missing edges or schemas
          const { nodes: postNodes, edges: postEdges } = useAppStore.getState()
          const blocks = postNodes.filter(n => n.type === 'block')
          const dataBlocks = blocks.filter(n => {
            const parentId = n.parentId
            if (!parentId) return false
            const parent = postNodes.find(p => p.id === parentId)
            const parentName = (parent?.data as { name?: string })?.name ?? ''
            return /data|数据|database|db/i.test(parentName)
          })
          const missingSchema = dataBlocks.filter(n => !(n.data as Record<string, unknown>).schema)
          const hasEdges = postEdges.length > 0
          const needsFollowUp: string[] = []

          if (!hasEdges && blocks.length > 1) {
            needsFollowUp.push(
              locale === 'zh'
                ? '架构图中缺少连接边（edge）。请为所有有通信关系的 block 之间添加 add-edge，标注协议类型（HTTPS/gRPC/SQL 等）。'
                : 'The architecture is missing edges between blocks. Please add add-edge actions for all communicating blocks with protocol labels (HTTPS/gRPC/SQL etc).'
            )
          }
          if (missingSchema.length > 0) {
            const names = missingSchema.map(n => (n.data as { name?: string }).name ?? n.id).join(', ')
            needsFollowUp.push(
              locale === 'zh'
                ? `以下数据层 block 缺少 schema 定义：${names}。请用 update-node 为它们补充完整的 schema（tables/columns/indexes/constraints）。`
                : `These data layer blocks are missing schema definitions: ${names}. Please use update-node to add complete schema (tables/columns/indexes/constraints).`
            )
          }

          if (needsFollowUp.length > 0) {
            // Auto-send follow-up request
            const followUpMsg = needsFollowUp.join('\n\n')
            setTimeout(() => { void handleOptionSelect(followUpMsg) }, 500)
          }
        }
      }
      // Auto-generate session title + project name from AI response
      const sid = sessionId
      const existingTitle = useAppStore.getState().chatSessions.find((s) => s.id === sid)?.title
      if (!existingTitle) {
        // Try to extract <!-- title: xxx --> from AI response (injected by prompt)
        const titleTagMatch = fullAssistantText.match(/<!--\s*title:\s*(.+?)\s*-->/)
        let autoTitle = titleTagMatch?.[1]?.trim() ?? ''

        // Fallback: first heading, bold text, or first sentence
        if (!autoTitle) {
          const visibleText = extractVisibleChatText(fullAssistantText)
          const headingMatch = visibleText.match(/^#+\s+(.+)/m)
          const boldMatch = visibleText.match(/\*\*(.+?)\*\*/)
          if (headingMatch) autoTitle = headingMatch[1].trim()
          else if (boldMatch) autoTitle = boldMatch[1].trim()
          else autoTitle = trimmedMessage.slice(0, 25)
        }

        autoTitle = autoTitle.replace(/[*#`]/g, '').trim().slice(0, 20)

        if (autoTitle) {
          useAppStore.getState().renameChatSession(sid, autoTitle)
          const store = useAppStore.getState()
          const untitled = t('untitled')
          if (store.projectName === untitled) {
            store.setProjectName(autoTitle)
          }
        }
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

  async function handleOptionSelect(text: string) {
    if (isSending || sendLockRef.current) return
    sendLockRef.current = true
    setMessage('')
    // Build a synthetic submit by temporarily overriding the message value
    const trimmedMessage = text.trim()
    if (!trimmedMessage) return

    const sessionId = activeChatSessionId ?? createChatSession()
    const nextHistory = [...activeMessages, { role: 'user' as const, content: trimmedMessage }]
    const messageIndex = nextHistory.length

    setError(null)
    setIsSending(true)
    updateActiveChatMessages(() => [...nextHistory, { role: 'assistant', content: '' }])

    // Auto-switch from brainstorm to design phase when user confirms design
    const optionPhase = activeSession?.phase ?? 'brainstorm'
    let effectiveOptionPhase = optionPhase
    if (optionPhase === 'brainstorm') {
      const confirmPatterns = /方案确认|确认方案|生成架构|开始设计|design confirm|start design|generate.*architect/i
      if (confirmPatterns.test(trimmedMessage)) {
        effectiveOptionPhase = 'design'
        setSessionPhase(sessionId, 'design')
      }
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmedMessage,
          history: nextHistory,
          nodeContext,
          codeContext: codeContext ?? undefined,
          architecture_yaml: canvasToYaml(nodes, edges, projectName),
          backend,
          model,
          locale,
          phase: effectiveOptionPhase,
          buildSummaryContext: formatBuildContext(
            useAppStore.getState().buildState,
            useAppStore.getState().nodes,
            useAppStore.getState().buildOutputLog
          ) ?? undefined,
          customApiBase,
          customApiKey,
          customApiModel,
          ccSessionId: activeSession?.ccSessionId,
        }),
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: t('chat_start_failed') })) as { error?: string }
        throw new Error(errBody.error ?? t('chat_start_failed'))
      }

      let fullAssistantText = ''

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('application/json')) {
        const data = await response.json() as { content?: string; ccSessionId?: string; error?: string }
        if (data.error) throw new Error(data.error)
        fullAssistantText = data.content ?? ''
        if (data.ccSessionId) {
          updateChatSession(sessionId, { ccSessionId: data.ccSessionId })
        }
      } else {
        if (!response.body) throw new Error(t('chat_start_failed'))
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let visibleAssistantText = ''

        while (true) {
          const { value, done } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const { events, rest } = parseStreamEvents(buffer)
          buffer = rest

          for (const streamEvent of events) {
            if (streamEvent.type === 'session' && streamEvent.ccSessionId) {
              updateChatSession(sessionId, { ccSessionId: streamEvent.ccSessionId })
              continue
            }
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
      }

      const actionBlocks = extractActionBlocks(fullAssistantText)
      updateAssistantMessage(extractVisibleChatText(fullAssistantText), actionBlocks)
      const currentPhase = useAppStore.getState().chatSessions.find((s) => s.id === sessionId)?.phase ?? 'brainstorm'
      if (actionBlocks.length > 0 && currentPhase !== 'brainstorm') {
        await applyCanvasActions(actionBlocks, messageIndex)
        if (currentPhase === 'design') {
          useAppStore.getState().setSessionPhase(sessionId, 'iterate')

          // Post-generation completeness check (same as main submit path)
          const { nodes: postNodes, edges: postEdges } = useAppStore.getState()
          const blocks = postNodes.filter(n => n.type === 'block')
          const dataBlocks = blocks.filter(n => {
            const parentId = n.parentId
            if (!parentId) return false
            const parent = postNodes.find(p => p.id === parentId)
            const parentName = (parent?.data as { name?: string })?.name ?? ''
            return /data|数据|database|db/i.test(parentName)
          })
          const missingSchema = dataBlocks.filter(n => !(n.data as Record<string, unknown>).schema)
          const hasEdges = postEdges.length > 0
          const needsFollowUp: string[] = []

          if (!hasEdges && blocks.length > 1) {
            needsFollowUp.push(
              locale === 'zh'
                ? '架构图中缺少连接边（edge）。请为所有有通信关系的 block 之间添加 add-edge，标注协议类型（HTTPS/gRPC/SQL 等）。'
                : 'The architecture is missing edges between blocks. Please add add-edge actions for all communicating blocks with protocol labels (HTTPS/gRPC/SQL etc).'
            )
          }
          if (missingSchema.length > 0) {
            const names = missingSchema.map(n => (n.data as { name?: string }).name ?? n.id).join(', ')
            needsFollowUp.push(
              locale === 'zh'
                ? `以下数据层 block 缺少 schema 定义：${names}。请用 update-node 为它们补充完整的 schema（tables/columns/indexes/constraints）。`
                : `These data layer blocks are missing schema definitions: ${names}. Please use update-node to add complete schema (tables/columns/indexes/constraints).`
            )
          }

          if (needsFollowUp.length > 0) {
            const followUpMsg = needsFollowUp.join('\n\n')
            setTimeout(() => { void handleOptionSelect(followUpMsg) }, 500)
          }
        }
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
      sendLockRef.current = false
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {chatOpen ? (
        <button
          type="button"
          aria-expanded={true}
          onClick={() => setChatOpen(false)}
          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">
              {getAgentDisplayName(backend, model)}
            </span>
            <span className="text-[10px] text-slate-400">·</span>
            <span className="text-[10px] text-slate-400">
              {selectedNode
                ? selectedNode.data.name || selectedNode.id
                : (locale === 'zh' ? '全局' : 'Global')}
            </span>
            {selectedNode ? (
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[9px] font-medium text-orange-600">
                {getNodeTypeLabel(selectedNode.type)}
              </span>
            ) : null}
          </div>
          <span className="text-[10px] text-slate-400">▼</span>
        </button>
      ) : (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setChatOpen(true)}
          className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-400 hover:text-slate-600"
          title={locale === 'zh' ? '展开对话' : 'Expand chat'}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="text-[9px] font-medium tracking-wider" style={{ writingMode: 'vertical-rl' }}>
            {getAgentDisplayName(backend, model)}
          </span>
        </button>
      )}

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

              // Option detection on ALL assistant messages (not just last).
              // Last message: cards are clickable. Historical: disabled (view only).
              const isSystemMsg = entry.role === 'assistant' &&
                (entry.content.startsWith('[构建]') || entry.content.startsWith('[系统]'))
              const isAssistantWithContent = entry.role === 'assistant' && !isSystemMsg && entry.content

              // Find last real assistant index for enabling/disabling cards
              const lastRealAssistantIdx = (() => {
                for (let i = activeMessages.length - 1; i >= 0; i--) {
                  const m = activeMessages[i]
                  if (m.role === 'assistant' && !m.content.startsWith('[构建]') && !m.content.startsWith('[系统]')) {
                    return i
                  }
                }
                return -1
              })()
              const isLastAssistant = messageIndex === lastRealAssistantIdx

              // Dual-layer option detection on all assistant messages:
              // 1. Primary: AI outputs json:user-choice blocks
              // 2. Fallback: regex-based numbered list detection (parseOptions)
              let userChoices = isAssistantWithContent
                ? extractUserChoices(entry.content)
                : []
              let strippedContent: string | null = null
              if (userChoices.length === 0 && isAssistantWithContent) {
                const visible = extractVisibleChatText(entry.content)
                const parsed = parseOptions(visible)
                if (parsed) {
                  userChoices = [{ question: '', options: parsed.options.map(o => o.text) }]
                  // Strip the numbered list from rendered content to avoid duplication with OptionCards
                  strippedContent = [parsed.textBefore, parsed.textAfter].filter(Boolean).join('\n\n')
                }
              }

              // System messages (build events) render as slim muted banners, not bubbles
              const isSystemMessage =
                entry.role === 'assistant' &&
                (entry.content.startsWith('[构建]') || entry.content.startsWith('[系统]'))

              if (isSystemMessage) {
                return (
                  <div
                    key={`${activeChatSessionId}-${messageIndex}`}
                    className="rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-500 italic"
                  >
                    {entry.content}
                  </div>
                )
              }

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
                    {entry.role === 'user' ? t('user') : getAgentDisplayName(backend, model)}
                  </div>
                  {entry.role === 'assistant' ? (
                    <div className="break-words">
                      {entry.content ? (
                        <>
                          <ChatMarkdown content={strippedContent ?? entry.content} />
                          {userChoices.map((choice, ci) => {
                            // Find the user's reply after this message to highlight selected option
                            const nextUserMsg = activeMessages.slice(messageIndex + 1).find(m => m.role === 'user')
                            const selectedText = !isLastAssistant && nextUserMsg ? nextUserMsg.content : undefined
                            return (
                              <OptionCards
                                key={ci}
                                options={choice.options.map((opt, oi) => ({ number: String(oi + 1), text: opt }))}
                                disabled={isSending || !isLastAssistant}
                                selectedText={selectedText}
                                onSelect={(text) => { void handleOptionSelect(text) }}
                              />
                            )
                          })}
                        </>
                      ) : (
                        actionBlocks.length > 0 ? null : (
                          <div className="flex items-center gap-2 text-slate-400">
                            <span className="vp-spinner" />
                            <span className="text-xs">{thinkingMsg || (locale === 'zh' ? 'AI 正在思考...' : 'AI is thinking...')}</span>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="break-words">
                      {entry.content ? <ChatMarkdown content={entry.content} /> : '...'}
                    </div>
                  )}
                  {actionBlocks.length > 0 && (entry.canvasBefore ?? entry.canvasAfter) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          {entry.canvasAfter ? (
                            <button
                              type="button"
                              onClick={() => {
                                restoreSnapshot(entry.canvasAfter!)
                              }}
                              className="vp-button-secondary rounded-full px-3 py-1 text-xs font-medium"
                            >
                              {locale === 'zh' ? '重新应用' : 'Re-apply'}
                            </button>
                          ) : null}
                          {entry.canvasBefore ? (
                            <button
                              type="button"
                              onClick={() => {
                                restoreSnapshot(entry.canvasBefore!)
                              }}
                              className="vp-button-secondary rounded-full px-3 py-1 text-xs font-medium"
                            >
                              {locale === 'zh' ? '撤销此修改' : 'Undo This Change'}
                            </button>
                          ) : null}
                        </div>
                        {actionErrors[String(messageIndex)] ? (
                          <div className="max-h-16 overflow-y-auto text-xs text-rose-600">{actionErrors[String(messageIndex)]}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-slate-200 pt-4">
            {error ? <div className="mb-3 max-h-20 overflow-y-auto text-sm text-rose-600">{error}</div> : null}
            {activeSession?.phase === 'brainstorm' ? (
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {brainstormProgress
                    ? locale === 'zh'
                      ? `需求讨论中 · ${brainstormProgress.dims}/${brainstormProgress.totalDims} 维度 · 第 ${brainstormProgress.round}/${brainstormProgress.totalRounds} 轮`
                      : `Brainstorming · ${brainstormProgress.dims}/${brainstormProgress.totalDims} dims · round ${brainstormProgress.round}/${brainstormProgress.totalRounds}`
                    : locale === 'zh' ? '需求讨论中' : 'Brainstorming'
                  }
                </span>
                <button
                  type="button"
                  disabled={isSending}
                  onClick={() => {
                    if (activeChatSessionId) {
                      setSessionPhase(activeChatSessionId, 'design')
                      // Auto-send a message to trigger architecture generation
                      const prompt = locale === 'zh'
                        ? '方案确认，请根据讨论内容生成完整的系统架构图'
                        : 'Design confirmed. Please generate the complete system architecture based on our discussion.'
                      void handleOptionSelect(prompt)
                    }
                  }}
                  className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 transition-colors disabled:opacity-50"
                >
                  {locale === 'zh' ? '确认方案，开始生成架构 →' : 'Start Designing →'}
                </button>
              </div>
            ) : null}
            {hasBuildSummary ? (
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={isLoadingCode || isSending}
                  onClick={() => { void handleLoadCodeContext() }}
                  className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    codeContext
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {isLoadingCode
                    ? (locale === 'zh' ? '读取中...' : 'Loading...')
                    : codeContext
                      ? (locale === 'zh' ? '✓ 代码已加载' : '✓ Code loaded')
                      : (locale === 'zh' ? '加载代码上下文' : 'Load code context')}
                </button>
                {codeContext ? (
                  <button
                    type="button"
                    onClick={() => setCodeContext(null)}
                    className="text-[10px] text-slate-400 hover:text-slate-600"
                  >
                    {locale === 'zh' ? '清除' : 'Clear'}
                  </button>
                ) : null}
              </div>
            ) : null}
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
