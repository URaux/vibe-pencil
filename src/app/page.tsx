'use client'

import { useEffect, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import Link from 'next/link'
import { BuildButton } from '@/components/BuildButton'
import { Canvas } from '@/components/Canvas'
import { ChatPanel } from '@/components/ChatPanel'
import { ChatSidebar } from '@/components/ChatSidebar'
import { ImportDialog } from '@/components/ImportDialog'
import { NodePalette } from '@/components/NodePalette'
import { SettingsDialog } from '@/components/SettingsDialog'
import { StatusBar } from '@/components/StatusBar'
import { useAgentStatus } from '@/hooks/useAgentStatus'
import { useAutoSave } from '@/hooks/useAutoSave'
import { t } from '@/lib/i18n'
import { canvasToYaml, exportProjectJson } from '@/lib/schema-engine'
import { useAppStore } from '@/lib/store'

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function ExportDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

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
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
          <button
            type="button"
            onClick={() => {
              const state = useAppStore.getState()
              const yaml = canvasToYaml(state.nodes, state.edges, state.projectName)
              downloadFile(`${state.projectName}.yaml`, yaml, 'text/yaml')
              setOpen(false)
            }}
            className="w-full rounded-xl px-3 py-2 text-left hover:bg-slate-50"
          >
            <div className="text-sm font-medium text-slate-900">{t('export_yaml')}</div>
            <div className="text-xs text-slate-400">{t('export_yaml_desc')}</div>
          </button>
          <button
            type="button"
            onClick={() => {
              const state = useAppStore.getState()
              const json = exportProjectJson(state.nodes, state.edges, state.projectName, state.config)
              downloadFile(`${state.projectName}.json`, json, 'application/json')
              setOpen(false)
            }}
            className="w-full rounded-xl px-3 py-2 text-left hover:bg-slate-50"
          >
            <div className="text-sm font-medium text-slate-900">{t('export_json')}</div>
            <div className="text-xs text-slate-400">{t('export_json_desc')}</div>
          </button>
        </div>
      )}
    </div>
  )
}

export default function Home() {
  const workDir = useAppStore((state) => state.config.workDir)
  const chatOpen = useAppStore((state) => state.chatOpen)
  const chatSidebarOpen = useAppStore((state) => state.chatSidebarOpen)
  const locale = useAppStore((state) => state.locale)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useAgentStatus()
  useAutoSave(workDir)

  // Auto-load project from workspace on mount
  useEffect(() => {
    if (!workDir) return
    let active = true
    fetch('/api/project/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: workDir }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!active || !data.project) return
        const { canvas, name, config: projConfig } = data.project
        if (canvas?.nodes?.length > 0) {
          useAppStore.getState().setCanvas(canvas.nodes, canvas.edges ?? [])
          if (name) useAppStore.getState().setProjectName(name)
          if (projConfig) useAppStore.getState().setConfig(projConfig)
        }
      })
      .catch(() => {})
    return () => { active = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])

  return (
    <ReactFlowProvider>
      <main className="flex h-screen w-screen flex-col overflow-hidden bg-transparent text-slate-800">
        <header className="vp-panel flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-5 py-3">
          <div>
            <h1 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-900">Vibe Pencil</h1>
            <p className="text-xs text-slate-500">{t('app_subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="vp-button-secondary rounded-full px-4 py-2 text-sm font-medium"
            >
              {t('import_project')}
            </button>
            <Link
              href="/dashboard"
              className="vp-button-secondary rounded-full px-4 py-2 text-sm font-medium"
            >
              {t('dashboard')}
            </Link>
            <ExportDropdown />
            <BuildButton />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
          <aside className={`hidden shrink-0 border-r border-slate-200/80 xl:block transition-[width] duration-200 ${
            chatSidebarOpen ? 'w-56' : 'w-10'
          }`}>
            {chatSidebarOpen ? <ChatSidebar /> : (
              <button
                type="button"
                onClick={() => useAppStore.getState().setChatSidebarOpen(true)}
                className="flex h-full w-full items-center justify-center text-slate-400 hover:text-slate-600"
                title="Expand sidebar"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </aside>
          <NodePalette />
          <section className="min-h-[24rem] min-w-0 flex-1">
            <Canvas onOpenImportDialog={() => setImportOpen(true)} />
          </section>
          <aside
            className={`vp-panel flex shrink-0 flex-col border-t border-slate-200/80 p-4 transition-[width] duration-300 xl:h-full xl:border-t-0 xl:border-l ${
              chatOpen ? 'w-full xl:w-[24rem] xl:min-w-[22rem]' : 'w-full xl:w-20 xl:min-w-20'
            }`}
          >
            <ChatPanel />
          </aside>
        </div>
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <StatusBar onOpenSettings={() => setSettingsOpen(true)} />
      </main>
    </ReactFlowProvider>
  )
}
