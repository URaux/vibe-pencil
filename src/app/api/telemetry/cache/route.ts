import { getCacheStats } from '@/lib/orchestrator/cache'

export const runtime = 'nodejs'

export function GET(): Response {
  return Response.json({ classifier: getCacheStats() })
}
