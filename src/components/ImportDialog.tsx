'use client'

import { useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { layoutArchitectureCanvas } from '@/lib/graph-layout'
import { canvasToYaml } from '@/lib/schema-engine'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import type { CanvasNodeData } from '@/lib/types'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
}

interface ImportResponse {
  nodes: Node<CanvasNodeData>[]
  edges: Edge[]
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
  useAppStore((state) => state.locale)
  const [dir, setDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  async function handleImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedDir = dir.trim()

    if (!trimmedDir || isImporting) {
      return
    }

    setIsImporting(true)
    setError(null)
    setProgress(t('analyzing_project'))

    try {
      const response = await fetch('/api/project/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dir: trimmedDir, backend }),
      })

      const payload = (await response.json()) as Partial<ImportResponse> & { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? t('import_failed'))
      }

      setProgress(t('applying_import'))
      const arranged = await layoutArchitectureCanvas(payload.nodes ?? [], payload.edges ?? [])
      setCanvas(arranged.nodes, arranged.edges)
      const importedProjectName = getProjectNameFromPath(trimmedDir)
      setProjectName(importedProjectName)
      setProgress(null)
      setDir('')
      onClose()

      // Auto-create a chat session and spawn an intro overview
      const sessionId = createChatSession()
      const yaml = canvasToYaml(arranged.nodes, arranged.edges, importedProjectName)
      const introPrompt = `I just imported a codebase from "${trimmedDir}". Here is the generated architecture:\n\n${yaml}\n\nPlease give me a brief overview of this architecture — what are the main components, how they connect, and any observations about the design. Point out anything that looks incomplete or could be improved. Keep it concise. If you see issues with the generated architecture (missing components, wrong relationships), suggest canvas actions to fix them.`

      updateActiveChatMessages(() => [
        { role: 'user' as const, content: `导入项目: ${trimmedDir}` },
        { role: 'assistant' as const, content: '' },
      ])
      setChatOpen(true)

      // Stream the intro response
      try {
        const chatRes = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: introPrompt,
            history: [],
            nodeContext: '',
            architecture_yaml: yaml,
            backend,
            model,
          }),
        })
        if (chatRes.ok && chatRes.body) {
          const reader = chatRes.body.getReader()
          const decoder = new TextDecoder()
          let fullText = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            // Extract text from SSE data lines
            for (const line of chunk.split('\n')) {
              if (line.startsWith('data:')) {
                try {
                  const evt = JSON.parse(line.slice(5).trim()) as { text?: string }
                  if (evt.text) fullText += evt.text
                } catch { /* skip */ }
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
        }
      } catch { /* intro chat is best-effort */ }
    } catch (importError) {
      const msg = importError instanceof Error ? importError.message : t('import_failed')
      // Surface exit code info if present, otherwise use generic message
      setError(msg.includes('exit code') || msg.includes('timed out') ? msg : t('import_failed'))
      setProgress(null)
    } finally {
      setIsImporting(false)
    }
  }

  if (!open) {
    return null
  }

  return (
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
              {progress}
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
  )
}
