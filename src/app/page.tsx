'use client'

import { ReactFlowProvider } from '@xyflow/react'
import { Canvas } from '@/components/Canvas'
import { NodePalette } from '@/components/NodePalette'

export default function Home() {
  return (
    <ReactFlowProvider>
      <main className="flex h-screen w-screen overflow-hidden bg-gray-950 text-white">
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
      </main>
    </ReactFlowProvider>
  )
}
