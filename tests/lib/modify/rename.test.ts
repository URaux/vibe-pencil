import { describe, expect, it } from 'vitest'
import { planRename } from '@/lib/modify/rename'
import { makeTmpProject } from '@/lib/modify/test-fixtures'

describe('planRename', () => {
  it('Test 1: happy rename across 2 files — correct edits, 0 conflicts', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/foo.ts': `export class FooService {}\n`,
      'src/bar.ts': `import { FooService } from './foo'\nconst x = new FooService()\n`,
    })

    try {
      const plan = await planRename(projectRoot, 'FooService', 'BarService')
      expect(plan.conflicts).toHaveLength(0)
      expect(plan.fileEdits.length).toBeGreaterThanOrEqual(2)

      const allEdits = plan.fileEdits.flatMap((fe) => fe.edits)
      const replacements = allEdits.map((e) => e.replacement)
      expect(replacements.every((r) => r === 'BarService')).toBe(true)

      const originals = allEdits.map((e) => e.original)
      expect(originals.every((o) => o === 'FooService')).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('Test 2: collision — BarService already in SAME file → conflict kind collision', async () => {
    // Per W1 D10.5 fixup #3: collision check is scoped to the same source file as the
    // declaration; cross-file same-name decls live in different module scopes.
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/foo.ts': `export class FooService {}\nexport class BarService {}\n`,
    })

    try {
      const plan = await planRename(projectRoot, 'FooService', 'BarService')
      const collision = plan.conflicts.find((c) => c.kind === 'collision')
      expect(collision).toBeDefined()
      expect(collision?.message).toMatch(/BarService/)
    } finally {
      await cleanup()
    }
  })

  it('Test 2b: same-name decls in DIFFERENT files do NOT collide (SEV2 fixup #3 regression)', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/foo.ts': `export class FooService {}\n`,
      'src/bar.ts': `export class BarService {}\n`,
    })

    try {
      const plan = await planRename(projectRoot, 'FooService', 'BarService')
      const collision = plan.conflicts.find((c) => c.kind === 'collision')
      expect(collision).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 3: symbol not found → conflict kind not-found', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/foo.ts': `export class SomeOtherClass {}\n`,
    })

    try {
      const plan = await planRename(projectRoot, 'FooService', 'BarService')
      const notFound = plan.conflicts.find((c) => c.kind === 'not-found')
      expect(notFound).toBeDefined()
      expect(notFound?.message).toMatch(/FooService/)
    } finally {
      await cleanup()
    }
  })

  it('Test 4: reserved word newName → conflict kind reserved', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/foo.ts': `export class FooService {}\n`,
    })

    try {
      const plan = await planRename(projectRoot, 'FooService', 'class')
      const reserved = plan.conflicts.find((c) => c.kind === 'reserved')
      expect(reserved).toBeDefined()
      expect(reserved?.message).toMatch(/reserved/)
    } finally {
      await cleanup()
    }
  })

  it('Test 5: safetyChecks reflect tsConfigFound and file membership', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'src/foo.ts': `export class FooService {}\n`,
      'src/consumer.ts': `import { FooService } from './foo'\nconst svc = new FooService()\n`,
    })

    try {
      const plan = await planRename(projectRoot, 'FooService', 'BarService')
      expect(plan.safetyChecks.tsConfigFound).toBe(true)
      expect(plan.conflicts).toHaveLength(0)
    } finally {
      await cleanup()
    }
  })
})
