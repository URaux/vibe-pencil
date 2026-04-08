import type { Edge, Node } from '@xyflow/react'
import type { BlockNodeData, BuildStatus, CanvasNodeData, ContainerColor, ContainerNodeData } from '@/lib/types'
import type { DirectoryRole, ProjectScan } from './project-scanner'
import path from 'path'
import fs from 'fs'

// ---- Types ----

interface ContainerSpec {
  id: string
  name: string
  color: ContainerColor
  role: DirectoryRole | 'infrastructure'
  sourcePaths: string[]  // relative dir paths that feed into this container
}

interface BlockSpec {
  id: string
  name: string
  containerId: string
}

// ---- Color map ----

const ROLE_COLOR: Record<string, ContainerColor> = {
  frontend: 'blue',
  components: 'blue',
  api: 'green',
  lib: 'purple',
  services: 'purple',
  database: 'amber',
  infrastructure: 'slate',
}

const MONOREPO_COLORS: ContainerColor[] = ['blue', 'green', 'purple', 'amber', 'rose', 'slate']

// ---- Name helpers ----

function titleCase(str: string): string {
  return str
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim()
}

// ---- Container generation ----

function buildContainers(scan: ProjectScan): ContainerSpec[] {
  const specs: ContainerSpec[] = []
  const addedRoles = new Set<string>()

  // Merge frontend + components into single Frontend container
  const hasFrontend = scan.directories.some((d) => d.role === 'frontend')
  const hasComponents = scan.directories.some((d) => d.role === 'components')

  if (hasFrontend || hasComponents) {
    const sourcePaths = scan.directories
      .filter((d) => d.role === 'frontend' || d.role === 'components')
      .map((d) => d.path)
    specs.push({
      id: 'container-frontend',
      name: 'Frontend',
      color: 'blue',
      role: 'frontend',
      sourcePaths,
    })
    addedRoles.add('frontend')
    addedRoles.add('components')
  }

  // Remaining roles in priority order
  const roleOrder: Array<{ role: DirectoryRole; name: string }> = [
    { role: 'api', name: 'API Layer' },
    { role: 'services', name: 'Services' },
    { role: 'lib', name: 'Core Libraries' },
    { role: 'database', name: 'Data Layer' },
    { role: 'tests', name: 'Testing' },
    { role: 'docs', name: 'Documentation' },
    { role: 'infrastructure', name: 'Infrastructure' },
  ]

  const EXCLUDED_ROLES = new Set(['tests', 'docs', 'config', 'infrastructure'])

  for (const { role, name } of roleOrder) {
    if (addedRoles.has(role)) continue
    if (EXCLUDED_ROLES.has(role)) continue

    const dirs = scan.directories.filter((d) => d.role === role)
    if (dirs.length === 0) continue

    specs.push({
      id: `container-${role}`,
      name,
      color: ROLE_COLOR[role] ?? 'blue',
      role,
      sourcePaths: dirs.map((d) => d.path),
    })
    addedRoles.add(role)
  }

  // Infrastructure: if infra dirs exist OR docker-compose found
  const hasInfra = scan.directories.some((d) => d.role === 'infrastructure')
  const hasDockerCompose = Object.keys(scan.keyFileContents).some((k) =>
    k.startsWith('docker-compose')
  )
  if (hasInfra || hasDockerCompose) {
    specs.push({
      id: 'container-infrastructure',
      name: 'Infrastructure',
      color: 'slate',
      role: 'infrastructure',
      sourcePaths: scan.directories
        .filter((d) => d.role === 'infrastructure')
        .map((d) => d.path),
    })
  }

  // Monorepo packages
  const monorepoPackages = scan.directories.filter((d) => d.role === 'monorepo-package')
  for (const [i, pkg] of monorepoPackages.entries()) {
    const pkgName = titleCase(path.basename(pkg.path))
    specs.push({
      id: `container-monorepo-${i}`,
      name: pkgName,
      color: MONOREPO_COLORS[i % MONOREPO_COLORS.length],
      role: 'monorepo-package',
      sourcePaths: [pkg.path],
    })
  }

  return specs
}

