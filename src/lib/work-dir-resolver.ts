import fs from 'fs'
import path from 'path'
import type { Node } from '@xyflow/react'
import type { CanvasNodeData } from '@/lib/types'

export function sanitizeName(name: string): string {
  return (
    name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') ||
    'node'
  )
}

export function resolveWorkDir(
  node: Node<CanvasNodeData>,
  allNodes: Node<CanvasNodeData>[],
  baseDir: string
): string {
  if (node.type === 'container') {
    return path.join(baseDir, sanitizeName(node.data.name))
  }

  const parent = node.parentId ? allNodes.find((candidate) => candidate.id === node.parentId) : null
  if (parent) {
    return path.join(baseDir, sanitizeName(parent.data.name), sanitizeName(node.data.name))
  }

  return path.join(baseDir, sanitizeName(node.data.name))
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
