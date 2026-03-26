import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import type { ProjectConfig } from '@/lib/types'

export type AgentBackend = ProjectConfig['agent']
export type AgentStatus = 'running' | 'done' | 'error'

export interface AgentProcessInfo {
  agentId: string
  nodeId: string
  prompt: string
  backend: AgentBackend
  workDir: string
  status: AgentStatus
  output: string
  errorMessage?: string
  exitCode?: number | null
}

interface SpawnedProcess {
  stdout?: EventEmitter | null
  stderr?: EventEmitter | null
  kill: () => void
  once: EventEmitter['once']
}

interface AgentRecord {
  info: AgentProcessInfo
  process: SpawnedProcess
}

function getCommand(backend: AgentBackend) {
  if (backend === 'codex') {
    return {
      command: 'codex',
      args: ['-q', '%PROMPT%', '--full-auto'],
    }
  }

  return {
    command: 'claude',
    args: ['-p', '%PROMPT%', '--output-format', 'stream-json'],
  }
}

export class AgentRunner extends EventEmitter {
  private readonly agents = new Map<string, AgentRecord>()

  private nextId = 0

  constructor() {
    super()
    this.on('error', () => undefined)
  }

  spawnAgent(nodeId: string, prompt: string, backend: AgentBackend, workDir: string) {
    const agentId = `${nodeId}-${Date.now()}-${this.nextId++}`
    const { command, args } = getCommand(backend)
    const resolvedArgs = args.map((arg) => (arg === '%PROMPT%' ? prompt : arg))
    const child = spawn(command, resolvedArgs, {
      cwd: workDir,
      shell: process.platform === 'win32',
    }) as SpawnedProcess

    const info: AgentProcessInfo = {
      agentId,
      nodeId,
      prompt,
      backend,
      workDir,
      status: 'running',
      output: '',
    }

    this.agents.set(agentId, { info, process: child })
    this.emit('status', { agentId, nodeId, status: 'running' satisfies AgentStatus })

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString()
      info.output += text
      this.emit('output', { agentId, nodeId, text })
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString()
      info.output += text
      info.errorMessage = text
      this.emit('output', { agentId, nodeId, text })
    })

    child.once('error', (error) => {
      this.finishAgent(agentId, 'error', null, error.message)
    })

    child.once('close', (code) => {
      if (info.status === 'error' && info.exitCode === null) {
        return
      }

      if (code === 0) {
        this.finishAgent(agentId, 'done', code)
        return
      }

      this.finishAgent(agentId, 'error', code, info.errorMessage ?? `Exited with code ${code}`)
    })

    return agentId
  }

  getStatus(agentId: string) {
    const record = this.agents.get(agentId)

    if (!record) {
      return null
    }

    return { ...record.info }
  }

  stopAgent(agentId: string) {
    const record = this.agents.get(agentId)

    if (!record) {
      return
    }

    record.process.kill()
    this.finishAgent(agentId, 'error', null, 'Stopped by user')
  }

  async buildAll(
    waves: string[][],
    prompts: Map<string, string>,
    backend: AgentBackend,
    workDir: string
  ) {
    for (const [waveIndex, wave] of waves.entries()) {
      this.emit('wave-start', waveIndex)
      this.emit('wave', { wave: waveIndex })

      const agentIds = wave.map((nodeId) =>
        this.spawnAgent(nodeId, prompts.get(nodeId) ?? '', backend, workDir)
      )

      await Promise.all(agentIds.map((agentId) => this.waitForAgent(agentId)))
    }
  }

  private finishAgent(
    agentId: string,
    status: AgentStatus,
    exitCode: number | null,
    errorMessage?: string
  ) {
    const record = this.agents.get(agentId)

    if (!record || record.info.status === 'done') {
      return
    }

    record.info.status = status
    record.info.exitCode = exitCode

    if (errorMessage) {
      record.info.errorMessage = errorMessage
    }

    this.emit('status', { agentId, nodeId: record.info.nodeId, status })

    if (status === 'done') {
      this.emit('done', { agentId, nodeId: record.info.nodeId, output: record.info.output })
      return
    }

    this.emit('error', {
      agentId,
      nodeId: record.info.nodeId,
      error: record.info.errorMessage ?? 'Agent failed',
    })
  }

  private waitForAgent(agentId: string) {
    const record = this.agents.get(agentId)

    if (!record) {
      return Promise.reject(new Error(`Unknown agent: ${agentId}`))
    }

    if (record.info.status === 'done') {
      return Promise.resolve(record.info)
    }

    if (record.info.status === 'error') {
      return Promise.reject(new Error(record.info.errorMessage ?? `Agent ${agentId} failed`))
    }

    return new Promise<AgentProcessInfo>((resolve, reject) => {
      const handleStatus = (event: { agentId: string; status: AgentStatus }) => {
        if (event.agentId !== agentId) {
          return
        }

        this.off('status', handleStatus)
        const current = this.getStatus(agentId)

        if (!current) {
          reject(new Error(`Unknown agent: ${agentId}`))
          return
        }

        if (event.status === 'done') {
          resolve(current)
          return
        }

        reject(new Error(current.errorMessage ?? `Agent ${agentId} failed`))
      }

      this.on('status', handleStatus)
    })
  }
}
