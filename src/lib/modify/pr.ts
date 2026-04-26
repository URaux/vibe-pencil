import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import type { RenamePlan } from './rename'
import { applyRenamePlan } from './apply'

export interface PrResult {
  branch: string
  sha: string
}

function runGit(
  args: string[],
  cwd: string
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

    child.on('close', (code) => {
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

export async function createRenamePr(
  projectRoot: string,
  plan: RenamePlan,
  opts: { symbol: string; newName: string }
): Promise<PrResult> {
  const shortId = crypto.randomBytes(3).toString('hex')
  const branch = `modify/rename-${opts.symbol}-to-${opts.newName}-${shortId}`

  const checkout = await runGit(['checkout', '-b', branch], projectRoot)
  if (!checkout.ok) {
    // Tolerate "already on branch" case
    const alreadyExists = checkout.stderr.includes('already exists') || checkout.stderr.includes('already on')
    if (!alreadyExists) {
      throw new Error(`git checkout failed: ${checkout.stderr}`)
    }
  }

  await applyRenamePlan(projectRoot, plan)

  const addResult = await runGit(['add', '-A'], projectRoot)
  if (!addResult.ok) {
    throw new Error(`git add failed: ${addResult.stderr}`)
  }

  const commitMsg = `modify: rename ${opts.symbol} → ${opts.newName}`
  const commitResult = await runGit(
    ['-c', 'core.autocrlf=false', 'commit', '-m', commitMsg],
    projectRoot
  )
  if (!commitResult.ok) {
    throw new Error(`git commit failed: ${commitResult.stderr}`)
  }

  const shaResult = await runGit(['rev-parse', 'HEAD'], projectRoot)
  if (!shaResult.ok) {
    throw new Error(`git rev-parse failed: ${shaResult.stderr}`)
  }

  return { branch, sha: shaResult.stdout }
}
