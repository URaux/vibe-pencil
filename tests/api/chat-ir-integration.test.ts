import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ir } from '@/lib/ir'
import { IR_VERSION } from '@/lib/ir'

const fixedMetadata = {
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
  archviberVersion: '0.1.0',
}

const sampleIr: Ir = {
  version: IR_VERSION,
  project: { name: 'IRProject', metadata: fixedMetadata },
  containers: [{ id: 'c1', name: 'Services', color: 'blue' }],
  blocks: [
    {
      id: 'b1',
      name: 'Gateway',
      description: 'API Gateway',
      status: 'idle',
      container_id: 'c1',
      code_anchors: [],
    },
  ],
  edges: [],
  audit_log: [],
  seed_state: {},
}

// Hoist mocks before any imports
const { agentRunnerMock, streamChatMock, readIrFileMock } = vi.hoisted(() => ({
  agentRunnerMock: {
    spawnAgent: vi.fn(),
    getStatus: vi.fn(),
    stopAgent: vi.fn(),
  },
  streamChatMock: vi.fn(),
  readIrFileMock: vi.fn(),
}))

vi.mock('@/lib/agent-runner-instance', () => ({
  agentRunner: agentRunnerMock,
}))

vi.mock('@/lib/llm-client', () => ({
  streamChat: streamChatMock,
}))

vi.mock('@/lib/ir/persist', () => ({
  readIrFile: readIrFileMock,
}))

import { POST } from '@/app/api/chat/route'

function buildRequest(payload: Record<string, unknown>) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

describe('POST /api/chat — IR integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('VIBE_LLM_API_BASE', 'https://direct.example.com')
    vi.stubEnv('VIBE_LLM_API_KEY', 'test-key')
    vi.stubEnv('VIBE_LLM_MODEL', 'test-model')
    // Disable orchestrator path so this test exercises the legacy IR-injection flow
    vi.stubEnv('ARCHVIBER_ORCHESTRATOR', '0')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('injects IR yaml into system context when ir.yaml exists on disk', async () => {
    readIrFileMock.mockResolvedValue(sampleIr)
    streamChatMock.mockImplementation(async function* () {
      yield 'ok'
    })

    await POST(
      buildRequest({
        message: 'What does the architecture look like?',
        architecture_yaml: 'in-memory: should-not-appear',
      })
    )

    expect(streamChatMock).toHaveBeenCalledTimes(1)
    const systemArg = streamChatMock.mock.calls[0]?.[0] as string
    expect(systemArg).toContain('IRProject')
    expect(systemArg).toContain('Gateway')
    expect(systemArg).not.toContain('should-not-appear')
  })

  it('falls back to in-memory canvasYaml when ir.yaml does not exist', async () => {
    readIrFileMock.mockResolvedValue(null)
    streamChatMock.mockImplementation(async function* () {
      yield 'ok'
    })

    await POST(
      buildRequest({
        message: 'Tell me about the system',
        architecture_yaml: 'in-memory-content: present',
      })
    )

    const systemArg = streamChatMock.mock.calls[0]?.[0] as string
    expect(systemArg).toContain('in-memory-content')
  })

  it('falls back silently when readIrFile throws', async () => {
    readIrFileMock.mockRejectedValue(new Error('disk error'))
    streamChatMock.mockImplementation(async function* () {
      yield 'ok'
    })

    await expect(
      POST(
        buildRequest({
          message: 'Hello',
          architecture_yaml: 'fallback-yaml: true',
        })
      )
    ).resolves.toBeDefined()

    const systemArg = streamChatMock.mock.calls[0]?.[0] as string
    expect(systemArg).toContain('fallback-yaml')
  })
})
