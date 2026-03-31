'use client'

import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import Link from 'next/link'
import { BuildButton } from '@/components/BuildButton'
import { BuildDrawer } from '@/components/BuildDrawer'
import { Canvas } from '@/components/Canvas'
import { ChatPanel } from '@/components/ChatPanel'
import { ChatSidebar } from '@/components/ChatSidebar'
import { ExportMenu } from '@/components/ExportMenu'
import { ImportDialog } from '@/components/ImportDialog'
import { NodePalette } from '@/components/NodePalette'
import { SettingsDialog } from '@/components/SettingsDialog'
import { StatusBar } from '@/components/StatusBar'
import { useAgentStatus } from '@/hooks/useAgentStatus'
import { useAutoSave } from '@/hooks/useAutoSave'
import { t } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'

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
            <ExportMenu />
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
        <BuildDrawer />
      </main>
    </ReactFlowProvider>
  )
}
