import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const okResult = {
  intent: 'explain' as const,
  confidence: 0.9,
  rawOutput: '{"intent":"explain","confidence":0.9,"rationale":"test"}',
  fallback: false,
}

async function freshCache() {
  const mod = await import('@/lib/orchestrator/cache')
  mod.resetCache()
  return mod
}

beforeEach(async () => {
  delete process.env.ARCHVIBER_CLASSIFY_CACHE_SIZE
  const { resetCache } = await import('@/lib/orchestrator/cache')
  resetCache()
})

afterEach(async () => {
  delete process.env.ARCHVIBER_CLASSIFY_CACHE_SIZE
  const { resetCache } = await import('@/lib/orchestrator/cache')
  resetCache()
})

describe('getCacheStats', () => {
  it('tracks hits and misses accurately', async () => {
    const { cacheGet, cacheSet, makeCacheKey, getCacheStats } = await freshCache()

    const k1 = makeCacheKey('prompt-a', 3, 1)
    const k2 = makeCacheKey('prompt-b', 3, 1)

    // miss
    cacheGet(k1)
    // set + hit
    cacheSet(k1, okResult)
    cacheGet(k1)
    // miss
    cacheGet(k2)

    const stats = getCacheStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(2)
    expect(stats.size).toBe(1)
  })

  it('counts evictions when LRU capacity is exceeded', async () => {
    process.env.ARCHVIBER_CLASSIFY_CACHE_SIZE = '2'
    const { cacheSet, makeCacheKey, getCacheStats } = await freshCache()

    const k1 = makeCacheKey('prompt-1', 1, 0)
    const k2 = makeCacheKey('prompt-2', 2, 0)
    const k3 = makeCacheKey('prompt-3', 3, 0)

    cacheSet(k1, okResult)
    cacheSet(k2, okResult)
    // k3 evicts k1
    cacheSet(k3, okResult)

    const stats = getCacheStats()
    expect(stats.evictions).toBe(1)
    expect(stats.size).toBe(2)
  })

  it('GET /api/telemetry/cache returns {classifier: stats} with correct shape', async () => {
    const { cacheGet, cacheSet, makeCacheKey, resetCache } = await freshCache()

    const k = makeCacheKey('telemetry-test', 5, 2)
    cacheSet(k, okResult)
    cacheGet(k) // hit
    cacheGet(makeCacheKey('absent', 0, 0)) // miss

    // Import the route handler and call it
    const { GET } = await import('@/app/api/telemetry/cache/route')
    const res = GET()
    const body = await res.json() as { classifier: { hits: number; misses: number; evictions: number; size: number } }

    expect(res.status).toBe(200)
    expect(body.classifier).toBeDefined()
    expect(body.classifier.hits).toBeGreaterThanOrEqual(1)
    expect(body.classifier.misses).toBeGreaterThanOrEqual(1)
    expect(typeof body.classifier.evictions).toBe('number')
    expect(typeof body.classifier.size).toBe('number')

    resetCache()
  })
})
