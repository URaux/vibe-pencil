import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentRunner } from '@/lib/agent-runner'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
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
    spawn: spawnMock,
  }
})

describe('AgentRunner', () => {
  let runner: AgentRunner

  beforeEach(() => {
    spawnMock.mockClear()
    runner = new AgentRunner()
  })

  it('spawns a claude-code agent and tracks status', async () => {
    const id = runner.spawnAgent('svc-1', 'generate code', 'claude-code', '/tmp')
    const child = spawnMock.mock.results[0]?.value

    expect(runner.getStatus(id)?.status).toBe('running')
    expect(spawnMock).toHaveBeenCalledWith(
      'claude',
      ['--output-format', 'stream-json'],
      expect.objectContaining({
        cwd: '/tmp',
        shell: process.platform === 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    )
    expect(child.stdin.write).toHaveBeenCalledWith('generate code')
    expect(child.stdin.end).toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(runner.getStatus(id)?.status).toBe('done')
    expect(runner.getStatus(id)?.output).toContain('Generated UserService')
  })

  it('spawns a codex agent and pipes the prompt through stdin', () => {
    runner.spawnAgent('svc-2', 'implement backend', 'codex', '/tmp')
    const child = spawnMock.mock.results[0]?.value

    expect(spawnMock).toHaveBeenCalledWith(
      'codex',
      ['--full-auto'],
      expect.objectContaining({
        cwd: '/tmp',
        shell: process.platform === 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    )
    expect(child.stdin.write).toHaveBeenCalledWith('implement backend')
    expect(child.stdin.end).toHaveBeenCalled()
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