// ---- Block generation ----

function getSubdirsWithFiles(
  relDirPath: string,
  scanDir: string,
  fileTree: import('./project-scanner').FileTreeNode[]
): Array<{ name: string; fileCount: number }> {
  // Find the node in the tree matching relDirPath
  function findNode(
    nodes: import('./project-scanner').FileTreeNode[],
    target: string
  ): import('./project-scanner').FileTreeNode | null {
    for (const node of nodes) {
      if (node.path === target) return node
      if (node.type === 'dir' && node.children) {
        const found = findNode(node.children, target)
        if (found) return found
      }
    }
    return null
  }

  const targetNode = findNode(fileTree, relDirPath)
  if (!targetNode || targetNode.type !== 'dir' || !targetNode.children) return []

  const result: Array<{ name: string; fileCount: number }> = []
  for (const child of targetNode.children) {
    if (child.type !== 'dir') continue
    const fileCount = (child.children ?? []).filter((c) => c.type === 'file').length
    if (fileCount >= 2) {
      result.push({ name: child.name, fileCount })
    }
  }
  return result
}

function getSignificantFiles(
  relDirPath: string,
  scanDir: string,
  fileTree: import('./project-scanner').FileTreeNode[],
  keyFileContents: Record<string, string>
): string[] {
  function findNode(
    nodes: import('./project-scanner').FileTreeNode[],
    target: string
  ): import('./project-scanner').FileTreeNode | null {
    for (const node of nodes) {
      if (node.path === target) return node
      if (node.type === 'dir' && node.children) {
        const found = findNode(node.children, target)
        if (found) return found
      }
    }
    return null
  }

  const targetNode = findNode(fileTree, relDirPath)
  if (!targetNode || targetNode.type !== 'dir' || !targetNode.children) return []

  const significant: string[] = []
  for (const child of targetNode.children) {
    if (child.type !== 'file') continue
    const name = child.name.toLowerCase()
    // Skip barrel exports, type files, test files
    if (name === 'index.ts' || name === 'index.js') continue
    if (name.startsWith('types') || name.endsWith('.d.ts')) continue
    if (name.includes('test') || name.includes('spec')) continue

    // Check if file is large enough (>50 lines) by reading key file content or size estimate
    const content = keyFileContents[child.path]
    if (content) {
      const lineCount = content.split('\n').length
      if (lineCount > 50) {
        significant.push(path.basename(child.name, path.extname(child.name)))
      }
    } else if (child.size && child.size > 1200) {
      // ~50 lines at 24 bytes/line average
      significant.push(path.basename(child.name, path.extname(child.name)))
    }
  }
  return significant
}

