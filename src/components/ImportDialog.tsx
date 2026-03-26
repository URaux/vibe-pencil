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
        body: JSON.stringify({ dir: trimmedDir }),
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
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl shadow-black/50">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">导入项目</h2>
            <p className="mt-1 text-sm text-gray-400">
              分析现有代码库，并为画布生成节点与连线。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            className="rounded-full border border-gray-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-gray-300 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            关闭
          </button>
        </div>

        <form onSubmit={handleImport} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
              项目目录路径
            </span>
            <input
              type="text"
              value={dir}
              onChange={(event) => setDir(event.target.value)}
              placeholder="E:\\projects\\my-app"
              disabled={isImporting}
              className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          {progress ? (
            <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
              {progress}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isImporting || !dir.trim()}
              className="rounded-xl border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isImporting ? '导入中...' : '导入'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
