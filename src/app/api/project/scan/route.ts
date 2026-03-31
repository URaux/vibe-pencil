import fs from 'fs'
import { scanProject } from '@/lib/project-scanner'
import { generateSkeleton } from '@/lib/skeleton-generator'
import { layoutArchitectureCanvas } from '@/lib/graph-layout'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ScanRequest {
  dir: string
}

export async function POST(request: Request) {
  let body: ScanRequest
  try {
    body = (await request.json()) as ScanRequest
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { dir } = body

  if (!dir?.trim()) {
    return Response.json({ error: 'Project directory path cannot be empty.' }, { status: 400 })
  }

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return Response.json({ error: 'Project directory does not exist.' }, { status: 400 })
  }

  try {
    const scan = await scanProject(dir)
    const skeleton = generateSkeleton(scan)
    const arranged = await layoutArchitectureCanvas(skeleton.nodes, skeleton.edges)

    return Response.json({
      nodes: arranged.nodes,
      edges: arranged.edges,
      scan,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Project scan failed.' },
      { status: 500 }
    )
  }
}
