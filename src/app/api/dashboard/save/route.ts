import fs from 'fs'
import path from 'path'
import type { DashboardFile, DashboardTask } from '@/lib/dashboard-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SaveDashboardRequest {
  dir: string
  tasks: DashboardTask[]
}

function getDashboardPath(dir: string) {
  return path.join(dir, 'dashboard.json')
}

export async function POST(request: Request) {
  const { dir, tasks } = (await request.json()) as SaveDashboardRequest
  const payload: DashboardFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    tasks,
  }

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getDashboardPath(dir), JSON.stringify(payload, null, 2), 'utf8')

  return Response.json({ ok: true })
}
