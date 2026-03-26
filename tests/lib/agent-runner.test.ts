import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentRunner } from '@/lib/agent-runner'

vi.mock('child_process', () => {
  const spawn = vi.fn(() => {
    const { EventEmitter } = require('events')
    const proc = new EventEmitter()
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from('Generated UserService successfully'))
      proc.emit('close', 0)
    }, 10)
    return proc
  })

  return {
    default: { spawn },
    spawn,
  }
})

describe('AgentRunner', () => {
  let runner: AgentRunner

  beforeEach(() => {
    runner = new AgentRunner()
  })

  it('spawns a claude-code agent and tracks status', async () => {
    const id = runner.spawnAgent('svc-1', 'generate code', 'claude-code', '/tmp')

    expect(runner.getStatus(id)?.status).toBe('running')

    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(runner.getStatus(id)?.status).toBe('done')
    expect(runner.getStatus(id)?.output).toContain('Generated UserService')
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

    await runner.buildAll(waves, prompts, 'claude-code', '/tmp')

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
