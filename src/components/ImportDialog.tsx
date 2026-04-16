'use client'

import { useEffect, useRef, useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { layoutArchitectureCanvas } from '@/lib/graph-layout'
import { canvasToYaml } from '@/lib/schema-engine'
import { getRandomImportMessage } from '@/lib/loading-messages'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import { normalizeCanvas } from '@/lib/import-normalizer'
import type { CanvasNodeData } from '@/lib/types'
import type { ProjectScan } from '@/lib/project-scanner'
import { EnhanceStatusBadge, type EnhanceStatus } from '@/components/EnhanceStatusBadge'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
}

interface ScanResponse {
  nodes: Node<CanvasNodeData>[]
  edges: Edge[]
  scan: ProjectScan
}

function getProjectNameFromPath(dir: string) {
  return dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir
}

export function ImportDialog({ open, onClose }: ImportDialogProps) {
  const backend = useAppStore((state) => state.config.agent)
  const model = useAppStore((state) => state.config.model)
  const setCanvas = useAppStore((state) => state.setCanvas)
  const setProjectName = useAppStore((state) => state.setProjectName)
  const setChatOpen = useAppStore((state) => state.setChatOpen)
  const createChatSession = useAppStore((state) => state.createChatSession)
  const updateActiveChatMessages = useAppStore((state) => state.updateActiveChatMessages)
  const locale = useAppStore((state) => state.locale)
  const [dir, setDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [enhanceStatus, setEnhanceStatus] = useState<EnhanceStatus>('idle')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track the enhance abort controller so we can cancel it when the component unmounts
  const enhanceAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (isImporting) {
      setLoadingMsg(getRandomImportMessage())
      intervalRef.current = setInterval(() => {
        setLoadingMsg(getRandomImportMessage())
      }, 4000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isImporting])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      enhanceAbortRef.current?.abort()
    }
  }, [])

  async function startEnhancement(
    scanDir: string,
    scanPayload: ScanResponse,
    projectName: string
  ) {
    const abortController = new AbortController()
    enhanceAbortRef.current = abortController

    // Timeout: if enhancement takes >90s, fall back to intro chat with skeleton
    const timeoutId = setTimeout(() => {
      abortController.abort()
      setEnhanceStatus('error')
      triggerIntroChat(scanPayload.nodes, scanPayload.edges, scanDir, projectName)
    }, 90000)

    try {
      const res = await fetch('/api/project/import/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dir: scanDir,
          scan: scanPayload.scan,
          skeletonNodes: scanPayload.nodes,
          skeletonEdges: scanPayload.edges,
          backend,
          locale,
        }),
        signal: abortController.signal,
      })

      if (!res.ok || !res.body) {
        clearTimeout(timeoutId)
        setEnhanceStatus('error')
        triggerIntroChat(scanPayload.nodes, scanPayload.edges, scanDir, projectName)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let enhanced = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue
          try {
            const event = JSON.parse(line.slice(5).trim()) as {
              type: string
              canvas?: unknown
              error?: string
            }

            if (event.type === 'enhanced' && event.canvas) {
              clearTimeout(timeoutId)
              try {
                // canvas is already normalized by the server — but we re-normalize
                // client-side in case the server sends pre-normalized nodes/edges
                const normalized =
                  'nodes' in (event.canvas as object) && 'edges' in (event.canvas as object)
                    ? (event.canvas as { nodes: Node<CanvasNodeData>[]; edges: Edge[] })
                    : normalizeCanvas(event.canvas)
                const arranged = await layoutArchitectureCanvas(
                  normalized.nodes,
                  normalized.edges
                )
                setCanvas(arranged.nodes, arranged.edges)
                setEnhanceStatus('done')
                enhanced = true
                triggerIntroChat(arranged.nodes, arranged.edges, scanDir, projectName)
              } catch {
                // Enhancement parse failed — keep skeleton, trigger intro with skeleton
                setEnhanceStatus('error')
                triggerIntroChat(scanPayload.nodes, scanPayload.edges, scanDir, projectName)
              }
            } else if (event.type === 'error') {
              clearTimeout(timeoutId)
              setEnhanceStatus('error')
              triggerIntroChat(scanPayload.nodes, scanPayload.edges, scanDir, projectName)
              return
            }
          } catch {
            /* skip malformed events */
          }
        }
      }

      clearTimeout(timeoutId)
      if (!enhanced) {
        // Stream ended without an enhanced event
        setEnhanceStatus('error')
        triggerIntroChat(scanPayload.nodes, scanPayload.edges, scanDir, projectName)
      }
    } catch (err) {
      clearTimeout(timeoutId)
      // AbortError is expected on timeout — error state already set
      if (err instanceof Error && err.name !== 'AbortError') {
        setEnhanceStatus('error')
        triggerIntroChat(scanPayload.nodes, scanPayload.edges, scanDir, projectName)
      }
    }
  }

  function triggerIntroChat(
    nodes: Node<CanvasNodeData>[],
    edges: Edge[],
    scanDir: string,
    projectName: string
  ) {
    // Fire-and-forget: create session and stream intro message
    const sessionId = createChatSession()
    const yaml = canvasToYaml(nodes, edges, projectName)
    const isZh = locale === 'zh'
    const introPrompt = isZh
      ? `我刚导入了 "${scanDir}" 的代码库。生成的架构如下：\n\n${yaml}\n\n请用中文做一个项目总览：\n1. 用一句话概括这个项目是做什么的\n2. 列出核心模块（3-5个）及它们各自的职责\n3. 描述模块之间的关键数据流\n4. 指出架构中的亮点和潜在问题\n5. 如果架构图有缺失或错误，用 canvas action 修复\n\n语气像一个资深架构师在做 code review，简洁有力。`
      : `I just imported a codebase from "${scanDir}". Here is the generated architecture:\n\n${yaml}\n\nPlease provide a project overview:\n1. One-sentence summary of what this project does\n2. Core modules (3-5) and their responsibilities\n3. Key data flows between modules\n4. Architecture highlights and potential issues\n5. If the generated architecture has gaps or errors, suggest canvas actions to fix them\n\nBe concise and opinionated, like a senior architect doing a code review.`

    updateActiveChatMessages(() => [
      {
        role: 'user' as const,
        content: isZh ? `导入项目: ${scanDir}` : `Import project: ${scanDir}`,
      },
      { role: 'assistant' as const, content: '' },
    ])
    setChatOpen(true)

    // Stream the intro response (best-effort)
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: introPrompt,
        history: [],
        nodeContext: '',
        architecture_yaml: yaml,
        backend,
        model,
        locale,
        sessionId,
      }),
    })
      .then(async (chatRes) => {
        if (!chatRes.ok || !chatRes.body) return
        const reader = chatRes.body.getReader()
        const decoder = new TextDecoder()
        let fullText = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data:')) {
              try {
                const evt = JSON.parse(line.slice(5).trim()) as { text?: string }
                if (evt.text) fullText += evt.text
              } catch {
                /* skip */
              }
            }
          }
          updateActiveChatMessages((msgs) => {
            const updated = [...msgs]
            if (updated.length > 0) {
              updated[updated.length - 1] = { ...updated[updated.length - 1], content: fullText }
            }
            return updated
          })
        }
      })
      .catch(() => {
        /* intro chat is best-effort */
      })
  }

  async function handleImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedDir = dir.trim()

    if (!trimmedDir || isImporting) {
      return
    }

    setIsImporting(true)
    setError(null)
    setProgress(t('scanning_project'))

    try {
      // === PHASE 1: Fast scan (< 3s) ===
      const scanRes = await fetch('/api/project/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: trimmedDir }),
      })

      const scanPayload = (await scanRes.json()) as Partial<ScanResponse> & { error?: string }

      if (!scanRes.ok) {
        throw new Error(scanPayload.error ?? t('import_failed'))
      }

      // Immediately render skeleton on canvas
      setProgress(t('applying_import'))
      const arranged = await layoutArchitectureCanvas(
        scanPayload.nodes ?? [],
        scanPayload.edges ?? []
      )
      setCanvas(arranged.nodes, arranged.edges)
      const importedProjectName = getProjectNameFromPath(trimmedDir)
      setProjectName(importedProjectName)
      setProgress(null)
      setDir('')
      onClose() // Close dialog — user sees skeleton immediately

      // === PHASE 2: Background LLM enhancement ===
      if (scanPayload.scan) {
        setEnhanceStatus('enhancing')
        const fullScanPayload: ScanResponse = {
          nodes: arranged.nodes,
          edges: arranged.edges,
          scan: scanPayload.scan,
        }
        // startEnhancement runs in background; it will call triggerIntroChat when done
        void startEnhancement(trimmedDir, fullScanPayload, importedProjectName)
      } else {
        // No scan data — fall back to immediate intro chat with skeleton
        triggerIntroChat(arranged.nodes, arranged.edges, trimmedDir, importedProjectName)
      }
    } catch (importError) {
      const msg = importError instanceof Error ? importError.message : t('import_failed')
      setError(msg.includes('exit code') || msg.includes('timed out') ? msg : t('import_failed'))
      setProgress(null)
    } finally {
      setIsImporting(false)
    }
  }

  if (!open) {
    return (
      <>
        {/* Badge is rendered outside the dialog so it persists after dialog closes */}
        <EnhanceStatusBadge
          status={enhanceStatus}
          onDismiss={() => setEnhanceStatus('idle')}
        />
      </>
    )
  }

  return (
    <>
      <EnhanceStatusBadge
        status={enhanceStatus}
        onDismiss={() => setEnhanceStatus('idle')}
      />
      <div className="vp-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-6">
        <div className="vp-dialog-card w-full max-w-lg rounded-[2rem] p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('import_project')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('import_desc')}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="vp-button-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('close')}
            </button>
          </div>

          <form onSubmit={handleImport} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {t('dir_path')}
              </span>
              <input
                type="text"
                value={dir}
                onChange={(event) => setDir(event.target.value)}
                placeholder="E:\\projects\\my-app"
                disabled={isImporting}
                className="vp-input rounded-2xl px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            {progress ? (
              <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
                <div className="flex items-center gap-2">
                  <span className="vp-spinner" />
                  <span>{progress}</span>
                </div>
                {isImporting && loadingMsg ? (
                  <div className="mt-2 text-xs italic text-orange-500">{loadingMsg}</div>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="mt-2 text-xs font-medium text-rose-600 underline hover:text-rose-800"
                >
                  {t('dismiss')}
                </button>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isImporting}
                className="vp-button-secondary rounded-xl px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={isImporting || !dir.trim()}
                className="vp-button-primary rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isImporting ? t('importing') : t('import_project')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
