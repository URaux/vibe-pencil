import { loadProject } from '@/lib/project-store'

export const runtime = 'nodejs'

interface LoadProjectRequest {
  dir: string
}

export async function POST(request: Request) {
  const { dir } = (await request.json()) as LoadProjectRequest
  try {
    const project = loadProject(dir)
    return Response.json({ project })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'load failed'
    return Response.json({ error: message }, { status: 400 })
  }
}
