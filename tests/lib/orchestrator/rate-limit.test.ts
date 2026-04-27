import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// We need to isolate the module between tests so the in-memory bucket map is fresh.
// Use vi.resetModules() + dynamic import per-test.

function makeRequest(opts: { ip?: string; forwardedFor?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (opts.forwardedFor !== undefined) {
    headers['x-forwarded-for'] = opts.forwardedFor
  }
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers,
  })
}

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.ARCHVIBER_RATE_LIMIT_RPM
  })

  afterEach(() => {
    delete process.env.ARCHVIBER_RATE_LIMIT_RPM
  })

  it('allows requests under the limit', async () => {
    process.env.ARCHVIBER_RATE_LIMIT_RPM = '5'
    const { checkRateLimit } = await import('../../../src/lib/orchestrator/rate-limit')

    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(makeRequest({ forwardedFor: '1.2.3.4' }))).toBeNull()
    }
  })

  it('denies requests over the limit with 429 and Retry-After header', async () => {
    process.env.ARCHVIBER_RATE_LIMIT_RPM = '3'
    const { checkRateLimit } = await import('../../../src/lib/orchestrator/rate-limit')

    const req = () => makeRequest({ forwardedFor: '10.0.0.1' })
    checkRateLimit(req())
    checkRateLimit(req())
    checkRateLimit(req())
    // 4th request exceeds limit
    const response = checkRateLimit(req())
    expect(response).not.toBeNull()
    expect(response!.status).toBe(429)
    expect(response!.headers.get('Retry-After')).toBeTruthy()
  })

  it('refills bucket tokens over time allowing subsequent requests', async () => {
    process.env.ARCHVIBER_RATE_LIMIT_RPM = '60'
    const { checkRateLimit } = await import('../../../src/lib/orchestrator/rate-limit')

    const req = () => makeRequest({ forwardedFor: '5.5.5.5' })

    // Exhaust 60 tokens
    for (let i = 0; i < 60; i++) checkRateLimit(req())

    // 61st should be denied
    expect(checkRateLimit(req())).not.toBeNull()

    // Simulate 1 minute passing by manipulating Date.now
    const origNow = Date.now
    Date.now = () => origNow() + 60_000
    try {
      // After 1 minute, bucket should be refilled
      expect(checkRateLimit(req())).toBeNull()
    } finally {
      Date.now = origNow
    }
  })

  it('disables rate limiting when ARCHVIBER_RATE_LIMIT_RPM=0', async () => {
    process.env.ARCHVIBER_RATE_LIMIT_RPM = '0'
    const { checkRateLimit } = await import('../../../src/lib/orchestrator/rate-limit')

    const req = () => makeRequest({ forwardedFor: '9.9.9.9' })
    // Any number of requests should be allowed
    for (let i = 0; i < 1000; i++) {
      expect(checkRateLimit(req())).toBeNull()
    }
  })

  it('429 response includes Retry-After header', async () => {
    process.env.ARCHVIBER_RATE_LIMIT_RPM = '1'
    const { checkRateLimit } = await import('../../../src/lib/orchestrator/rate-limit')

    const req = () => makeRequest({ forwardedFor: '7.7.7.7' })
    checkRateLimit(req()) // consume the 1 token
    const response = checkRateLimit(req())
    expect(response).not.toBeNull()
    expect(response!.status).toBe(429)
    const retryAfter = response!.headers.get('Retry-After')
    expect(retryAfter).toBeTruthy()
    expect(parseInt(retryAfter!, 10)).toBeGreaterThan(0)
  })

  it('X-Forwarded-For takes priority over remote-ip for bucket keying', async () => {
    process.env.ARCHVIBER_RATE_LIMIT_RPM = '1'
    const { checkRateLimit } = await import('../../../src/lib/orchestrator/rate-limit')

    // First request uses forwarded IP 2.2.2.2 — consumes its token
    const withForwarded = makeRequest({ forwardedFor: '2.2.2.2' })
    checkRateLimit(withForwarded)

    // Second request same forwarded IP is denied
    const denied = checkRateLimit(makeRequest({ forwardedFor: '2.2.2.2' }))
    expect(denied).not.toBeNull()
    expect(denied!.status).toBe(429)

    // Different forwarded IP has a fresh bucket
    const differentIp = checkRateLimit(makeRequest({ forwardedFor: '3.3.3.3' }))
    expect(differentIp).toBeNull()
  })
})
