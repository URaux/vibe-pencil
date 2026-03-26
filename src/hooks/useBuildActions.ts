'use client'

import { useTransition } from 'react'
import {
  buildAll as buildAllPrompt,
  buildNode as buildNodePrompt,
  buildSubgraph,
} from '@/lib/prompt-templates'
import { canvasToYaml, yamlToCanvas } from '@/lib/schema-engine'
import { useAppStore } from '@/lib/store'
import { topoSort } from '@/lib/topo-sort'

type BatchBuildMode = 'all' | 'selected'

function buildWaveSummary(waves: string[][], nodeNames: Map<string, string>) {
  return waves
    .map(
      (wave, index) =>
        `Wave ${index + 1}: ${wave.map((nodeId) => nodeNames.get(nodeId) ?? nodeId).join(', ')}`
    )
    .join('\n')
}

export function useBuildActions() {
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
  const isBuilding = buildState.active || isPending

  async function runBatchBuild(mode: BatchBuildMode) {
    let targetNodeIds: string[] = []

    try {
      const scopedYaml =
        mode === 'selected'
          ? canvasToYaml(nodes, edges, projectName, selectedNodeIds)
          : canvasToYaml(nodes, edges, projectName)
      const scopedCanvas = yamlToCanvas(scopedYaml)
      targetNodeIds = scopedCanvas.nodes.map((node) => node.id)

      if (targetNodeIds.length === 0) {
        return
      }

      const waves = topoSort(scopedCanvas.nodes, scopedCanvas.edges)
      const nodeNames = new Map(scopedCanvas.nodes.map((node) => [node.id, node.data.name || node.id]))
      const waveSummary = buildWaveSummary(waves, nodeNames)
      const scopeLabel = mode === 'selected' ? 'selected subgraph' : 'full project'
      const promptTemplate = mode === 'selected' ? buildSubgraph : buildAllPrompt
      const prompts = Object.fromEntries(
        scopedCanvas.nodes.map((node) => {
          const targetName = node.data.name || node.id
          const prompt = [
            promptTemplate({
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

  async function runNodeBuild(nodeId: string) {
    const targetNode = nodes.find((node) => node.id === nodeId)

    if (!targetNode) {
      return
    }

    try {
      const targetName = targetNode.data.name || targetNode.id
      const prompt = [
        buildNodePrompt({
          architecture_yaml: canvasToYaml(nodes, edges, projectName),
          selected_nodes: [targetName],
          project_context: [
            `Project: ${projectName}`,
            'Scope: single node',
            `Target node: ${targetName}`,
          ].join('\n'),
          user_feedback: `Implement ${targetName} directly in ${config.workDir}. Keep changes focused on this node.`,
        }),
        '',
        'Execution instructions:',
        `Implement the code for ${targetName} in the current workspace.`,
        'Keep changes focused on this node and note any required dependencies.',
      ].join('\n')

      updateNodeStatus(nodeId, 'idle', undefined, undefined)
      setBuildState({
        active: true,
        currentWave: 1,
        totalWaves: 1,
        targetNodeIds: [nodeId],
      })

      const response = await fetch('/api/agent/spawn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nodeId,
          prompt,
          backend: config.agent,
          workDir: config.workDir,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to start build')
      }
    } catch (error) {
      setBuildState({ active: false, currentWave: 0, totalWaves: 0, targetNodeIds: [] })
      updateNodeStatus(
        nodeId,
        'error',
        undefined,
        error instanceof Error ? error.message : 'Failed to start build'
      )
    }
  }

  function buildAll() {
    if (isBuilding || nodes.length === 0) {
      return
    }

    startTransition(() => {
      void runBatchBuild('all')
    })
  }

  function buildSelected() {
    if (isBuilding || selectedCount === 0) {
      return
    }

    startTransition(() => {
      void runBatchBuild('selected')
    })
  }

  function buildNode(nodeId: string) {
    if (isBuilding) {
      return
    }

    startTransition(() => {
      void runNodeBuild(nodeId)
    })
  }

  return {
    buildAll,
    buildNode,
    buildSelected,
    isBuilding,
    selectedCount,
  }
}
