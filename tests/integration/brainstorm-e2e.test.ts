/**
 * End-to-end integration test for brainstorm state round-trip.
 *
 * This is the test that WOULD HAVE CAUGHT the B1 bug (client never sending
 * `sessionId` → server silently skipping persistence). It exercises:
 *
 *   1. sessionId present + phase=brainstorm → state file is written to
 *      `.archviber/brainstorm-state/<sessionId>.json` after the assistant turn.
 *   2. Follow-up turn with the same sessionId → previously-persisted state is
 *      re-read and `formatStateForPrompt` produces a non-empty prefix that
 *      contains the remembered decisions.
 *   3. sessionId missing → server does NOT write any state file (silent skip,
 *      no error thrown).
 *   4. Path-traversal-ish sessionIds → rejected by the state module's
 *      sanitizer. We document the current contract: the route handler catches
 *      the throw in `loadOrInitBrainstormState`, logs, and treats the turn as
 *      if brainstorm-state were disabled (so chat still works, no file written).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  brainstormStateFilePath,
  createInitialBrainstormState,
  formatStateForPrompt,
  readBrainstormState,
  writeBrainstormState,
  applyAssistantControl,
  parseAssistantControlComments,
} from '@/lib/brainstorm/state'

/* --------------------------------------------------------------- mocks --- */

const { streamChatMock } = vi.hoisted(() => ({
  streamChatMock: vi.fn(),
}))

vi.mock('@/lib/llm-client', () => ({
  streamChat: streamChatMock,
}))

// Keep the IR load path from touching real disk.
vi.mock('@/lib/ir/persist', () => ({
  readIrFile: vi.fn().mockResolvedValue(null),
}))

// Prevent the agent runner from being needed at all — direct API path only.
vi.mock('@/lib/agent-runner-instance', () => ({
  agentRunner: {
    spawnAgent: vi.fn(),
    getStatus: vi.fn(),
    stopAgent: vi.fn(),
  },
}))

import { POST } from '@/app/api/chat/route'

/* --------------------------------------------------------- test harness --- */

