import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import type { Writable } from 'stream'
import { StringDecoder } from 'string_decoder'
import { clampMaxParallel } from '@/lib/config'
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
  stdin?: Writable | null
  stdout?: EventEmitter | null
  stderr?: EventEmitter | null
  kill: () => void
  once: EventEmitter['once']
}

interface AgentRecord {
  info: AgentProcessInfo
  process: SpawnedProcess
}

function getGeminiWindowsScriptPath() {
  const localGeminiScript = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    'node_modules',
    '@google',
    'gemini-cli',
    'dist',
    'index.js'
  )

  if (fs.existsSync(localGeminiScript)) {
    return localGeminiScript
  }

  const npmGlobal = process.env.NPM_GLOBAL_PATH ?? 'E:/tools/npm-global'
  return path.join(
    /* turbopackIgnore: true */ npmGlobal,
    'node_modules',
    '@google',
    'gemini-cli',
    'dist',
    'index.js'
  )
}

function getCommand(backend: AgentBackend, prompt: string, model?: string) {
  if (backend === 'codex') {
    const args = ['exec', '--full-auto', '--json', '-']
    if (model) args.push('--model', model)
    return { command: 'codex', args, pipeStdin: true, useShell: undefined }
  }

  if (backend === 'gemini') {
    const targetModel = model || 'gemini-3-flash-preview'

    if (process.platform === 'win32') {
      const geminiScript = getGeminiWindowsScriptPath()
      const args = ['--no-warnings=DEP0040', geminiScript, '-p', prompt, '-m', targetModel]
      return { command: process.execPath, args, pipeStdin: false, useShell: false }
    }

    return {
      command: 'gemini',
      args: ['-p', prompt, '-m', targetModel],
      pipeStdin: false,
      useShell: undefined,
    }
  }

  const args = ['-p', '--output-format', 'stream-json', '--verbose']
  if (model) args.push('--model', model)
  return { command: 'claude', args, pipeStdin: true, useShell: undefined }
}

export class AgentRunner extends EventEmitter {
  private readonly agents = new Map<string, AgentRecord>()

  private nextId = 0

  constructor() {
    super()
    this.on('error', () => undefined)
  }

  spawnAgent(nodeId: string, prompt: string, backend: AgentBackend, workDir: string, model?: string) {
    const agentId = `${nodeId}-${Date.now()}-${this.nextId++}`
    const { command, args, pipeStdin, useShell } = getCommand(backend, prompt, model)
    const env = { ...process.env }

    delete env.ANTHROPIC_API_KEY
    delete env.GEMINI_API_KEY

    // Relay fallback: if USE_RELAY is set, pass relay credentials to spawned agents
    if (process.env.USE_RELAY === 'true' && process.env.RELAY_API_BASE_URL) {
      if (backend === 'claude-code') {
        env.ANTHROPIC_BASE_URL = process.env.RELAY_API_BASE_URL
        env.ANTHROPIC_API_KEY = process.env.RELAY_API_KEY ?? ''
      }
      // Note: codex and gemini backends don't support Anthropic relay
    }

    const child = spawn(command, args, {
      cwd: workDir,
      env,
      shell: useShell ?? (process.platform === 'win32'),
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as SpawnedProcess

    if (pipeStdin) {
      child.stdin?.write(prompt)
    }
    child.stdin?.end()

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

    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk)
      info.output += text
      this.emit('output', { agentId, nodeId, text })
    })

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk)
      info.errorMessage = (info.errorMessage ?? '') + text
    })

    child.once('error', (error) => {
      this.finishAgent(agentId, 'error', null, error.message)
    })

    child.once('close', (code) => {
      const stdoutRemainder = stdoutDecoder.end()
      const stderrRemainder = stderrDecoder.end()

      if (stdoutRemainder) {
        info.output += stdoutRemainder
        this.emit('output', { agentId, nodeId, text: stdoutRemainder })
      }

      if (stderrRemainder) {
        info.errorMessage = (info.errorMessage ?? '') + stderrRemainder
      }

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
    workDir: string,
    maxParallel: number,
    model?: string
  ) {
    // Concurrency model:
    // - Nodes in the same wave have no mutual dependencies (topo sort guarantees this)
    // - maxParallel limits total concurrent agents
    // - Future: check techStack conflicts for finer-grained parallelism
    //   (inspired by CC's isConcurrencySafe(input) per-tool pattern — nodes writing
    //   to the same directory should serialize; nodes with distinct techStacks can run freely)
    const concurrency = clampMaxParallel(maxParallel)

    for (const [waveIndex, wave] of waves.entries()) {
      this.emit('wave-start', waveIndex)
      this.emit('wave', { wave: waveIndex })

      for (let index = 0; index < wave.length; index += concurrency) {
        const batch = wave.slice(index, index + concurrency)
        const agentIds = batch.map((nodeId) =>
          this.spawnAgent(nodeId, prompts.get(nodeId) ?? '', backend, workDir, model)
        )

        await Promise.all(agentIds.map((agentId) => this.waitForAgent(agentId)))
      }
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
