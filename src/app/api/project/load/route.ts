import { loadProject } from '@/lib/project-store'

export const runtime = 'nodejs'

interface LoadProjectRequest {
  dir: string
}

export async function POST(request: Request) {
  const { dir } = (await request.json()) as LoadProjectRequest
  const project = loadProject(dir)

  return Response.json({ project })
}
