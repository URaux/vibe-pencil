import type { ArchitectProject } from '@/lib/types'
import { saveProject } from '@/lib/project-store'

export const runtime = 'nodejs'

interface SaveProjectRequest {
  dir: string
  project: ArchitectProject
}

export async function POST(request: Request) {
  const { dir, project } = (await request.json()) as SaveProjectRequest

  try {
    saveProject(dir, project)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'save failed'
    return Response.json({ error: message }, { status: 400 })
  }

  return Response.json({ ok: true })
}
