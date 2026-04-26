import { describe, expect, it } from 'vitest'
import { planRename } from '@/lib/modify/rename'
import { createRenamePr } from '@/lib/modify/pr'
import { makeTmpProject } from '@/lib/modify/test-fixtures'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const EXTENDED_TIMEOUT = 60_000

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(`git ${args.join(' ')} failed`))
    })
  })
}

async function initGitRepo(cwd: string): Promise<void> {
  await runGit(['init'], cwd)
  await runGit(['config', 'user.email', 'test@test.com'], cwd)
  await runGit(['config', 'user.name', 'Test'], cwd)
  await runGit(['add', '-A'], cwd)
  await runGit(['-c', 'core.autocrlf=false', 'commit', '-m', 'initial'], cwd)
}

describe('createRenamePr', () => {
  it(
    'Test 1: produces a branch with commit matching expected message format',
    async () => {
      const { projectRoot, cleanup } = await makeTmpProject({
        'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
        'src/foo.ts': `export class FooService {}\n`,
        'src/consumer.ts': `import { FooService } from './foo'\nconst s = new FooService()\n`,
      })

      try {
        await initGitRepo(projectRoot)

        const plan = await planRename(projectRoot, 'FooService', 'BarService')
        expect(plan.conflicts).toHaveLength(0)
        expect(plan.fileEdits.length).toBeGreaterThan(0)

        const result = await createRenamePr(projectRoot, plan, {
          symbol: 'FooService',
          newName: 'BarService',
        })

        expect(result.branch).toMatch(/^modify\/rename-FooService-to-BarService-/)
        expect(result.sha).toMatch(/^[0-9a-f]{40}$/)

        const logMsg = await runGit(['log', '--format=%s', '-1'], projectRoot)
        expect(logMsg).toContain('FooService')
        expect(logMsg).toContain('BarService')
      } finally {
        await cleanup()
      }
    },
    EXTENDED_TIMEOUT
  )

  it(
    'Test 2: final file content equals expected post-rename text',
    async () => {
      const { projectRoot, cleanup } = await makeTmpProject({
        'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
        'src/foo.ts': `export class FooService {}\n`,
        'src/consumer.ts': `import { FooService } from './foo'\nconst s = new FooService()\n`,
      })

      try {
        await initGitRepo(projectRoot)

        const plan = await planRename(projectRoot, 'FooService', 'BarService')
        await createRenamePr(projectRoot, plan, {
          symbol: 'FooService',
          newName: 'BarService',
        })

        const fooContent = await fs.readFile(path.join(projectRoot, 'src/foo.ts'), 'utf8')
        const consumerContent = await fs.readFile(path.join(projectRoot, 'src/consumer.ts'), 'utf8')

        expect(fooContent).toContain('BarService')
        expect(fooContent).not.toContain('FooService')
        expect(consumerContent).toContain('BarService')
        expect(consumerContent).not.toContain('FooService')
      } finally {
        await cleanup()
      }
    },
    EXTENDED_TIMEOUT
  )
})
