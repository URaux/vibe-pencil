'use client'

import { useEffect, useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { getNodesBounds, getViewportForBounds, useReactFlow } from '@xyflow/react'
import { canvasToMermaid, canvasToYaml, exportProjectJson } from '@/lib/schema-engine'
import { useAppStore } from '@/lib/store'
import { t } from '@/lib/i18n'

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function ExportItem({
  label,
  desc,
  onClick,
}: {
  label: string
  desc: string
  onClick: () => void | Promise<void>
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl px-3 py-2 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors"
    >
      <div className="text-sm font-medium text-slate-900">{label}</div>
      <div className="text-xs text-slate-400">{desc}</div>
    </button>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
      {children}
    </div>
  )
}

export function ExportMenu() {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const { getNodes } = useReactFlow()
  // Subscribe to locale changes so i18n keys re-render
  useAppStore((state) => state.locale)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(timer)
  }, [toast])

  function close() {
    setOpen(false)
  }

  // ---------- Export handlers ----------

  function handleExportYaml() {
    const state = useAppStore.getState()
    const yaml = canvasToYaml(state.nodes, state.edges, state.projectName)
    downloadFile(`${state.projectName}.yaml`, yaml, 'text/yaml')
    close()
  }

  function handleExportJson() {
    const state = useAppStore.getState()
    const json = exportProjectJson(state.nodes, state.edges, state.projectName, state.config)
    downloadFile(`${state.projectName}.json`, json, 'application/json')
    close()
  }

  async function handleExportPng() {
    close()
    const state = useAppStore.getState()
    const nodes = getNodes()
    if (nodes.length === 0) return

    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!viewport) return

    try {
      // Use React Flow's coordinate system to compute full bounds
      const padding = 40
      const bounds = getNodesBounds(nodes)
      const imageWidth = bounds.width + padding * 2
      const imageHeight = bounds.height + padding * 2

      // Calculate viewport transform to show all nodes — min zoom 1.0 to avoid shrinking
      const vp = getViewportForBounds(bounds, imageWidth, imageHeight, 1, 2, padding)

      const dataUrl = await toPng(viewport, {
        backgroundColor: '#ffffff',
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      })

      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${state.projectName}.png`
      a.click()
    } catch {
      // Silent fail — canvas may be empty
    }
  }

  function handleExportMermaid() {
    const state = useAppStore.getState()
    const mmd = canvasToMermaid(state.nodes, state.edges, state.projectName)
    downloadFile(`${state.projectName}.mmd`, mmd, 'text/plain')
    close()
  }

  function handleExportChatMd() {
    const state = useAppStore.getState()
    const session = state.chatSessions.find((s) => s.id === state.activeChatSessionId)
    if (!session) { close(); return }
    const title = session.title || t('untitled_chat')
    const lines: string[] = [`# Chat: ${title}`, '']
    for (const msg of session.messages) {
      lines.push(`## ${msg.role === 'user' ? t('user') : t('assistant')}`)
      lines.push('')
      lines.push(msg.content)
      lines.push('')
    }
    downloadFile(`${title}.md`, lines.join('\n'), 'text/markdown')
    close()
  }

  function handleExportAllSessions() {
    const state = useAppStore.getState()
    const json = JSON.stringify(state.chatSessions, null, 2)
    downloadFile(`${state.projectName}-sessions.json`, json, 'application/json')
    close()
  }

  function handleExportArchive() {
    const state = useAppStore.getState()
    const archive = JSON.stringify(
      {
        projectName: state.projectName,
        version: '1.0',
        canvas: { nodes: state.nodes, edges: state.edges },
        chatSessions: state.chatSessions,
        config: state.config,
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    )
    downloadFile(`${state.projectName}-archive.json`, archive, 'application/json')
    close()
  }

  function handleCopyYaml() {
    const state = useAppStore.getState()
    const yaml = canvasToYaml(state.nodes, state.edges, state.projectName)
    navigator.clipboard.writeText(yaml).then(() => {
      setToast(t('copy_success'))
    }).catch(() => {})
    close()
  }

  async function handleExportCode() {
    close()
    const state = useAppStore.getState()
    const projectSlug = state.projectName
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
    const projectWorkDir = `${state.config.workDir}/${projectSlug}`

    try {
      const res = await fetch('/api/project/export-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: projectWorkDir, projectName: state.projectName }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        alert(err.error ?? 'Export failed')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${projectSlug}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Silent fail
    }
  }

  function handleCopyAiPrompt() {
    const state = useAppStore.getState()
    const yaml = canvasToYaml(state.nodes, state.edges, state.projectName)
    const prompt = `Below is the architecture of my project "${state.projectName}" in YAML format.\nPlease analyze it and suggest improvements.\n\n${yaml}`
    navigator.clipboard.writeText(prompt).then(() => {
      setToast(t('copy_success'))
    }).catch(() => {})
    close()
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="vp-button-secondary rounded-full px-4 py-2 text-sm font-medium"
      >
        {t('export')}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[9999] mt-2 w-72 max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">

          {/* Group: Canvas */}
          <GroupLabel>{t('export_group_canvas')}</GroupLabel>
          <ExportItem label={t('export_yaml')} desc={t('export_yaml_desc')} onClick={handleExportYaml} />
          <ExportItem label={t('export_json')} desc={t('export_json_desc')} onClick={handleExportJson} />
          <ExportItem label={t('export_png')} desc={t('export_png_desc')} onClick={handleExportPng} />
          <ExportItem label={t('export_mermaid')} desc={t('export_mermaid_desc')} onClick={handleExportMermaid} />

          <div className="my-1.5 border-t border-slate-100" />

          {/* Group: Chat */}
          <GroupLabel>{t('export_group_chat')}</GroupLabel>
          <ExportItem label={t('export_chat_md')} desc={t('export_chat_md_desc')} onClick={handleExportChatMd} />
          <ExportItem label={t('export_all_sessions')} desc={t('export_all_sessions_desc')} onClick={handleExportAllSessions} />

          <div className="my-1.5 border-t border-slate-100" />

          {/* Group: Project */}
          <GroupLabel>{t('export_group_project')}</GroupLabel>
          <ExportItem label={t('export_archive')} desc={t('export_archive_desc')} onClick={handleExportArchive} />
          <ExportItem label={t('export_code')} desc={t('export_code_desc')} onClick={() => void handleExportCode()} />
          <ExportItem label={t('copy_yaml')} desc={t('copy_yaml_desc')} onClick={handleCopyYaml} />
          <ExportItem label={t('copy_ai_prompt')} desc={t('copy_ai_prompt_desc')} onClick={handleCopyAiPrompt} />
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="absolute right-0 top-full z-50 mt-2 rounded-xl bg-slate-800 px-3 py-2 text-xs text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
