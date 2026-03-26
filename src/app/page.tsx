'use client'

import { ReactFlowProvider } from '@xyflow/react'
import { BuildButton } from '@/components/BuildButton'
import { Canvas } from '@/components/Canvas'
import { NodePalette } from '@/components/NodePalette'
import { StatusBar } from '@/components/StatusBar'
import { useAgentStatus } from '@/hooks/useAgentStatus'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useAppStore } from '@/lib/store'

export default function Home() {
  const workDir = useAppStore((state) => state.config.workDir)

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
          <BuildButton />
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <NodePalette />
          <section className="min-w-0 flex-1">
            <Canvas />
          </section>
          <aside className="flex h-full w-80 flex-col border-l border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-300">AI Chat</h2>
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-700 bg-gray-800/60 p-4 text-sm text-gray-500">
              ChatPanel placeholder
            </div>
          </aside>
        </div>
        <StatusBar />
      </main>
    </ReactFlowProvider>
  )
}
