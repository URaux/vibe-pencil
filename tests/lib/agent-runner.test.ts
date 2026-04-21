import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AgentRunner, resetAgentRunnerTestState } from '@/lib/agent-runner'

const { spawnMock, execFileSyncMock, existsSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
}))

vi.mock('child_process', () => {
  spawnMock.mockImplementation(() => {
    const { EventEmitter } = require('events')
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    }
    proc.kill = vi.fn()
    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from('Generated UserService successfully'))
      proc.emit('close', 0)
    }, 10)
    return proc
  })

  return {
    default: { spawn: spawnMock },
    execFileSync: execFileSyncMock,
    spawn: spawnMock,
  }
})

vi.mock('fs', () => ({
  default: { existsSync: existsSyncMock },
  existsSync: existsSyncMock,
}))

const originalPlatform = process.platform

function mockPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  })
}

describe('AgentRunner', () => {
  let runner: AgentRunner

  beforeEach(() => {
    spawnMock.mockClear()
    execFileSyncMock.mockReset()
    existsSyncMock.mockReset()
    resetAgentRunnerTestState()
    runner = new AgentRunner()
  })

  afterEach(() => {
    mockPlatform(originalPlatform)
  })

  it('spawns a claude-code agent and tracks status', async () => {
    const id = runner.spawnAgent('svc-1', 'generate code', 'claude-code', '/tmp')
    const child = spawnMock.mock.results[0]?.value
    const [command, args, options] = spawnMock.mock.calls[0] ?? []

    expect(runner.getStatus(id)?.status).toBe('running')
    expect(typeof command).toBe('string')
    expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose']))
    expect(options).toEqual(expect.objectContaining({
      cwd: '/tmp',
      stdio: ['pipe', 'pipe', 'pipe'],
    }))
    expect(child.stdin.write).toHaveBeenCalledWith('generate code')
    expect(child.stdin.end).toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(runner.getStatus(id)?.status).toBe('done')
    expect(runner.getStatus(id)?.output).toContain('Generated UserService')
  })

  it('spawns a codex agent with JSON output and prompt on stdin', () => {
    const expectedCommand = process.platform === 'win32' ? process.execPath : 'codex'
    const expectedArgs = process.platform === 'win32'
      ? ['E:/tools/npm-global/node_modules/@openai/codex/bin/codex.js', 'exec', '--full-auto', '--json', '-']
      : ['exec', '--full-auto', '--json', '-']

    if (process.platform === 'win32') {
      execFileSyncMock.mockReturnValue('E:/tools/npm-global/node_modules\n')
      existsSyncMock.mockReturnValue(true)
    }

    runner.spawnAgent('svc-2', 'implement backend', 'codex', '/tmp')
    const child = spawnMock.mock.results[0]?.value

    expect(spawnMock).toHaveBeenCalledWith(
      expectedCommand,
      expectedArgs,
      expect.objectContaining({
        cwd: '/tmp',
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    )
    expect(child.stdin.write).toHaveBeenCalledWith('implement backend')
    expect(child.stdin.end).toHaveBeenCalled()
  })

  it('spawns codex via node on Windows when the global script is resolved', () => {
    mockPlatform('win32')
    execFileSyncMock.mockReturnValue('E:/tools/npm-global/node_modules\n')
    existsSyncMock.mockReturnValue(true)

    runner.spawnAgent('svc-win', 'implement backend', 'codex', 'E:/repo')

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      ['E:/tools/npm-global/node_modules/@openai/codex/bin/codex.js', 'exec', '--full-auto', '--json', '-'],
      expect.objectContaining({
        cwd: 'E:/repo',
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    )
  })

  it('builds waves sequentially', async () => {
    const waves = [['db-1'], ['svc-1', 'svc-2'], ['gw-1']]
    const prompts = new Map([
      ['db-1', 'gen db'],
      ['svc-1', 'gen svc1'],
      ['svc-2', 'gen svc2'],
      ['gw-1', 'gen gw'],
    ])
    const statusUpdates: string[] = []

    runner.on('wave-start', (wave: number) => statusUpdates.push(`wave-${wave}`))

    await runner.buildAll(waves, prompts, 'claude-code', '/tmp', 2)

    const wave0Idx = statusUpdates.indexOf('wave-0')
    const wave1Idx = statusUpdates.indexOf('wave-1')

    expect(wave0Idx).toBeLessThan(wave1Idx)
  })

  it('stops a running agent', () => {
    const id = runner.spawnAgent('svc-1', 'generate code', 'claude-code', '/tmp')

    runner.stopAgent(id)

    expect(runner.getStatus(id)?.status).toBe('error')
  })
})
