import { getBuildProgress } from '@/lib/build-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Returns the current server-side build progress so the client can
 * reconnect and restore build state after a page refresh.
 */
export async function GET() {
  const progress = getBuildProgress()
  return Response.json({ progress })
}
