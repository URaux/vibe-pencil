import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import type { RenamePlan } from './rename'
import { applyRenamePlanMapped } from './apply'

function resolveTscBin(projectRoot: string): { bin: string; args: string[] } {
  const exe = process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
  const local = path.join(projectRoot, 'node_modules', '.bin', exe)
  if (existsSync(local)) return { bin: local, args: [] }
  const fallback = path.join(process.cwd(), 'node_modules', '.bin', exe)
  if (existsSync(fallback)) return { bin: fallback, args: [] }
  return { bin: 'npx', args: ['tsc'] }
}

export interface SandboxResult {
  tscOk: boolean
  testsOk: boolean
  errors: string[]
  durationMs: number
}

const TIMEOUT_MS = 30_000
const STDERR_TAIL = 500

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderrBuf = ''
    let stdoutBuf = ''

    child.stdout?.on('data', (d: Buffer) => { stdoutBuf += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { stderrBuf += d.toString() })

    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, stderr: stderrBuf.slice(-STDERR_TAIL) || 'timeout' })
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        stderr: (stderrBuf + stdoutBuf).slice(-STDERR_TAIL),
      })
    })
  })
}

export async function runSandbox(
  projectRoot: string,
  plan: RenamePlan,
  opts?: {
    runTests?: boolean
    tscBinPath?: string
    testCmd?: string[]
  }
): Promise<SandboxResult> {
  const start = Date.now()
  const id = crypto.randomBytes(8).toString('hex')
  const tmpDir = path.join(os.tmpdir(), `archviber-sandbox-${id}`)
  const errors: string[] = []

  try {
    await fs.mkdir(tmpDir, { recursive: true })
    // SEV2 fixup #2: exclude bulky/irrelevant trees from the sandbox copy.
    // node_modules alone can be 500MB+ on real projects; copying it per rename
    // wastes wall time and can blow the 30s tsc timeout.
    const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'out', '.archviber'])
    await fs.cp(projectRoot, tmpDir, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(projectRoot, src)
        if (!rel) return true
        const top = rel.split(path.sep)[0]
        return !SKIP.has(top)
      },
    })

    // Apply plan to tmp copy using path mapping
    const mappedPlan: RenamePlan = {
      ...plan,
      fileEdits: plan.fileEdits.map((fe) => ({
        ...fe,
        filePath: path.join(tmpDir, path.relative(projectRoot, fe.filePath)),
      })),
    }

    await applyRenamePlanMapped(tmpDir, mappedPlan, (p) => p)

    // Run tsc — prefer the project's own typescript binary, then this repo's, then npx
    const resolved = opts?.tscBinPath
      ? { bin: opts.tscBinPath, args: [] }
      : resolveTscBin(projectRoot)
    const tscResult = await runCommand(resolved.bin, [...resolved.args, '--noEmit'], tmpDir, TIMEOUT_MS)

    if (!tscResult.ok && tscResult.stderr) {
      errors.push(tscResult.stderr)
    }

    let testsOk = true
    if (opts?.runTests) {
      const testCmd = opts?.testCmd ?? ['npx', 'vitest', 'run', '--reporter=basic']
      const [testBin, ...testArgs] = testCmd
      const testResult = await runCommand(testBin, testArgs, tmpDir, TIMEOUT_MS)
      testsOk = testResult.ok
      if (!testResult.ok && testResult.stderr) {
        errors.push(testResult.stderr)
      }
    }

    return {
      tscOk: tscResult.ok,
      testsOk,
      errors,
      durationMs: Date.now() - start,
    }
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup
    }
  }
}