function buildBlocksForContainer(
  container: ContainerSpec,
  scan: ProjectScan,
  projectRoot: string
): BlockSpec[] {
  const MAX_BLOCKS = 6
  const blocks: BlockSpec[] = []
  const seenNames = new Set<string>()

  function addBlock(name: string, suffix?: string) {
    const displayName = titleCase(name)
    if (seenNames.has(displayName)) return
    seenNames.add(displayName)
    const idx = blocks.length + 1
    blocks.push({
      id: `block-${container.id.replace('container-', '')}-${idx}`,
      name: displayName,
      containerId: container.id,
    })
  }

  // Framework-specific overrides for Next.js
  if (scan.framework === 'nextjs' && container.role === 'frontend') {
    // src/app route groups (strip parentheses)
    const appDir = scan.fileTree.find((n) => n.path === 'src' || n.path === 'src/app')
    // Look for src/app children
    function findAppChildren() {
      for (const node of scan.fileTree) {
        if (node.path === 'src' && node.children) {
          for (const child of node.children) {
            if (child.name === 'app' && child.children) return child.children
          }
        }
        if (node.path === 'src/app' && node.children) return node.children
      }
      return []
    }
    const appChildren = findAppChildren()
    for (const child of appChildren) {
      if (child.type === 'dir') {
        // Route groups: (name) -> strip parens
        const cleaned = child.name.replace(/^\(|\)$/g, '')
        addBlock(cleaned)
      }
    }
  }

  if (scan.framework === 'nextjs' && container.role === 'api') {
    // src/app/api subdirectories
    for (const sourcePath of container.sourcePaths) {
      const subdirs = getSubdirsWithFiles(sourcePath, projectRoot, scan.fileTree)
      for (const sub of subdirs) addBlock(sub.name)
    }
    return blocks.slice(0, MAX_BLOCKS)
  }

  // FastAPI / Django / Flask specializations
  if (['fastapi', 'django', 'flask'].includes(scan.framework ?? '')) {
    if (container.role === 'api') {
      for (const sourcePath of container.sourcePaths) {
        const subdirs = getSubdirsWithFiles(sourcePath, projectRoot, scan.fileTree)
        for (const sub of subdirs) addBlock(sub.name)
      }
      // Schemas block if schemas/ or serializers/ exists
      const hasSchemas = scan.directories.some(
        (d) => d.path.endsWith('schemas') || d.path.endsWith('serializers')
      )
      if (hasSchemas) addBlock('Schemas')
    }
    if (container.role === 'database') {
      for (const sourcePath of container.sourcePaths) {
        const subdirs = getSubdirsWithFiles(sourcePath, projectRoot, scan.fileTree)
        for (const sub of subdirs) addBlock(sub.name)
      }
    }
  }

  // Express / NestJS
  if (['express', 'nestjs'].includes(scan.framework ?? '')) {
    if (container.role === 'api') {
      for (const sourcePath of container.sourcePaths) {
        const subdirs = getSubdirsWithFiles(sourcePath, projectRoot, scan.fileTree)
        for (const sub of subdirs) addBlock(sub.name)
      }
      const hasMiddleware = scan.directories.some((d) => d.path.endsWith('middleware'))
      if (hasMiddleware) addBlock('Middleware')
    }
    if (container.role === 'database') {
      for (const sourcePath of container.sourcePaths) {
        const subdirs = getSubdirsWithFiles(sourcePath, projectRoot, scan.fileTree)
        for (const sub of subdirs) addBlock(sub.name)
      }
    }
  }

  // Generic: subdirectory-as-block, then significant-file-as-block
  for (const sourcePath of container.sourcePaths) {
    if (blocks.length >= MAX_BLOCKS) break
    const subdirs = getSubdirsWithFiles(sourcePath, projectRoot, scan.fileTree)
    for (const sub of subdirs) {
      if (blocks.length >= MAX_BLOCKS) break
      addBlock(sub.name)
    }
  }

  for (const sourcePath of container.sourcePaths) {
    if (blocks.length >= MAX_BLOCKS) break
    const sigFiles = getSignificantFiles(sourcePath, projectRoot, scan.fileTree, scan.keyFileContents)
    for (const name of sigFiles) {
      if (blocks.length >= MAX_BLOCKS) break
      addBlock(name)
    }
  }

  // Prisma special block for data layer
  if (container.role === 'database') {
    const hasPrisma = scan.dependencies.includes('prisma') || scan.dependencies.includes('@prisma/client')
    if (hasPrisma) addBlock('Prisma ORM')
  }

  // Fallback: if container is empty, add a block named after the first source path
  if (blocks.length === 0 && container.sourcePaths.length > 0) {
    addBlock(path.basename(container.sourcePaths[0]))
  }

  return blocks.slice(0, MAX_BLOCKS)
}

// ---- Edge generation ----

