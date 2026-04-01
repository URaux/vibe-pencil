import { spawn, type ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { EventEmitter } from 'events'

interface PersistentAgentConfig {
  backend: 'claude-code' | 'codex' | 'gemini'
  workDir: string
  model?: string
}

class PersistentAgent extends EventEmitter {
  private process: ChildProcess | null = null
  private decoder = new StringDecoder('utf8')
  private isReady = false
  private outputBuffer = ''
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private config: PersistentAgentConfig) {
    super()
    this.setMaxListeners(50)
  }

  async start(): Promise<void> {
    if (this.process) return

    const args = ['--output-format', 'stream-json']
    if (this.config.model) args.push('--model', this.config.model)

    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY

    // Relay fallback: if USE_RELAY is set, pass relay credentials
    if (process.env.USE_RELAY === 'true' && process.env.RELAY_API_BASE_URL) {
      if (this.config.backend === 'claude-code') {
        env.ANTHROPIC_BASE_URL = process.env.RELAY_API_BASE_URL
        env.ANTHROPIC_API_KEY = process.env.RELAY_API_KEY ?? ''
      }
    }

    this.process = spawn('claude', args, {
      cwd: this.config.workDir,
      env,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      const text = this.decoder.write(data)
      this.outputBuffer += text
      this.processBuffer()
    })

    this.process.on('exit', () => {
      this.process = null
      this.isReady = false
      this.outputBuffer = ''
      this.clearIdleTimer()
    })

    this.process.on('error', () => {
      this.process = null
      this.isReady = false
      this.outputBuffer = ''
      this.clearIdleTimer()
    })

    // Wait for the init event (Claude interactive mode emits a system init event on startup)
    await new Promise<void>((resolve) => {
      let resolved = false
      const tryResolve = () => {
        if (resolved) return
        resolved = true
        this.isReady = true
        resolve()
      }

      const checkReady = () => {
        if (this.outputBuffer.includes('"type":"system"') && this.outputBuffer.includes('"subtype":"init"')) {
          this.outputBuffer = ''
          tryResolve()
        } else if (!this.process) {
          tryResolve()
        } else {
          setTimeout(checkReady, 100)
        }
      }

      setTimeout(checkReady, 300)
      // Hard timeout after 30s — assume ready
      setTimeout(tryResolve, 30_000)
    })

    this.resetIdleTimer()
  }

  private processBuffer() {
    const lines = this.outputBuffer.split('\n')
    this.outputBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as Record<string, unknown>
        this.emit('event', event)

        if (event['type'] === 'result') {
          this.emit('response-done', event)
        }
      } catch {
        // Non-JSON line — skip
      }
    }
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.isAlive()) {
      await this.start()
    }
    if (!this.process?.stdin?.writable) {
      throw new Error('Persistent agent stdin not available')
    }
    // Clear buffer before new message
    this.outputBuffer = ''
    this.process.stdin.write(message + '\n')
    this.resetIdleTimer()
  }

  isAlive(): boolean {
    return this.process !== null && !this.process.killed && this.isReady
  }

  kill() {
    this.clearIdleTimer()
    this.process?.kill()
    this.process = null
    this.isReady = false
    this.outputBuffer = ''
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

// Module-level singleton map: one persistent agent per (backend, workDir) pair
const agents = new Map<string, PersistentAgent>()

export function getPersistentAgent(config: PersistentAgentConfig): PersistentAgent {
  const key = `${config.backend}:${config.workDir}`
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
