import { randomUUID } from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { StringDecoder } from 'string_decoder'
import { getClaudeCliInvocation, getChildIsolationArgs, scrubChildEnv } from '@/lib/claude-cli'

interface PersistentAgentConfig {
  backend: 'claude-code' | 'codex' | 'gemini'
  workDir: string
  model?: string
  resumeSessionId?: string
}

interface StreamJsonEvent {
  type?: string
  subtype?: string
  session_id?: string
  is_error?: boolean
  errors?: unknown
  [key: string]: unknown
}

interface PendingTurn {
  resolve: () => void
  reject: (error: Error) => void
}

class PersistentAgent extends EventEmitter {
  private process: ChildProcess | null = null
  private stdoutDecoder = new StringDecoder('utf8')
  private stderrDecoder = new StringDecoder('utf8')
  private isReady = false
  private outputBuffer = ''
  private stderrTail = ''

  private stderrLogCount = 0
  private sessionId: string | null = null
  private completedTurns = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private activeTurn: PendingTurn | null = null
  private turnChain = Promise.resolve()

  constructor(private config: PersistentAgentConfig) {
    super()
    this.setMaxListeners(50)
  }

  async start(): Promise<void> {
    if (this.process) return

    if (this.config.backend !== 'claude-code') {
      throw new Error(`Persistent agent only supports claude-code, got ${this.config.backend}`)
    }

    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--replay-user-messages',
      ...getChildIsolationArgs(),
    ]
    if (this.config.resumeSessionId) args.push('--resume', this.config.resumeSessionId)
    if (this.config.model) args.push('--model', this.config.model)

    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    scrubChildEnv(env)
    this.stdoutDecoder = new StringDecoder('utf8')
    this.stderrDecoder = new StringDecoder('utf8')
    this.outputBuffer = ''
    this.stderrTail = ''

    if (process.env.USE_RELAY === 'true' && process.env.RELAY_API_BASE_URL) {
      env.ANTHROPIC_BASE_URL = process.env.RELAY_API_BASE_URL
      env.ANTHROPIC_API_KEY = process.env.RELAY_API_KEY ?? ''
    }

    const { command, args: spawnArgs, useShell } = getClaudeCliInvocation(args, this.config.workDir)

    this.process = spawn(command, spawnArgs, {
      cwd: this.config.workDir,
      env,
      shell: useShell ?? (process.platform === 'win32'),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    console.log('[persistent-agent] spawned pid', this.process.pid, 'cwd', this.config.workDir)

    let firstStdoutAt = 0
    this.process.stdout?.on('data', (data: Buffer | string) => {
      const text = typeof data === 'string' ? data : this.stdoutDecoder.write(data)
      if (firstStdoutAt === 0) {
        firstStdoutAt = Date.now()
        console.log('[persistent-agent]', this.process?.pid, 'first-stdout', JSON.stringify(text.slice(0, 200)))
      }
      this.outputBuffer += text
      this.processBuffer()
    })

    this.process.stderr?.on('data', (data: Buffer | string) => {
      const text = typeof data === 'string' ? data : this.stderrDecoder.write(data)
      // Surface CC child stderr live — without this, a silent process hang is
      // invisible and we can only see "[chat] phase" with no follow-up logs.
      // Throttle to the first 4 chunks so a storm doesn't flood the server log.
      // Use process.stderr.write with explicit UTF-8 encoding rather than
      // console.warn — on Windows the default console codepage (GBK/cp936)
      // will re-encode the already-decoded UTF-8 string and produce mojibake
      // for any Chinese characters (e.g. "上下文太长" → "������̫����").
      if (!this.stderrLogCount) this.stderrLogCount = 0
      if (this.stderrLogCount < 4) {
        this.stderrLogCount++
        const pid = this.process?.pid
        const snippet = JSON.stringify(text.slice(0, 500))
        process.stderr.write(Buffer.from(`[persistent-agent] ${pid} stderr ${snippet}\n`, 'utf8'))
      }
      this.stderrTail = (this.stderrTail + text).slice(-16_384)
    })

    this.process.once('error', (error) => {
      this.rejectActiveTurn(error instanceof Error ? error : new Error(String(error)))
      this.resetProcessState()
    })

    this.process.once('close', (code) => {
      const stdoutRemainder = this.stdoutDecoder.end()
      const stderrRemainder = this.stderrDecoder.end()

      if (stdoutRemainder) {
        this.outputBuffer += stdoutRemainder
        this.processBuffer()
      }
      if (stderrRemainder) {
        this.stderrTail = (this.stderrTail + stderrRemainder).slice(-16_384)
      }

      if (this.activeTurn) {
        const stderrSnippet = this.stderrTail.trim()
        const detail = stderrSnippet ? `: ${stderrSnippet.slice(-500)}` : ''
        this.rejectActiveTurn(new Error(`Persistent Claude process exited with code ${code ?? 'unknown'}${detail}`))
      }

      this.resetProcessState()
    })

    await new Promise<void>((resolve, reject) => {
      const child = this.process
      if (!child) {
        reject(new Error('Failed to create persistent Claude process'))
        return
      }

      const onSpawn = () => {
        cleanup()
        this.isReady = true
        this.resetIdleTimer()
        resolve()
      }

      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }

      const cleanup = () => {
        child.off('spawn', onSpawn)
        child.off('error', onError)
      }

      child.once('spawn', onSpawn)
      child.once('error', onError)
    })
  }