function buildTemplateEdges(
  containers: ContainerSpec[],
  blocks: BlockSpec[]
): Edge[] {
  const edges: Edge[] = []
  const containerMap = new Map(containers.map((c) => [c.role, c]))
  const blocksByContainer = new Map<string, BlockSpec[]>()

  for (const block of blocks) {
    const list = blocksByContainer.get(block.containerId) ?? []
    list.push(block)
    blocksByContainer.set(block.containerId, list)
  }

  function firstBlockOf(containerId: string): string | null {
    return blocksByContainer.get(containerId)?.[0]?.id ?? null
  }

  let edgeIdx = 1

  // Frontend -> API
  const frontendContainer = containers.find((c) => c.role === 'frontend')
  const apiContainer = containers.find((c) => c.role === 'api')
  if (frontendContainer && apiContainer) {
    const src = firstBlockOf(frontendContainer.id)
    const tgt = firstBlockOf(apiContainer.id)
    if (src && tgt) {
      edges.push({
        id: `edge-skeleton-${edgeIdx++}`,
        source: src,
        target: tgt,
        type: 'sync',
        label: 'HTTP',
      })
    }
  }

  // API -> Data Layer
  const dataContainer = containers.find((c) => c.role === 'database')
  if (apiContainer && dataContainer) {
    const src = firstBlockOf(apiContainer.id)
    const tgt = firstBlockOf(dataContainer.id)
    if (src && tgt) {
      edges.push({
        id: `edge-skeleton-${edgeIdx++}`,
        source: src,
        target: tgt,
        type: 'sync',
        label: 'query',
      })
    }
  }

  // Services -> Data Layer
  const servicesContainer = containers.find((c) => c.role === 'services')
  if (servicesContainer && dataContainer) {
    const src = firstBlockOf(servicesContainer.id)
    const tgt = firstBlockOf(dataContainer.id)
    if (src && tgt) {
      edges.push({
        id: `edge-skeleton-${edgeIdx++}`,
        source: src,
        target: tgt,
        type: 'sync',
      })
    }
  }

  return edges
}


