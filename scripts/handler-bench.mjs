/**
 * handler-bench.mjs
 *
 * Benchmarks each orchestrator handler (design_edit, build, modify, deep_analyze, explain)
 * with fixed mock contexts and simulated LLM round-trips. Measures wall-clock time per
 * handler invocation and emits a JSON report for regression detection.
 *
 * Usage:
 *   node scripts/handler-bench.mjs [--runs N] [--out path/to/report.json]
 *
 * Options:
 *   --runs N    Repetitions per handler (default: 5)
 *   --out PATH  Write JSON report to this file instead of stdout
 *
 * Exit codes:
 *   0  Success
 *   1  Error
 *
 * JSON report shape:
 *   { timestamp, runs, results: [{ handler, runs, meanMs, medianMs, minMs, maxMs }] }
 */

import { performance } from 'node:perf_hooks'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)

function getFlag(flag) {
  const i = args.indexOf(flag)
  if (i === -1) return null
  return args[i + 1] ?? null
}

const runs = Math.max(1, parseInt(getFlag('--runs') ?? '5', 10))
const outPath = getFlag('--out')

if (isNaN(runs)) {
  console.error('handler-bench: --runs must be a number')
  process.exit(1)
}

// ── Shared context fixture ───────────────────────────────────────────────────

const BASE_IR_SUMMARY = {
  projectName: 'BenchProject',
  blockCount: 10,
  containerCount: 3,
  edgeCount: 8,
  topContainers: [
    { id: 'auth', name: 'Auth', blockCount: 3 },
    { id: 'api', name: 'API', blockCount: 5 },
    { id: 'db', name: 'Database', blockCount: 2 },
  ],
  techStacks: ['TypeScript'],
  estimatedTokens: 500,
}

const BASE_IR = {
  containers: [
    {
      id: 'auth',
      name: 'Auth',
      description: 'Authentication container',
      techStack: ['TypeScript'],
      blocks: [
        { id: 'login', name: 'LoginService', filePath: 'src/auth/login.ts', symbols: [], dependencies: [] },
        { id: 'session', name: 'SessionStore', filePath: 'src/auth/session.ts', symbols: [], dependencies: [] },
      ],
      subContainers: [],
    },
  ],
  edges: [],
  metadata: { generatedAt: new Date().toISOString(), sourceRoot: '/bench', version: '1' },
}

// ── Minimal mock runner (mirrors handler polling behavior) ───────────────────

function makeMockRunner(output) {
  let nextId = 0
  const statuses = new Map()

  return {
    spawnAgent(_nodeId, _prompt, _backend, _workDir, _model) {
      const agentId = `agent-${nextId++}`
      const status = { status: 'running', output: '' }
      statuses.set(agentId, status)
      queueMicrotask(() => {
        status.status = 'done'
        status.output = output
      })
      return agentId
    },
    getStatus(agentId) {
      return statuses.get(agentId) ?? null
    },
    stopAgent(_agentId) {},
  }
}

// ── Simulated handler implementations ────────────────────────────────────────
// These mirror the real handler's polling loop behavior without importing TS.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForTerminalStatus(runner, agentId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const status = runner.getStatus(agentId)
    if (!status) return { type: 'missing' }
    if (status.status === 'done') return { type: 'done', rawOutput: status.output }
    if (status.status === 'error') return { type: 'error', rawOutput: status.output }
    await sleep(1)
  }
  return { type: 'timeout' }
}

