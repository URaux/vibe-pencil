import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { agentRunnerMock, streamChatMock } = vi.hoisted(() => ({
  agentRunnerMock: {
    spawnAgent: vi.fn(),
    getStatus: vi.fn(),
    stopAgent: vi.fn(),
  },
  streamChatMock: vi.fn(),
}))

vi.mock('@/lib/agent-runner-instance', () => ({
  agentRunner: agentRunnerMock,
}))

vi.mock('@/lib/llm-client', () => ({
  streamChat: streamChatMock,
}))

// Prevent real fs.readFile calls from blocking timer-driven tests.
vi.mock('@/lib/ir/persist', () => ({
  readIrFile: vi.fn().mockResolvedValue(null),
}))

import { POST } from '@/app/api/chat/route'

function buildRequest(payload: Record<string, unknown>) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

function decodeSseEvents(text: string) {
  return text
    .trim()
    .split('\n\n')
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)))
    )
    .flat()
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('uses the brainstorm prompt and codex one-shot spawn path', async () => {
    vi.useFakeTimers()

    const agentId = 'chat-123'
    agentRunnerMock.spawnAgent.mockReturnValue(agentId)
    agentRunnerMock.getStatus.mockReturnValue({
      agentId,
      nodeId: 'chat',
      prompt: '',
      backend: 'codex',
      workDir: process.cwd(),
      status: 'done',
      output: 'Brainstorm answer',
    })

    const responsePromise = POST(
      buildRequest({
        message: 'How should we structure the chat flow?',
        architecture_yaml: 'nodes: []',
        backend: 'codex',
        phase: 'brainstorm',
        model: 'codex-mini',
        ccSessionId: '00000000-0000-0000-0000-000000000000',
      })
    )

    await vi.advanceTimersByTimeAsync(500)
    const response = await responsePromise

    expect(agentRunnerMock.spawnAgent).toHaveBeenCalledTimes(1)
    // Codex CLI eats the prompt as stdin and competes with its own persona,
    // so it gets the compact task-framed variant rather than the long
    // protocol doc. "This Round" is the compact variant's canonical header.
    expect(agentRunnerMock.spawnAgent).toHaveBeenCalledWith(
      'chat',
      expect.stringContaining('## This Round'),
      'codex',
      process.cwd(),
      'codex-mini',
      undefined,
      '00000000-0000-0000-0000-000000000000'
    )

    const prompt = agentRunnerMock.spawnAgent.mock.calls[0]?.[1] as string
    expect(prompt).toContain('Latest user message:')
    expect(prompt).toContain('How should we structure the chat flow?')
    expect(prompt).toContain('# Task')

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ccSessionId).toBeNull()
    expect(body.content.trim()).toBe('Brainstorm answer')
  })

  it('rejects custom-api requests that are missing base or key', async () => {
    const response = await POST(
      buildRequest({
        message: 'Hello',
        architecture_yaml: 'nodes: []',
        backend: 'custom-api',
        customApiBase: 'https://api.example.com',
      })
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body).toEqual({
      error: 'Custom API base URL and key are required.',
    })
    expect(agentRunnerMock.spawnAgent).not.toHaveBeenCalled()
  })

  it('streams direct API SSE chunks and done events when env vars are set', async () => {
    vi.stubEnv('VIBE_LLM_API_BASE', 'https://direct.example.com')
    vi.stubEnv('VIBE_LLM_API_KEY', 'direct-key')
    vi.stubEnv('VIBE_LLM_MODEL', 'direct-model')

    streamChatMock.mockImplementation(async function* () {
      yield 'hello'
      yield ' world'
    })

    const response = await POST(
      buildRequest({
        message: 'Tell me about the architecture',
        architecture_yaml: 'nodes: []',
        backend: 'codex',
        phase: 'brainstorm',
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(streamChatMock).toHaveBeenCalledTimes(1)
    expect(streamChatMock).toHaveBeenCalledWith(
      expect.stringContaining('Brainstorm Phase (v2 Protocol)'),
      [{ role: 'user', content: 'Tell me about the architecture' }],
      {
        apiBase: 'https://direct.example.com',
        apiKey: 'direct-key',
        model: 'direct-model',
      },
      expect.any(AbortSignal)
    )

    const text = await response.text()
    const events = decodeSseEvents(text)

    expect(events).toEqual([
      { type: 'chunk', text: 'hello' },
      { type: 'chunk', text: ' world' },
      { type: 'done' },
    ])
  })
})

