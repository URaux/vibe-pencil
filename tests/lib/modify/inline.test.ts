import { describe, it, expect } from 'vitest'
import { planInlineVariable } from '@/lib/modify/inline'
import { makeTmpProject } from '@/lib/modify/test-fixtures'
import { applyRenamePlan } from '@/lib/modify/apply'
import { promises as fs } from 'node:fs'
import path from 'node:path'

describe('planInlineVariable', () => {
  it('Test 1: inlines const — replaces use-sites with paren-wrapped init and removes decl', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      'src/main.ts': `const x = 42\nconsole.log(x)\nconsole.log(x + 1)\n`,
    })
    try {
      const plan = await planInlineVariable(projectRoot, { filePath: 'src/main.ts', variableName: 'x' })
      expect(plan.conflicts).toEqual([])
      expect(plan.fileEdits).toHaveLength(1)
      await applyRenamePlan(projectRoot, plan)
      const final = await fs.readFile(path.join(projectRoot, 'src/main.ts'), 'utf8')
      expect(final).toContain('(42)')
      expect(final).not.toContain('const x')
    } finally {
      await cleanup()
    }
  })

  it('Test 2: invalid identifier returns reserved conflict', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/main.ts': 'const x = 1\n',
    })
    try {
      const plan = await planInlineVariable(projectRoot, { filePath: 'src/main.ts', variableName: 'not valid' })
      expect(plan.conflicts.some((c) => c.kind === 'reserved')).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('Test 3: missing variable returns not-found conflict', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/main.ts': 'const y = 5\n',
    })
    try {
      const plan = await planInlineVariable(projectRoot, { filePath: 'src/main.ts', variableName: 'z' })
      expect(plan.conflicts.some((c) => c.kind === 'not-found' && c.message.includes('not found'))).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('Test 4: declaration without initializer returns not-found conflict', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/main.ts': 'let x: number\nx = 5\nconsole.log(x)\n',
    })
    try {
      const plan = await planInlineVariable(projectRoot, { filePath: 'src/main.ts', variableName: 'x' })
      expect(plan.conflicts.some((c) => c.kind === 'not-found' && c.message.includes('no initializer'))).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('Test 5: reassigned let returns not-found conflict', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/main.ts': 'let count = 0\ncount = count + 1\nconsole.log(count)\n',
    })
    try {
      const plan = await planInlineVariable(projectRoot, { filePath: 'src/main.ts', variableName: 'count' })
      expect(plan.conflicts.some((c) => c.message.includes('reassigned'))).toBe(true)
    } finally {
      await cleanup()
    }
  })

  it('Test 6: inlines string initializer — paren wraps the value at every use-site', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      'src/msg.ts': `const greeting = "hello"\nfunction greet() { return greeting + " world" }\n`,
    })
    try {
      const plan = await planInlineVariable(projectRoot, { filePath: 'src/msg.ts', variableName: 'greeting' })
      expect(plan.conflicts).toEqual([])
      await applyRenamePlan(projectRoot, plan)
      const final = await fs.readFile(path.join(projectRoot, 'src/msg.ts'), 'utf8')
      expect(final).toContain('("hello")')
      expect(final).not.toContain('const greeting')
    } finally {
      await cleanup()
    }
  })
})
