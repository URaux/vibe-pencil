'use client'

import { useTransition } from 'react'
import type { Edge, Node } from '@xyflow/react'
import {
  buildAll as buildAllPrompt,
  buildNode as buildNodePrompt,
  buildSubgraph,
} from '@/lib/prompt-templates'
import { canvasToYaml, yamlToCanvas } from '@/lib/schema-engine'
import { useAppStore } from '@/lib/store'
import { topoSort } from '@/lib/topo-sort'
import type { BlockNodeData, CanvasNodeData } from '@/lib/types'

type BatchBuildMode = 'all' | 'selected'

/**
 * Build a scoped YAML containing only the target node, its parent container,
 * 1-hop neighbors (nodes connected via edges), and edges between these nodes.
 * This avoids sending the full architecture YAML to each per-node build agent.
 */
function scopeToNode(
  nodeId: string,
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  projectName: string
): string {
  const targetNode = nodes.find((n) => n.id === nodeId)
  if (!targetNode) return ''

  // Collect 1-hop neighbor IDs
  const neighborIds = new Set<string>()
  neighborIds.add(nodeId)
  if (targetNode.parentId) neighborIds.add(targetNode.parentId)

  for (const edge of edges) {
    if (edge.source === nodeId) neighborIds.add(edge.target)
    if (edge.target === nodeId) neighborIds.add(edge.source)
  }

  // Include parent containers of neighbors so the YAML is well-formed
  for (const id of [...neighborIds]) {
    const node = nodes.find((n) => n.id === id)
    if (node?.parentId) neighborIds.add(node.parentId)
  }

  const scopedNodes = nodes.filter((n) => neighborIds.has(n.id))
  const scopedEdges = edges.filter(
    (e) => neighborIds.has(e.source) && neighborIds.has(e.target)
  )

  return canvasToYaml(scopedNodes, scopedEdges, projectName)
}

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
  const locale = useAppStore((state) => state.locale)
  const buildState = useAppStore((state) => state.buildState)
  const updateNodeStatus = useAppStore((state) => state.updateNodeStatus)
  const setBuildState = useAppStore((state) => state.setBuildState)
  const [isPending, startTransition] = useTransition()

  // Create project-specific subdirectory under workDir
  const projectSlug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled'
  const projectWorkDir = `${config.workDir}/${projectSlug}`

  const buildableNodes = nodes.filter((node): node is Node<BlockNodeData> => node.type === 'block')
  const selectedNodeIds = buildableNodes.filter((node) => node.selected).map((node) => node.id)
  const selectedCount = selectedNodeIds.length
  const isBuilding = buildState.active || isPending

  /**
   * Compute the wave plan for a given mode without starting a build.
   * Returns null if there are no target nodes.
   */
  function computeBuildPlan(mode: BatchBuildMode) {
    const targetNodes =
      mode === 'selected'
        ? buildableNodes.filter((n) => selectedNodeIds.includes(n.id))
        : buildableNodes

    if (targetNodes.length === 0) return null

    const targetEdges = edges.filter(
      (e) =>
        targetNodes.some((n) => n.id === e.source) &&
        targetNodes.some((n) => n.id === e.target)
    )

    let waves: string[][]
    try {
      waves = topoSort(targetNodes, targetEdges)
    } catch {
      // Cycle detected — fall back to single wave with all nodes (no dependency ordering)
      waves = [targetNodes.map((n) => n.id)]
    }
    const nodeNames = new Map(targetNodes.map((n) => [n.id, n.data.name || n.id]))

    return { waves, nodeNames, mode, targetNodes }
  }

  async function runBatchBuild(mode: BatchBuildMode) {
    let targetNodeIds: string[] = []

    try {
      const scopedYaml =
        mode === 'selected'
          ? canvasToYaml(nodes, edges, projectName, selectedNodeIds)
          : canvasToYaml(nodes, edges, projectName)
      const scopedCanvas = await yamlToCanvas(scopedYaml)
      const scopedBlocks = scopedCanvas.nodes.filter(
        (node): node is Node<BlockNodeData> => node.type === 'block'
      )

      targetNodeIds = scopedBlocks.map((node) => node.id)
      if (targetNodeIds.length === 0) {
        return
      }

      let waves: string[][]
      try {
        waves = topoSort(scopedBlocks, scopedCanvas.edges)
      } catch {
        waves = [scopedBlocks.map((n) => n.id)]
      }
      const nodeNames = new Map(scopedBlocks.map((node) => [node.id, node.data.name || node.id]))
      const waveSummary = buildWaveSummary(waves, nodeNames)
      const scopeLabel = mode === 'selected' ? 'selected subgraph' : 'full project'
      const promptTemplate = mode === 'selected' ? buildSubgraph : buildAllPrompt
      // Index wave membership so each agent knows its concurrent siblings.
      const nodeIdToWaveIndex = new Map<string, number>()
      waves.forEach((wave, i) => { for (const id of wave) nodeIdToWaveIndex.set(id, i) })

      const prompts = Object.fromEntries(
        scopedBlocks.map((node) => {
          const targetName = node.data.name || node.id
          const nodeYaml = scopeToNode(node.id, nodes, edges, projectName)

          // Contract fields: concurrent siblings (same wave), scope hints,
          // and consumed dependencies (upstream blocks this node imports).
          const myWaveIdx = nodeIdToWaveIndex.get(node.id) ?? 0
          const myWave = waves[myWaveIdx] ?? []
          const siblings = myWave
            .filter((id) => id !== node.id)
            .map((id) => nodeNames.get(id) ?? id)
          const upstreamIds = edges
            .filter((e) => e.target === node.id)
            .map((e) => e.source)
            .filter((id, i, arr) => arr.indexOf(id) === i)
          const consumed = upstreamIds
            .map((id) => nodeNames.get(id) ?? id)
            .map((name) => `${name} — signature per the architecture YAML`)

          const prompt = [
            promptTemplate({
              architecture_yaml: nodeYaml,
              selected_nodes: [targetName],
              project_context: [
                `Project: ${projectName}`,
                `Scope: ${scopeLabel}`,
                waveSummary,
              ].join('\n'),
              user_feedback: `Implement the target node directly in ${projectWorkDir}. Keep changes focused on ${targetName}.`,
              locale,
              workDir: projectWorkDir,
              nodeName: targetName,
              blockId: node.id,
              techStack: node.data.techStack,
              waveIndex: myWaveIdx + 1,
              waveSize: myWave.length,
              waveTotal: waves.length,
              siblingNames: siblings,
              consumedSymbols: consumed.length > 0 ? consumed : undefined,
            }),
          ].join('\n')

          return [node.id, prompt]
        })
      )

      // Clear output log before starting new build
      useAppStore.getState().clearBuildOutputLog()

      // Set waiting status for all nodes not in wave 1
      const wave1Set = new Set(waves[0] ?? [])
      for (const nodeId of targetNodeIds) {
        if (wave1Set.has(nodeId)) {
          updateNodeStatus(nodeId, 'idle', undefined, undefined)
        } else {
          updateNodeStatus(nodeId, 'waiting', undefined, undefined)
        }
      }

      setBuildState({
        active: true,
        currentWave: 1,
        totalWaves: waves.length,
        targetNodeIds,
        waves,
        nodeTimings: {},
        blockedNodes: {},
        startedAt: Date.now(),
        completedAt: undefined,
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
          workDir: projectWorkDir,
          maxParallel: config.maxParallel,
          model: config.model,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to start build.')
      }
    } catch (error) {
      setBuildState({ active: false, currentWave: 0, totalWaves: 0, targetNodeIds: [] })

      for (const nodeId of targetNodeIds) {
        updateNodeStatus(
          nodeId,
          'error',
          undefined,
          error instanceof Error ? error.message : 'Failed to start build.'
        )
      }
    }
  }

  async function runNodeBuild(nodeId: string) {
    const targetNode = buildableNodes.find((node) => node.id === nodeId)

    if (!targetNode) {
      return
    }

    try {
      const targetName = targetNode.data.name || targetNode.id
      const upstreamIds = edges
        .filter((e) => e.target === nodeId)
        .map((e) => e.source)
        .filter((id, i, arr) => arr.indexOf(id) === i)
      const upstreamNames = upstreamIds.map((id) => {
        const n = nodes.find((nd) => nd.id === id)
        return (n?.data as BlockNodeData | undefined)?.name ?? id
      })
      const consumed = upstreamNames.map((name) => `${name} — signature per the architecture YAML`)

      const prompt = buildNodePrompt({
        architecture_yaml: scopeToNode(nodeId, nodes, edges, projectName),
        selected_nodes: [targetName],
        project_context: [
          `Project: ${projectName}`,
          'Scope: single node',
        ].join('\n'),
        user_feedback: `Implement ${targetName} directly in ${projectWorkDir}. Keep changes focused on this node.`,
        locale,
        workDir: projectWorkDir,
        nodeName: targetName,
        blockId: nodeId,
        techStack: targetNode.data.techStack,
        waveIndex: 1,
        waveSize: 1,
        waveTotal: 1,
        consumedSymbols: consumed.length > 0 ? consumed : undefined,
      })

      useAppStore.getState().clearBuildOutputLog()
      updateNodeStatus(nodeId, 'idle', undefined, undefined)
      setBuildState({
        active: true,
        currentWave: 1,
        totalWaves: 1,
        targetNodeIds: [nodeId],
        waves: [[nodeId]],
        nodeTimings: {},
        blockedNodes: {},
        startedAt: Date.now(),
        completedAt: undefined,
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
          workDir: projectWorkDir,
          model: config.model,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to start build.')
      }
    } catch (error) {
      setBuildState({ active: false, currentWave: 0, totalWaves: 0, targetNodeIds: [] })
      updateNodeStatus(
        nodeId,
        'error',
        undefined,
        error instanceof Error ? error.message : 'Failed to start build.'
      )
    }
  }

  function buildAll() {
    if (isBuilding || buildableNodes.length === 0) {
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

  async function runRetryFailed() {
    const { nodes: currentNodes, edges: currentEdges } = useAppStore.getState()
    const failedNodes = currentNodes.filter(
      (n): n is Node<BlockNodeData> => n.type === 'block' && (n.data as BlockNodeData).status === 'error'
    )

    if (failedNodes.length === 0) return

    const targetNodeIds = failedNodes.map((n) => n.id)
    const nodeNames = new Map(failedNodes.map((n) => [n.id, (n.data as BlockNodeData).name || n.id]))
    const waves = [targetNodeIds]
    const waveSummary = buildWaveSummary(waves, nodeNames)

    const prompts = Object.fromEntries(
      failedNodes.map((node) => {
        const targetName = (node.data as BlockNodeData).name || node.id
        const techInfo = (node.data as BlockNodeData).techStack
          ? [`Tech stack: ${(node.data as BlockNodeData).techStack}`]
          : []
        const nodeYaml = scopeToNode(node.id, currentNodes, currentEdges, projectName)
        const prompt = [
          buildNodePrompt({
            architecture_yaml: nodeYaml,
            selected_nodes: [targetName],
            project_context: [
              `Project: ${projectName}`,
              'Scope: retry failed',
              `Target node: ${targetName}`,
              ...techInfo,
              waveSummary,
            ].join('\n'),
            user_feedback: `Retry implementing ${targetName} in ${projectWorkDir}. Keep changes focused on this node.`,
            locale,
          }),
          '',
          'Execution instructions:',
          `Retry the implementation of ${targetName} in the current workspace.`,
          ...techInfo,
          'Keep changes focused on this node.',
        ].join('\n')

        return [node.id, prompt]
      })
    )

    try {
      useAppStore.getState().clearBuildOutputLog()

      for (const nodeId of targetNodeIds) {
        updateNodeStatus(nodeId, 'idle', undefined, undefined)
      }

      setBuildState({
        active: true,
        currentWave: 1,
        totalWaves: 1,
        targetNodeIds,
        waves,
        nodeTimings: {},
        blockedNodes: {},
        startedAt: Date.now(),
        completedAt: undefined,
      })

      const response = await fetch('/api/agent/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waves,
          prompts,
          backend: config.agent,
          workDir: projectWorkDir,
          maxParallel: config.maxParallel,
          model: config.model,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to start retry build.')
      }
    } catch (error) {
      setBuildState({ active: false, currentWave: 0, totalWaves: 0, targetNodeIds: [] })

      for (const nodeId of targetNodeIds) {
        updateNodeStatus(
          nodeId,
          'error',
          undefined,
          error instanceof Error ? error.message : 'Failed to start retry build.'
        )
      }
    }
  }

  function retryFailed() {
    if (isBuilding) return

    startTransition(() => {
      void runRetryFailed()
    })
  }

  return {
    buildAll,
    buildNode,
    buildSelected,
    computeBuildPlan,
    retryFailed,
    isBuilding,
    selectedCount,
  }
}