function buildEdgesFromImports(
  scan: ProjectScan,
  containers: ContainerSpec[],
  blocks: BlockSpec[]
): Edge[] {
  const importEdges = scan.importGraph?.edges
  if (!importEdges || importEdges.length === 0) return []

  // Build a mapping: file path -> block id
  const fileToBlock = new Map<string, string>()

  for (const container of containers) {
    const containerBlocks = blocks.filter(b => b.containerId === container.id)
    for (const sourcePath of container.sourcePaths) {
      for (const edge of importEdges) {
        for (const filePath of [edge.sourceFile, edge.targetFile]) {
          if (filePath.startsWith(sourcePath + '/') || filePath === sourcePath) {
            let matched = false
            for (const block of containerBlocks) {
              const blockNameLower = block.name.toLowerCase().replace(/\s+/g, '-')
              const pathParts = filePath.toLowerCase().split('/')
              if (pathParts.some(part => part === blockNameLower || part === block.name.toLowerCase())) {
                fileToBlock.set(filePath, block.id)
                matched = true
                break
              }
            }
            if (!matched && containerBlocks.length > 0) {
              fileToBlock.set(filePath, containerBlocks[0].id)
            }
          }
        }
      }
    }
  }

  // Aggregate file-level imports into block-level edges
  const blockPairMap = new Map<string, {
    sourceId: string
    targetId: string
    count: number
    hasDynamic: boolean
    hasWebSocket: boolean
  }>()

  for (const edge of importEdges) {
    const sourceBlock = fileToBlock.get(edge.sourceFile)
    const targetBlock = fileToBlock.get(edge.targetFile)
    if (!sourceBlock || !targetBlock) continue
    if (sourceBlock === targetBlock) continue

    const key = sourceBlock + '::' + targetBlock
    const existing = blockPairMap.get(key)

    if (existing) {
      existing.count++
      if (edge.importType === 'dynamic') existing.hasDynamic = true
    } else {
      const hasWs = edge.symbols?.some(s =>
        s.toLowerCase().includes('websocket') || s.toLowerCase() === 'ws'
      ) ?? false

      blockPairMap.set(key, {
        sourceId: sourceBlock,
        targetId: targetBlock,
        count: 1,
        hasDynamic: edge.importType === 'dynamic',
        hasWebSocket: hasWs,
      })
    }
  }

  // Check file contents for WebSocket patterns
  const wsFiles = new Set<string>()
  if (scan.keyFileContents) {
    for (const [filePath, fileContent] of Object.entries(scan.keyFileContents)) {
      if (fileContent.includes('WebSocket') || fileContent.includes('from ' + String.fromCharCode(39) + 'ws' + String.fromCharCode(39)) || fileContent.includes('from ' + String.fromCharCode(34) + 'ws' + String.fromCharCode(34))) {
        wsFiles.add(filePath)
      }
    }
  }

  for (const edge of importEdges) {
    if (wsFiles.has(edge.sourceFile) || wsFiles.has(edge.targetFile)) {
      const sourceBlock = fileToBlock.get(edge.sourceFile)
      const targetBlock = fileToBlock.get(edge.targetFile)
      if (sourceBlock && targetBlock && sourceBlock !== targetBlock) {
        const key = sourceBlock + '::' + targetBlock
        const pair = blockPairMap.get(key)
        if (pair) pair.hasWebSocket = true
      }
    }
  }

  // Convert to edges, sort by count, cap at 15
  const sortedPairs = [...blockPairMap.values()].sort((a, b) => b.count - a.count)
  const MAX_EDGES = 15
  const edges: Edge[] = []
  let edgeIdx = 1

  for (const pair of sortedPairs.slice(0, MAX_EDGES)) {
    let edgeType: 'sync' | 'async' | 'bidirectional' = 'sync'
    let label: string | undefined

    if (pair.hasWebSocket) {
      edgeType = 'async'
      label = 'WebSocket'
    } else if (pair.hasDynamic) {
      edgeType = 'sync'
      label = pair.count > 1 ? pair.count + ' imports (dynamic)' : 'dynamic import'
    }

    if (!label && pair.count > 1) {
      label = pair.count + ' imports'
    }

    edges.push({
      id: 'edge-import-' + edgeIdx++,
      source: pair.sourceId,
      target: pair.targetId,
      type: edgeType,
      ...(label ? { label } : {}),
    })
  }

  return edges
}

function buildEdges(
  scan: ProjectScan,
  containers: ContainerSpec[],
  blocks: BlockSpec[]
): Edge[] {
  if (scan.importGraph && scan.importGraph.edges.length > 0) {
    const importEdges = buildEdgesFromImports(scan, containers, blocks)
    if (importEdges.length > 0) return importEdges
  }
  return buildTemplateEdges(containers, blocks)
}

// ---- Main export ----

export function generateSkeleton(scan: ProjectScan): {
  nodes: Node<CanvasNodeData>[]
  edges: Edge[]
} {
  const containers = buildContainers(scan)

  const allBlocks: BlockSpec[] = []
  for (const container of containers) {
    const blocks = buildBlocksForContainer(container, scan, '')
    allBlocks.push(...blocks)
  }

  const emptyBlockData: BlockNodeData = {
    name: '',
    description: '',
    status: 'idle' as BuildStatus,
    techStack: '',
  }

  const nodes: Node<CanvasNodeData>[] = []

  // Container nodes
  for (const c of containers) {
    nodes.push({
      id: c.id,
      type: 'container',
      position: { x: 0, y: 0 },
      style: { width: 400, height: 300 },
      data: {
        name: c.name,
        color: c.color,
        collapsed: false,
      } satisfies ContainerNodeData,
    })
  }

  // Block nodes
  for (const b of allBlocks) {
    nodes.push({
      id: b.id,
      type: 'block',
      position: { x: 24, y: 72 },
      parentId: b.containerId,
      extent: 'parent',
      data: {
        ...emptyBlockData,
        name: b.name,
      } satisfies BlockNodeData,
    })
  }

  const edges = buildEdges(scan, containers, allBlocks)

  return { nodes, edges }
}
