/** Token-bucket per-IP rate limiter. In-memory, no persistence. */

interface Bucket {
  tokens: number
  lastRefill: number
}

const buckets = new Map<string, Bucket>()

function getRpm(): number {
  const raw = process.env.ARCHVIBER_RATE_LIMIT_RPM
  if (raw === undefined) return 60
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60
}

function extractIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0].trim()
    if (first) return first
  }
  return 'unknown'
}

function refill(bucket: Bucket, rpm: number, now: number): void {
  const elapsedMs = now - bucket.lastRefill
  const refillAmount = (elapsedMs / 60_000) * rpm
  bucket.tokens = Math.min(rpm, bucket.tokens + refillAmount)
  bucket.lastRefill = now
}

/**
 * Check rate limit for the incoming request.
 * Returns a 429 Response when the limit is exceeded, otherwise null.
 *
 * Env ARCHVIBER_RATE_LIMIT_RPM=0 disables rate limiting entirely.
 */
export function checkRateLimit(request: Request): Response | null {
  const rpm = getRpm()
  if (rpm === 0) return null

  const ip = extractIp(request)
  const now = Date.now()

  let bucket = buckets.get(ip)
  if (!bucket) {
    bucket = { tokens: rpm, lastRefill: now }
    buckets.set(ip, bucket)
  } else {
    refill(bucket, rpm, now)
  }

  if (bucket.tokens < 1) {
    const retryAfterSec = Math.ceil((1 - bucket.tokens) / (rpm / 60))
    return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSec),
      },
    })
  }

  bucket.tokens -= 1
  return null
}
