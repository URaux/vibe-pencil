import crypto from 'node:crypto'
import type { ClassifyResult } from './types'

const DEFAULT_CACHE_SIZE = 200

function cacheSize(): number {
  const raw = process.env.ARCHVIBER_CLASSIFY_CACHE_SIZE
  if (raw === undefined) return DEFAULT_CACHE_SIZE
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CACHE_SIZE
}

export function makeCacheKey(userPrompt: string, blockCount: number, containerCount: number): string {
  return crypto
    .createHash('sha1')
    .update(`${userPrompt}|${blockCount}|${containerCount}`)
    .digest('hex')
}

class LRUCache<V> {
  private readonly max: number
  private readonly map = new Map<string, V>()

  constructor(max: number) {
    this.max = max
  }

  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined
    // Move to end (most recently used)
    const val = this.map.get(key) as V
    this.map.delete(key)
    this.map.set(key, val)
    return val
  }

  set(key: string, value: V): void {
    if (this.max === 0) return
    if (this.map.has(key)) this.map.delete(key)
    else if (this.map.size >= this.max) {
      // Evict least recently used (first entry)
      this.map.delete(this.map.keys().next().value as string)
    }
    this.map.set(key, value)
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  get size(): number {
    return this.map.size
  }
}

export interface CacheStats {
  hits: number
  misses: number
  evictions: number
  size: number
}

let _cache: LRUCache<ClassifyResult> | null = null
let _hits = 0
let _misses = 0
let _evictions = 0

function getCache(): LRUCache<ClassifyResult> {
  if (!_cache) _cache = new LRUCache<ClassifyResult>(cacheSize())
  return _cache
}

/** Exposed for tests to reset the singleton. */
export function resetCache(): void {
  _cache = null
  _hits = 0
  _misses = 0
  _evictions = 0
}

export function cacheGet(key: string): ClassifyResult | undefined {
  if (cacheSize() === 0) return undefined
  const val = getCache().get(key)
  if (val !== undefined) {
    _hits++
  } else {
    _misses++
  }
  return val
}

export function cacheSet(key: string, result: ClassifyResult): void {
  if (cacheSize() === 0) return
  const cache = getCache()
  const hadKey = cache.has(key)
  const wasAtCapacity = !hadKey && cache.size >= (cacheSize())
  if (wasAtCapacity) _evictions++
  cache.set(key, result)
}

export function getCacheSize(): number {
  return _cache?.size ?? 0
}

export function getCacheStats(): CacheStats {
  return {
    hits: _hits,
    misses: _misses,
    evictions: _evictions,
    size: _cache?.size ?? 0,
  }
}