const INTENT_MOCKS = {
  design_edit: {
    output: JSON.stringify([{ action: 'add-node', node: { id: 'nb', label: 'NewBlock', type: 'block' } }]),
    async run(ctx) {
      const runner = makeMockRunner(INTENT_MOCKS.design_edit.output)
      const agentId = runner.spawnAgent('bench-design-edit', JSON.stringify(ctx.userPrompt), 'codex', process.cwd(), 'model')
      const terminal = await waitForTerminalStatus(runner, agentId)
      return { intent: 'design_edit', status: terminal.type === 'done' ? 'ok' : 'error', payload: terminal.rawOutput }
    },
  },
  build: {
    output: JSON.stringify({ scope: 'all', reason: 'bench' }),
    async run(ctx) {
      const runner = makeMockRunner(INTENT_MOCKS.build.output)
      const agentId = runner.spawnAgent('bench-build', JSON.stringify(ctx.userPrompt), 'codex', process.cwd(), 'model')
      const terminal = await waitForTerminalStatus(runner, agentId)
      return { intent: 'build', status: terminal.type === 'done' ? 'ok' : 'error', payload: terminal.rawOutput }
    },
  },
  modify: {
    output: JSON.stringify({ verb: 'rename', symbol: 'LoginService', newName: 'AuthService' }),
    async run(ctx) {
      const runner = makeMockRunner(INTENT_MOCKS.modify.output)
      const agentId = runner.spawnAgent('bench-modify', JSON.stringify(ctx.userPrompt), 'codex', process.cwd(), 'model')
      const terminal = await waitForTerminalStatus(runner, agentId)
      return { intent: 'modify', status: terminal.type === 'done' ? 'ok' : 'error', payload: terminal.rawOutput }
    },
  },
  deep_analyze: {
    output: '',
    async run(ctx) {
      // deep_analyze is synchronous — no LLM call, just builds analyst inputs
      const perspectives = ['security', 'scalability', 'maintainability']
      const analystInputs = perspectives.map((p) => ({
        perspective: p,
        irSummary: ctx.irSummary,
        containers: ctx.ir?.containers ?? [],
      }))
      return { intent: 'deep_analyze', status: 'ok', payload: { perspectives, analystInputs } }
    },
  },
  explain: {
    output: 'Auth container handles login via LoginService in src/auth/login.ts.',
    async run(ctx) {
      const runner = makeMockRunner(INTENT_MOCKS.explain.output)
      const agentId = runner.spawnAgent('bench-explain', JSON.stringify(ctx.userPrompt), 'codex', process.cwd(), 'model')
      const terminal = await waitForTerminalStatus(runner, agentId)
      return { intent: 'explain', status: terminal.type === 'done' ? 'ok' : 'error', payload: terminal.rawOutput }
    },
  },
}

const PROMPTS = {
  design_edit: 'Add a new block called NewBlock',
  build: 'Build everything',
  modify: 'Rename LoginService to AuthService',
  deep_analyze: 'Analyze the architecture',
  explain: 'Explain the Auth container',
}

// ── Benchmark runner ─────────────────────────────────────────────────────────

async function benchHandler(label) {
  const mock = INTENT_MOCKS[label]
  const ctx = {
    userPrompt: PROMPTS[label],
    irSummary: BASE_IR_SUMMARY,
    ir: BASE_IR,
    classifyResult: { intent: label, confidence: 0.95, rawOutput: '', fallback: false },
    workDir: process.cwd(),
  }

  const times = []
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    await mock.run(ctx)
    times.push(performance.now() - start)
  }

  times.sort((a, b) => a - b)
  const sum = times.reduce((a, b) => a + b, 0)

  return {
    handler: label,
    runs,
    meanMs: parseFloat((sum / runs).toFixed(3)),
    medianMs: parseFloat(times[Math.floor(times.length / 2)].toFixed(3)),
    minMs: parseFloat(times[0].toFixed(3)),
    maxMs: parseFloat(times[times.length - 1].toFixed(3)),
  }
}

async function main() {
  const intents = ['design_edit', 'build', 'modify', 'deep_analyze', 'explain']
  const results = []

  for (const intent of intents) {
    const row = await benchHandler(intent)
    results.push(row)
    process.stderr.write(`  ${intent}: mean=${row.meanMs}ms median=${row.medianMs}ms min=${row.minMs}ms max=${row.maxMs}ms\n`)
  }

  const report = {
    timestamp: new Date().toISOString(),
    runs,
    results,
  }

  const json = JSON.stringify(report, null, 2)

  if (outPath) {
    const abs = path.resolve(outPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, json, 'utf-8')
    process.stderr.write(`handler-bench: report written to ${abs}\n`)
  } else {
    process.stdout.write(json + '\n')
  }
}

main().catch((err) => {
  console.error('handler-bench error:', err)
  process.exit(1)
})
