import { describe, it, expect } from 'vitest'
import { planMove } from '@/lib/modify/move'
import { makeTmpProject } from '@/lib/modify/test-fixtures'
import { applyRenamePlan } from '@/lib/modify/apply'
import { promises as fs } from 'node:fs'
import path from 'node:path'

describe('planMove', () => {
  it('Test 1: move a class with one external importer', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      'src/foo.ts': `export class FooService {\n  hello(): string { return "hi" }\n}\n`,
      'src/bar.ts': `import { FooService } from './foo'\n\nconst f = new FooService()\nf.hello()\n`,
      'src/util/empty.ts': `// placeholder\n`,
    })

    try {
      const plan = await planMove(projectRoot, {
        symbol: 'FooService',
        fromFile: 'src/foo.ts',
        toFile: 'src/util/empty.ts',
      })
      expect(plan.conflicts).toEqual([])
      // Expect 3 file edits: foo.ts (delete), empty.ts (insert), bar.ts (import rewrite)
      const filePaths = plan.fileEdits.map((e) => path.basename(e.filePath)).sort()
      expect(filePaths).toEqual(['bar.ts', 'empty.ts', 'foo.ts'])

      await applyRenamePlan(projectRoot, plan)
      const fooAfter = await fs.readFile(path.join(projectRoot, 'src/foo.ts'), 'utf8')
      const emptyAfter = await fs.readFile(path.join(projectRoot, 'src/util/empty.ts'), 'utf8')
      const barAfter = await fs.readFile(path.join(projectRoot, 'src/bar.ts'), 'utf8')

      expect(fooAfter).not.toContain('class FooService')
      expect(emptyAfter).toContain('class FooService')
      expect(barAfter).toContain("from './util/empty'")
    } finally {
      await cleanup()
    }
  })

  it('Test 2: move a function — no importers required', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      'src/a.ts': `export function helper(): number { return 42 }\n`,
      'src/b.ts': `// destination\n`,
    })

    try {
      const plan = await planMove(projectRoot, {
        symbol: 'helper',
        fromFile: 'src/a.ts',
        toFile: 'src/b.ts',
      })
      expect(plan.conflicts).toEqual([])
      const filePaths = plan.fileEdits.map((e) => path.basename(e.filePath)).sort()
      expect(filePaths).toEqual(['a.ts', 'b.ts'])

      await applyRenamePlan(projectRoot, plan)
      const aAfter = await fs.readFile(path.join(projectRoot, 'src/a.ts'), 'utf8')
      const bAfter = await fs.readFile(path.join(projectRoot, 'src/b.ts'), 'utf8')
      expect(aAfter).not.toContain('function helper')
      expect(bAfter).toContain('function helper')
    } finally {
      await cleanup()
    }
  })

  it('Test 3: invalid identifier returns reserved conflict', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/a.ts': 'export class A {}\n',
      'src/b.ts': '\n',
    })
    try {
      const plan = await planMove(projectRoot, {
        symbol: 'not valid',
        fromFile: 'src/a.ts',
        toFile: 'src/b.ts',
      })
      expect(plan.conflicts.find((c) => c.kind === 'reserved')).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 4: same fromFile and toFile rejected', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/a.ts': 'export class A {}\n',
    })
    try {
      const plan = await planMove(projectRoot, {
        symbol: 'A',
        fromFile: 'src/a.ts',
        toFile: 'src/a.ts',
      })
      expect(plan.conflicts.find((c) => c.message.includes('same'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 5: symbol not at top level returns not-found', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      'src/a.ts': `export class Outer {\n  inner(): number {\n    const Foo = 1\n    return Foo\n  }\n}\n`,
      'src/b.ts': '\n',
    })
    try {
      const plan = await planMove(projectRoot, {
        symbol: 'Foo',
        fromFile: 'src/a.ts',
        toFile: 'src/b.ts',
      })
      expect(plan.conflicts.find((c) => c.kind === 'not-found' && c.message.includes('top-level'))).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 6: circular-import detection', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      'src/a.ts': `import { B } from './b'\nexport class FromA {\n  b: B\n}\n`,
      'src/b.ts': `export class B {}\n`,
    })
    try {
      // Moving FromA into b.ts would create a cycle since b.ts already imports nothing,
      // but if we move FromA into a file that already imports a.ts, that's circular.
      // Setup needs a proper cycle precondition: c.ts imports a.ts, we move FromA → c.ts.
      const conflictPlan = await planMove(projectRoot, {
        symbol: 'FromA',
        fromFile: 'src/a.ts',
        toFile: 'src/b.ts',
      })
      // b.ts does NOT import from a.ts → no cycle here. Confirm no cycle conflict.
      expect(conflictPlan.conflicts.find((c) => c.message.includes('circular'))).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 7: circular-import is detected when target already imports source', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      'src/a.ts': `export class A {}\n`,
      'src/b.ts': `import { A } from './a'\nexport class B { a: A | null = null }\n`,
    })
    try {
      // Moving A → b.ts: b.ts already imports a.ts, so this would create a cycle
      // (b.ts imports a.ts, but A is in b.ts; the moved import would point to b.ts itself,
      // and any importer of A goes through b.ts which still imports a.ts).
      const plan = await planMove(projectRoot, {
        symbol: 'A',
        fromFile: 'src/a.ts',
        toFile: 'src/b.ts',
      })
      const cyc = plan.conflicts.find((c) => c.message.includes('circular'))
      expect(cyc).toBeDefined()
    } finally {
      await cleanup()
    }
  })
})
