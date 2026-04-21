import fs from 'fs'
import path from 'path'
import type { BuildSummary } from '@/lib/types'
import type { ProjectMemory } from '@/lib/project-memory'

export const runtime = 'nodejs'

interface SaveMemoryRequest {
  workDir: string
  projectName: string
  nodeSummaries: Record<string, BuildSummary>
}

// Serialize writes per absolute memory.json path. Each completed node fires an
// independent POST, so two nearby completions otherwise both read the same old
// file then both write — second write wins, first node's summary lost.
const saveLocks: Map<string, Promise<unknown>> = new Map()

function withMemoryLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = saveLocks.get(key) ?? Promise.resolve()
  const next = prior.then(() => fn(), () => fn())
  saveLocks.set(key, next)
  next.finally(() => {
    if (saveLocks.get(key) === next) saveLocks.delete(key)
  }).catch(() => undefined)
  return next
}

export async function POST(request: Request) {
  let body: SaveMemoryRequest
  try {
    body = (await request.json()) as SaveMemoryRequest
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { workDir, projectName, nodeSummaries } = body

  if (!workDir) {
    return Response.json({ error: 'workDir is required' }, { status: 400 })
  }

  try {
    // Resolve relative paths from CWD (same convention as agent-runner)
    const resolvedDir = path.isAbsolute(workDir) ? workDir : path.join(process.cwd(), workDir)

    const memoryPath = path.join(resolvedDir, 'memory.json')

    await withMemoryLock(memoryPath, async () => {
      // Ensure directory exists
      fs.mkdirSync(resolvedDir, { recursive: true })

      // Merge with existing memory so partial saves don't overwrite other nodes
      let existing: ProjectMemory | null = null
      try {
        const raw = fs.readFileSync(memoryPath, 'utf8')
        existing = JSON.parse(raw) as ProjectMemory
      } catch {
        // No existing file — start fresh
      }

      const updated: ProjectMemory = {
        projectName: projectName ?? existing?.projectName ?? '',
        updatedAt: new Date().toISOString(),
        nodeSummaries: {
          ...(existing?.nodeSummaries ?? {}),
          ...nodeSummaries,
        },
      }

      // Atomic write: temp file then rename, so a mid-write crash leaves the
      // prior file intact rather than a half-JSON stub.
      const tmpPath = `${memoryPath}.${process.pid}.${Date.now()}.tmp`
      fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf8')
      fs.renameSync(tmpPath, memoryPath)
    })

    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `Failed to save memory: ${msg}` }, { status: 500 })
  }
}
