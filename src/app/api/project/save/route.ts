import type { ArchitectProject } from '@/lib/types'
import { saveProject } from '@/lib/project-store'

export const runtime = 'nodejs'

interface SaveProjectRequest {
  dir: string
  project: ArchitectProject
}

export async function POST(request: Request) {
  const { dir, project } = (await request.json()) as SaveProjectRequest

  saveProject(dir, project)

  return Response.json({ ok: true })
}
