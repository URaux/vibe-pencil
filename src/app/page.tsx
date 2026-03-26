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
  const [importOpen, setImportOpen] = useState(false)

  useAgentStatus()
  useAutoSave(workDir)

  return (
    <ReactFlowProvider>
      <main className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950 text-white">
        <header className="flex items-center justify-between border-b border-gray-800 bg-gray-950/95 px-5 py-3">
          <div>
            <h1 className="text-sm font-semibold uppercase tracking-[0.3em] text-gray-100">Vibe Pencil</h1>
            <p className="text-xs text-gray-500">Topology-aware builds for architecture nodes</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded-full border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-medium text-gray-100 transition hover:border-gray-500 hover:bg-gray-800"
            >
              Import Project
            </button>
            <BuildButton />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <NodePalette />
          <section className="min-w-0 flex-1">
            <Canvas onOpenImportDialog={() => setImportOpen(true)} />
          </section>
          <aside className="flex h-full w-80 flex-col border-l border-gray-800 bg-gray-900 p-4">
            <ChatPanel />
          </aside>
        </div>
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
        <StatusBar />
      </main>
    </ReactFlowProvider>
  )
}
