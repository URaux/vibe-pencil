import type { ProjectScan, FileTreeNode } from './project-scanner'

function formatTree(nodes: FileTreeNode[], lines: string[], depth: number): void {
  for (const node of nodes) {
    const indent = '  '.repeat(depth)
    const prefix = node.type === 'dir' ? '/' : ''
    lines.push(`${indent}${node.name}${prefix}`)
    if (node.children && node.children.length > 0) {
      formatTree(node.children, lines, depth + 1)
    }
  }
}

export function formatScanForPrompt(scan: ProjectScan): string {
  const lines: string[] = []

  lines.push(`## Project: ${scan.name}`)
  lines.push(`Framework: ${scan.framework ?? 'unknown'} | Language: ${scan.language}`)
  lines.push(`Files: ${scan.totalFiles} | Lines: ~${scan.totalLines}`)
  lines.push('')

  // File tree (indented)
  lines.push('### File Tree')
  lines.push('```')
  formatTree(scan.fileTree, lines, 0)
  lines.push('```')
  lines.push('')

  // Dependencies
  if (scan.dependencies.length > 0) {
    lines.push('### Dependencies')
    lines.push(scan.dependencies.join(', '))
    lines.push('')
  }

  // Entry points
  if (scan.entryPoints.length > 0) {
    lines.push('### Entry Points')
    for (const ep of scan.entryPoints) lines.push(`- ${ep}`)
    lines.push('')
  }

  // Directory roles
  if (scan.directories.length > 0) {
    lines.push('### Detected Directory Roles')
    for (const dir of scan.directories) {
      if (dir.role) {
        lines.push(`- ${dir.path} (${dir.role}, ${dir.fileCount} files)`)
      }
    }
    lines.push('')
  }

  // Key file contents
  for (const [filePath, content] of Object.entries(scan.keyFileContents)) {
    lines.push(`### ${filePath}`)
    lines.push('```')
    lines.push(content)
    lines.push('```')
    lines.push('')
  }

  return lines.join('\n')
}
