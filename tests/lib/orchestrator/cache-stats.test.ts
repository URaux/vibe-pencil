import { afterEach, beforeEach, describe, expect, it } from 'vitest'

beforeEach(() => {
  delete process.env.ARCHVIBER_CLASSIFY_CACHE_SIZE
})

afterEach(async () => {
  delete process.env.ARCHVIBER_CLASSIFY_CACHE_SIZE
  const { resetCache } = await import('@/lib/orchestrator/cache')
  resetCache()
})

const okResult = {
  intent: 'explain' as const,
  confidence: 0.9,
  rawOutput: '{"intent":"explain","confidence":0.9}',
  fallback: false,
}

describe('getCacheStats', () => {
  it('accurately counts hits and misses', async () => {
    const { cacheGet, cacheSet, makeCacheKey, getCacheStats, resetCache } =
      await import('@/lib/orchestrator/cache')
    resetCache()

    const k1 = makeCacheKey('prompt-a', 2, 1)
    const k2 = makeCacheKey('prompt-b', 3, 0)

    cacheSet(k1, okResult)

    cacheGet(k1) // hit
    cacheGet(k1) // hit
    cacheGet(k2) // miss

    const stats = getCacheStats()
    expect(stats.hits).toBe(2)
    expect(stats.misses).toBe(1)
    expect(stats.size).toBe(1)
  })

  it('counts evictions when capacity is exceeded', async () => {
    process.env.ARCHVIBER_CLASSIFY_CACHE_SIZE = '2'
    const { cacheGet: _g, cacheSet, makeCacheKey, getCacheStats, resetCache } =
      await import('@/lib/orchestrator/cache')
    resetCache()

    const k1 = makeCacheKey('p1', 0, 0)
    const k2 = makeCacheKey('p2', 1, 0)
    const k3 = makeCacheKey('p3', 2, 0)

    cacheSet(k1, { ...okResult, confidence: 0.1 })
    cacheSet(k2, { ...okResult, confidence: 0.2 })
    cacheSet(k3, { ...okResult, confidence: 0.3 }) // evicts k1

    const stats = getCacheStats()
    expect(stats.evictions).toBe(1)
    expect(stats.size).toBe(2)
  })

  it('resets to zero after resetCache', async () => {
    const { cacheGet, cacheSet, makeCacheKey, getCacheStats, resetCache } =
      await import('@/lib/orchestrator/cache')
    resetCache()

    const k = makeCacheKey('any', 0, 0)
    cacheSet(k, okResult)
    cacheGet(k) // hit
    cacheGet(makeCacheKey('missing', 0, 0)) // miss

    expect(getCacheStats().hits).toBe(1)
    expect(getCacheStats().misses).toBe(1)

    resetCache()

    const fresh = getCacheStats()
    expect(fresh.hits).toBe(0)
    expect(fresh.misses).toBe(0)
    expect(fresh.evictions).toBe(0)
    expect(fresh.size).toBe(0)
  })
})
