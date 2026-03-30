import fs from 'fs'
import path from 'path'
import { reconcileDashboard } from '@/lib/dashboard-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface LoadDashboardRequest {
  dir: string
  containerNodeIds: string[]
}

interface StoredDashboardFile {
  tasks?: unknown
}

function getDashboardPath(dir: string) {
  return path.join(dir, 'dashboard.json')
}

export async function POST(request: Request) {
  const { dir, containerNodeIds } = (await request.json()) as LoadDashboardRequest
  const dashboardPath = getDashboardPath(dir)

  if (!fs.existsSync(dashboardPath)) {
    return Response.json({ tasks: [] })
  }

  const parsed = JSON.parse(fs.readFileSync(dashboardPath, 'utf8')) as StoredDashboardFile
  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
  const containerNodes = containerNodeIds.map((id) => ({ id, type: 'container' })) as Parameters<
    typeof reconcileDashboard
  >[0]
  const tasks = reconcileDashboard(containerNodes, rawTasks)

  return Response.json({ tasks })
}