  private processBuffer() {
    const lines = this.outputBuffer.split('\n')
    this.outputBuffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const event = JSON.parse(trimmed) as StreamJsonEvent
        if (typeof event.session_id === 'string' && !this.sessionId) {
          this.sessionId = event.session_id
        }

        this.emit('event', event)

        if (event.type === 'result') {
          if (event.is_error) {
            const errors = Array.isArray(event.errors)
              ? event.errors.map((entry) => String(entry)).join('\n')
              : ''
            this.rejectActiveTurn(
              new Error(errors || `Claude Code turn failed (${event.subtype ?? 'error'})`)
            )
            continue
          }

          this.completedTurns += 1
          this.resolveActiveTurn()
          this.emit('response-done', event)
        }
      } catch {
        // Ignore non-JSON diagnostic lines.
      }
    }
  }

  async sendMessage(message: string): Promise<void> {
    this.turnChain = this.turnChain
      .catch(() => undefined)
      .then(() => this.runTurn(message))
    return this.turnChain
  }

  isAlive(): boolean {
    return this.process !== null && !this.process.killed && this.isReady
  }

  hasConversation(): boolean {
    return this.completedTurns > 0 || Boolean(this.sessionId || this.config.resumeSessionId)
  }

  getSessionId(): string | null {
    return this.sessionId ?? this.config.resumeSessionId ?? null
  }

  kill() {
    this.clearIdleTimer()
    this.process?.kill()
    this.resetProcessState()
  }

  private async runTurn(message: string) {
    if (!this.isAlive()) {
      await this.start()
    }
    if (!this.process?.stdin?.writable) {
      throw new Error('Persistent agent stdin not available')
    }

    return new Promise<void>((resolve, reject) => {
      this.activeTurn = { resolve, reject }

      const payload = JSON.stringify({
        type: 'user',
        session_id: this.getSessionId() ?? '',
        parent_tool_use_id: null,
        uuid: randomUUID(),
        message: {
          role: 'user',
          content: message,
        },
      })

      this.process?.stdin?.write(`${payload}\n`, (error) => {
        if (error) {
          this.rejectActiveTurn(error)
          return
        }

        this.resetIdleTimer()
      })
    })
  }

  private resetProcessState() {
    this.process = null
    this.isReady = false
    this.outputBuffer = ''
    this.stderrTail = ''
    this.clearIdleTimer()
  }

  private resolveActiveTurn() {
    const activeTurn = this.activeTurn
    this.activeTurn = null
    activeTurn?.resolve()
  }

  private rejectActiveTurn(error: Error) {
    const activeTurn = this.activeTurn
    this.activeTurn = null
    activeTurn?.reject(error)
  }

  private resetIdleTimer() {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => this.kill(), 5 * 60 * 1_000)
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }
}

const agents = new Map<string, PersistentAgent>()

export function getPersistentAgent(config: PersistentAgentConfig): PersistentAgent {
  const key = `${config.backend}:${config.workDir}:${config.model ?? 'default'}`
  let agent = agents.get(key)
  if (!agent || !agent.isAlive()) {
    agent = new PersistentAgent(config)
    agents.set(key, agent)
  }
  return agent
}

export function killAllPersistentAgents() {
  for (const agent of agents.values()) {
    agent.kill()
  }
  agents.clear()
}

export type { PersistentAgent }