let tmpDir: string
let originalCwd: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviber-brainstorm-e2e-'))
  originalCwd = process.cwd()
  process.chdir(tmpDir)

  // Direct-HTTP streaming path so the route reaches
  // `persistBrainstormStateFromResponse` via a predictable codepath.
  vi.stubEnv('VIBE_LLM_API_BASE', 'https://direct.example.com')
  vi.stubEnv('VIBE_LLM_API_KEY', 'direct-key')
  vi.stubEnv('VIBE_LLM_MODEL', 'direct-model')

  vi.clearAllMocks()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  process.chdir(originalCwd)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function buildRequest(payload: Record<string, unknown>) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function drainResponse(response: Response): Promise<void> {
  // The state persistence fires inside the SSE stream generator — we must
  // fully drain the body so the `start()` coroutine reaches
  // `await persistBrainstormStateFromResponse(...)` before we assert on disk.
  const reader = response.body?.getReader()
  if (!reader) return
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

/**
 * Streamed assistant response with the full set of brainstorm control
 * comments the server is supposed to extract and persist.
 */
const ASSISTANT_RESPONSE_WITH_CONTROL = [
  'Here is my thinking about your architecture.',
  '<!-- progress: batch=how round=2 mode=novice -->',
  '<!-- decisions: {"domain":"e-commerce","scale":"SMB","features":["cart","checkout"]} -->',
  '<!-- externalDeps: [{"op":"add","service":"stripe","type":"api_key","status":"needed","envVar":"STRIPE_SECRET_KEY","group":"A"}] -->',
  'Let me know if that sounds right.',
].join('\n')

function mockStreamChatReturning(text: string) {
  streamChatMock.mockImplementation(async function* () {
    // Yield in chunks to mirror real streaming.
    yield text.slice(0, Math.floor(text.length / 2))
    yield text.slice(Math.floor(text.length / 2))
  })
}

/* ========================================================================
 * 1. Route-level: sessionId + brainstorm → state persisted to .archviber/
 * ==================================================================== */

describe('brainstorm e2e — route persists state when sessionId is present', () => {
  it('writes .archviber/brainstorm-state/<sessionId>.json after the turn', async () => {
    mockStreamChatReturning(ASSISTANT_RESPONSE_WITH_CONTROL)
    const sessionId = 'e2e-session-001'

    const response = await POST(
      buildRequest({
        message: 'I want to build a small e-commerce site.',
        architecture_yaml: 'nodes: []',
        backend: 'codex',
        phase: 'brainstorm',
        sessionId,
      })
    )

    expect(response.status).toBe(200)
    await drainResponse(response)

    const expectedPath = brainstormStateFilePath(tmpDir, sessionId)
    // File must exist under the cwd's .archviber/brainstorm-state/.
    await expect(fs.access(expectedPath)).resolves.toBeUndefined()

    const persisted = await readBrainstormState(tmpDir, sessionId)
    expect(persisted).not.toBeNull()
    expect(persisted!.sessionId).toBe(sessionId)
    expect(persisted!.currentBatch).toBe('how')
    expect(persisted!.roundCount).toBe(2)
    expect(persisted!.mode).toBe('novice')
    expect(persisted!.decisions.domain).toBe('e-commerce')
    expect(persisted!.decisions.features).toEqual(['cart', 'checkout'])
    // externalDeps event should have been reduced into the snapshot.
    expect(persisted!.externalDeps).toHaveLength(1)
    expect(persisted!.externalDeps[0].service).toBe('stripe')
    expect(persisted!.externalDeps[0].status).toBe('needed')
  })

  /* ======================================================================
   * 2. Follow-up turn reads the prior state back and formats it for the LLM.
   * ================================================================== */
  it('re-reads prior state on the next turn and formatStateForPrompt produces a non-empty prefix', async () => {
    const sessionId = 'e2e-session-followup'

    // --- First turn persists state ---
    mockStreamChatReturning(ASSISTANT_RESPONSE_WITH_CONTROL)
    const firstRes = await POST(
      buildRequest({
        message: 'Turn 1',
        architecture_yaml: 'nodes: []',
        backend: 'codex',
        phase: 'brainstorm',
        sessionId,
      })
    )
    expect(firstRes.status).toBe(200)
    await drainResponse(firstRes)

    // --- Second turn should find it on disk and inject it into the prompt.
    // We inspect the `system` argument that the route passes to streamChat.
    streamChatMock.mockClear()
    streamChatMock.mockImplementation(async function* () {
      yield 'acknowledged'
    })

    const secondRes = await POST(
      buildRequest({
        message: 'Turn 2',
        architecture_yaml: 'nodes: []',
        backend: 'codex',
        phase: 'brainstorm',
        sessionId,
      })
    )
    expect(secondRes.status).toBe(200)
    await drainResponse(secondRes)

    expect(streamChatMock).toHaveBeenCalledTimes(1)
    const systemArg = streamChatMock.mock.calls[0]?.[0] as string
    expect(typeof systemArg).toBe('string')

    // Reload from disk and compute the expected prefix independently — then
    // verify the route actually prepended it.
    const persisted = await readBrainstormState(tmpDir, sessionId)
    expect(persisted).not.toBeNull()
    const expectedPrefix = formatStateForPrompt(persisted!)
    expect(expectedPrefix).not.toBe('')
    expect(expectedPrefix).toContain('本次 brainstorm 已知状态')
    expect(expectedPrefix).toContain('e-commerce')
    expect(expectedPrefix).toContain('stripe')
    // The system prompt must literally contain the formatted prefix.
    expect(systemArg).toContain(expectedPrefix)
  })
})

/* ========================================================================
 * 3. sessionId missing → no persistence, no error.
 * ==================================================================== */

describe('brainstorm e2e — missing sessionId skips persistence silently', () => {
  it('does not write any state file when sessionId is absent', async () => {
    mockStreamChatReturning(ASSISTANT_RESPONSE_WITH_CONTROL)

    const response = await POST(
      buildRequest({
        message: 'Talk to me, no session id set.',
        architecture_yaml: 'nodes: []',
        backend: 'codex',
        phase: 'brainstorm',
        // sessionId intentionally omitted
      })
    )
    expect(response.status).toBe(200)
    await drainResponse(response)

    // The state directory should not exist — the route skipped persistence.
    const stateDir = path.join(tmpDir, '.archviber', 'brainstorm-state')
    await expect(fs.access(stateDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('also skips when sessionId is an empty / whitespace-only string', async () => {
    mockStreamChatReturning(ASSISTANT_RESPONSE_WITH_CONTROL)

    const response = await POST(
      buildRequest({
        message: 'Still no valid session id.',
        architecture_yaml: 'nodes: []',
        backend: 'codex',
        phase: 'brainstorm',
        sessionId: '   ',
      })
    )
    expect(response.status).toBe(200)
    await drainResponse(response)

    const stateDir = path.join(tmpDir, '.archviber', 'brainstorm-state')
    await expect(fs.access(stateDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('also skips when phase is not "brainstorm", even with a sessionId', async () => {
    mockStreamChatReturning(ASSISTANT_RESPONSE_WITH_CONTROL)

    const response = await POST(
      buildRequest({
        message: 'Discussion turn.',
        architecture_yaml: 'nodes: []',
        backend: 'codex',
        phase: 'discussion',
        sessionId: 'valid-id-but-wrong-phase',
      })
    )
    expect(response.status).toBe(200)
    await drainResponse(response)

    const stateDir = path.join(tmpDir, '.archviber', 'brainstorm-state')
    await expect(fs.access(stateDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

/* ========================================================================
 * 4. Path-traversal / unsafe sessionIds → rejected by the sanitizer.
 *    Documented contract: the route swallows the throw and persists nothing.
 * ==================================================================== */

describe('brainstorm e2e — unsafe sessionIds are rejected / sanitized', () => {
  const unsafeIds = [
    '../foo',
    '..\\bar',
    'a/b',
    'a\\b',
    'has space',
    'semi;colon',
    '',
  ]

  it.each(unsafeIds)(
    'brainstormStateFilePath throws on unsafe sessionId: %p',
    (unsafe) => {
      expect(() => brainstormStateFilePath(tmpDir, unsafe)).toThrow(/Invalid sessionId/)
    }
  )

  it('route does NOT crash and does NOT persist when given a path-traversal sessionId', async () => {
    mockStreamChatReturning(ASSISTANT_RESPONSE_WITH_CONTROL)

    const response = await POST(
      buildRequest({
        message: 'Sneaky traversal attempt.',
        architecture_yaml: 'nodes: []',
        backend: 'codex',
        phase: 'brainstorm',
        sessionId: '../evil',
      })
    )

    // Route completes normally — brainstorm-state is treated as disabled.
    expect(response.status).toBe(200)
    await drainResponse(response)

    // Nothing should have been written outside (or inside) the tmp dir.
    const stateDir = path.join(tmpDir, '.archviber', 'brainstorm-state')
    await expect(fs.access(stateDir)).rejects.toMatchObject({ code: 'ENOENT' })

    // Make sure the sanitizer didn't let a traversal escape the tmp dir either.
    const parent = path.dirname(tmpDir)
    const evilPath = path.join(parent, 'evil.json')
    await expect(fs.access(evilPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('accepts safe uuid-ish sessionIds', () => {
    const safe = [
      'abc123',
      'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      'session_2026-04-15',
      'v1.2.3-rc',
    ]
    for (const id of safe) {
      expect(() => brainstormStateFilePath(tmpDir, id)).not.toThrow()
    }
  })
})

/* ========================================================================
 * 5. Module-level unit round-trip — validates the contract the route relies on.
 *    Complements the route tests: if this breaks, the route-level tests
 *    above will also break, but this one points at the state module directly.
 * ==================================================================== */

describe('brainstorm e2e — state module round-trip (write → read → format)', () => {
  it('round-trips a state containing decisions + externalDeps through disk and formatStateForPrompt', async () => {
    const sessionId = 'module-roundtrip'
    const initial = createInitialBrainstormState(sessionId)
    const control = parseAssistantControlComments(ASSISTANT_RESPONSE_WITH_CONTROL)
    const updated = applyAssistantControl(initial, control)

    await writeBrainstormState(tmpDir, updated)
    const reloaded = await readBrainstormState(tmpDir, sessionId)

    expect(reloaded).not.toBeNull()
    expect(reloaded!.decisions.domain).toBe('e-commerce')
    expect(reloaded!.externalDeps.some((d) => d.service === 'stripe')).toBe(true)

    const prefix = formatStateForPrompt(reloaded!)
    expect(prefix).not.toBe('')
    expect(prefix).toContain('e-commerce')
    expect(prefix).toContain('stripe')
    expect(prefix).toContain('第 2 轮')
  })
})
