import fs from 'fs'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ReadFilesRequest {
  workDir: string
  files: string[]
  maxTokens?: number
}

const PRIORITY_ORDER = [
  'index.ts',
  'index.tsx',
  'index.js',
  'app.ts',
  'app.tsx',
  'app.js',
  'main.ts',
  'main.tsx',
  'main.js',
  'package.json',
  'README.md',
  'readme.md',
  '.config.ts',
  '.config.js',
]

function priorityScore(filePath: string): number {
  const base = path.basename(filePath)
  const idx = PRIORITY_ORDER.findIndex((p) => base === p || filePath.endsWith(p))
  return idx === -1 ? PRIORITY_ORDER.length : idx
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function sortByPriority(files: string[]): string[] {
  return [...files].sort((a, b) => priorityScore(a) - priorityScore(b))
}

export async function POST(request: Request) {
  let payload: ReadFilesRequest
  try {
    payload = (await request.json()) as ReadFilesRequest
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { workDir, files, maxTokens = 4000 } = payload

  if (!workDir || !files || !Array.isArray(files)) {
    return Response.json({ error: 'workDir and files[] are required.' }, { status: 400 })
  }

  // Resolve workDir — normalize to OS path separators
  const resolvedWorkDir = path.resolve(path.isAbsolute(workDir) ? workDir : path.join(process.cwd(), workDir))

  if (!fs.existsSync(resolvedWorkDir)) {
    return Response.json({ content: '', warning: `workDir not found: ${resolvedWorkDir}` })
  }

  const prioritized = sortByPriority(files)
  const sections: string[] = []
  let totalTokens = 0
  const unread: string[] = []

  for (const file of prioritized) {
    // Prevent path traversal
    const filePath = path.resolve(resolvedWorkDir, file)
    if (!filePath.startsWith(resolvedWorkDir)) {
      continue
    }

    if (!fs.existsSync(filePath)) {
      continue
    }

    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    const fileTokens = estimateTokens(content)

    if (totalTokens + fileTokens > maxTokens) {
      const remaining = maxTokens - totalTokens
      if (remaining > 50) {
        const truncated = content.slice(0, remaining * 4)
        sections.push(`--- ${file} (truncated) ---\n${truncated}\n...(truncated)`)
        totalTokens = maxTokens
      } else {
        unread.push(file)
      }
      break
    }

    sections.push(`--- ${file} ---\n${content}`)
    totalTokens += fileTokens
  }

  // Track remaining unread files
  const readCount = sections.length
  for (let i = readCount; i < prioritized.length; i++) {
    unread.push(prioritized[i])
  }

  if (unread.length > 0) {
    sections.push(`\nOther files (not shown): ${unread.join(', ')}`)
  }

  return Response.json({ content: sections.join('\n\n') })
}
