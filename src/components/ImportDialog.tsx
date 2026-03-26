'use client'

import { useState } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { useAppStore } from '@/lib/store'
import type { ArchitectNodeData } from '@/lib/types'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
}

interface ImportResponse {
  nodes: Node<ArchitectNodeData>[]
  edges: Edge[]
}

function getProjectNameFromPath(dir: string) {
  return dir.split(/[\\/]/).filter(Boolean).at(-1) ?? dir
}

export function ImportDialog({ open, onClose }: ImportDialogProps) {
  const backend = useAppStore((state) => state.config.agent)
  const setCanvas = useAppStore((state) => state.setCanvas)
  const setProjectName = useAppStore((state) => state.setProjectName)
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
    setProgress('正在分析项目结构并生成架构节点...')

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
        throw new Error(payload.error ?? '导入失败。')
      }

      setProgress('正在应用导入后的画布...')
      setCanvas(payload.nodes ?? [], payload.edges ?? [])
      setProjectName(getProjectNameFromPath(trimmedDir))
      setProgress(null)
      setDir('')
      onClose()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入失败。')
    } finally {
      setIsImporting(false)
      setProgress((current) => (current === '正在应用导入后的画布...' ? null : current))
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
            <h2 className="text-lg font-semibold text-slate-900">导入项目</h2>
            <p className="mt-1 text-sm text-slate-500">分析现有代码库，并为画布生成节点与连线。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            className="vp-button-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-50"
          >
            关闭
          </button>
        </div>

        <form onSubmit={handleImport} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              项目目录路径
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
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="vp-button-secondary rounded-xl px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isImporting || !dir.trim()}
              className="vp-button-primary rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isImporting ? '导入中...' : '导入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
