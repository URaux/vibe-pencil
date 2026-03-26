'use client'

import { useTransition } from 'react'
import { buildAll as buildAllPrompt } from '@/lib/prompt-templates'
import { canvasToYaml, yamlToCanvas } from '@/lib/schema-engine'
import { useAppStore } from '@/lib/store'
import { topoSort } from '@/lib/topo-sort'

type BuildMode = 'all' | 'selected'

function buildWaveSummary(
  waves: string[][],
  nodeNames: Map<string, string>
) {
  return waves
    .map(
      (wave, index) =>
        `Wave ${index + 1}: ${wave.map((nodeId) => nodeNames.get(nodeId) ?? nodeId).join(', ')}`
    )
    .join('\n')
}

export function BuildButton() {
  const nodes = useAppStore((state) => state.nodes)
  const edges = useAppStore((state) => state.edges)
  const projectName = useAppStore((state) => state.projectName)
  const config = useAppStore((state) => state.config)
  const buildState = useAppStore((state) => state.buildState)
  const updateNodeStatus = useAppStore((state) => state.updateNodeStatus)
  const setBuildState = useAppStore((state) => state.setBuildState)
  const [isPending, startTransition] = useTransition()

  const selectedNodeIds = nodes.filter((node) => node.selected).map((node) => node.id)
  const selectedCount = selectedNodeIds.length

  async function runBuild(mode: BuildMode) {
    let targetNodeIds: string[] = []

    try {
      const scopedYaml = canvasToYaml(
        nodes,
        edges,
        projectName,
        mode === 'selected' ? selectedNodeIds : undefined
      )
      const scopedCanvas = yamlToCanvas(scopedYaml)
      targetNodeIds = scopedCanvas.nodes.map((node) => node.id)

      if (targetNodeIds.length === 0) {
        return
      }

      const waves = topoSort(scopedCanvas.nodes, scopedCanvas.edges)
      const nodeNames = new Map(scopedCanvas.nodes.map((node) => [node.id, node.data.name || node.id]))
      const waveSummary = buildWaveSummary(waves, nodeNames)
      const scopeLabel = mode === 'selected' ? 'selected subgraph' : 'full project'
      const prompts = Object.fromEntries(
        scopedCanvas.nodes.map((node) => {
          const targetName = node.data.name || node.id
          const prompt = [
            buildAllPrompt({
              architecture_yaml: scopedYaml,
              selected_nodes: [targetName],
              project_context: [
                `Project: ${projectName}`,
                `Scope: ${scopeLabel}`,
                `Target node: ${targetName}`,
                waveSummary,
              ].join('\n'),
              user_feedback: `Implement the target node directly in ${config.workDir}. Keep changes focused on ${targetName}.`,
            }),
            '',
            'Execution instructions:',
            `Implement the code for ${targetName} in the current workspace.`,
            'Respect the wave plan and avoid editing unrelated parts of the graph.',
          ].join('\n')

          return [node.id, prompt]
        })
      )

      for (const nodeId of targetNodeIds) {
        updateNodeStatus(nodeId, 'idle', undefined, undefined)
      }

      setBuildState({
        active: true,
        currentWave: 1,
        totalWaves: waves.length,
        targetNodeIds,
      })

      const response = await fetch('/api/agent/spawn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          waves,
          prompts,
          backend: config.agent,
          workDir: config.workDir,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to start build')
      }
    } catch (error) {
      setBuildState({ active: false, currentWave: 0, totalWaves: 0, targetNodeIds: [] })

      for (const nodeId of targetNodeIds) {
        updateNodeStatus(
          nodeId,
          'error',
          undefined,
          error instanceof Error ? error.message : 'Failed to start build'
        )
      }
    }
  }

  function startBuild(mode: BuildMode) {
    startTransition(() => {
      void runBuild(mode)
    })
  }

  return (
    <div className="flex items-center gap-2">
      {selectedCount > 0 ? (
        <button
          type="button"
          onClick={() => startBuild('selected')}
          disabled={buildState.active || isPending}
          className="rounded-full border border-cyan-500/60 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Build Selected ({selectedCount})
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => startBuild('all')}
        disabled={nodes.length === 0 || buildState.active || isPending}
        className="rounded-full border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Build All
      </button>
    </div>
  )
}
