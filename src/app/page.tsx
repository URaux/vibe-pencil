'use client'

import { useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { BuildButton } from '@/components/BuildButton'
import { Canvas } from '@/components/Canvas'
import { ChatPanel } from '@/components/ChatPanel'
import { ImportDialog } from '@/components/ImportDialog'
import { NodePalette } from '@/components/NodePalette'
import { StatusBar } from '@/components/StatusBar'
import { useAgentStatus } from '@/hooks/useAgentStatus'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useAppStore } from '@/lib/store'

export default function Home() {
  const workDir = useAppStore((state) => state.config.workDir)
  const chatOpen = useAppStore((state) => state.chatOpen)
  const [importOpen, setImportOpen] = useState(false)

  useAgentStatus()
  useAutoSave(workDir)

  return (
    <ReactFlowProvider>
      <main className="flex h-screen w-screen flex-col overflow-hidden bg-transparent text-white">
        <header className="vp-panel flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
          <div>
            <h1 className="text-sm font-semibold uppercase tracking-[0.3em] text-gray-100">Vibe Pencil</h1>
            <p className="text-xs text-gray-500">面向架构节点的拓扑感知构建</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded-full border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-100 transition hover:border-gray-500 hover:bg-gray-800"
            >
              导入项目
            </button>
            <BuildButton />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
          <NodePalette />
          <section className="min-h-[24rem] min-w-0 flex-1">
            <Canvas onOpenImportDialog={() => setImportOpen(true)} />
          </section>
          <aside
            className={`vp-panel flex shrink-0 flex-col border-t border-white/10 p-4 transition-[width] duration-300 xl:h-full xl:border-t-0 xl:border-l ${
              chatOpen ? 'w-full xl:w-[24rem] xl:min-w-[22rem]' : 'w-full xl:w-20 xl:min-w-20'
            }`}
          >
            <ChatPanel />
          </aside>
        </div>
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
        <StatusBar />
      </main>
    </ReactFlowProvider>
  )
}
