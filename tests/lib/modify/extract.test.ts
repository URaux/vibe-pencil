import { describe, it, expect } from 'vitest'
import { planExtract } from '@/lib/modify/extract'
import { makeTmpProject } from '@/lib/modify/test-fixtures'
import { applyRenamePlan } from '@/lib/modify/apply'
import { promises as fs } from 'node:fs'
import path from 'node:path'

describe('planExtract', () => {
  it('Test 1: extract a no-closure block with no inputs → ok with insert + replace edits', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      'src/main.ts': `function run(): void {\n  console.log("a")\n  console.log("b")\n  console.log("c")\n}\n`,
    })
    try {
      const plan = await planExtract(projectRoot, {
        filePath: 'src/main.ts',
        startLine: 2,
        endLine: 3,
        newFunctionName: 'logAB',
      })
      expect(plan.conflicts).toEqual([])
      expect(plan.fileEdits).toHaveLength(1)
      expect(plan.fileEdits[0].edits.length).toBeGreaterThanOrEqual(2)

      // Apply the plan and confirm the file now has the new function
      await applyRenamePlan(projectRoot, plan)
      const final = await fs.readFile(path.join(projectRoot, 'src/main.ts'), 'utf8')
      expect(final).toContain('function logAB(')
      expect(final).toContain('logAB()')
    } finally {
      await cleanup()
    }
  })

  it('Test 2: invalid identifier returns reserved conflict', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/main.ts': 'function run() { console.log(1) }\n',
    })
    try {
      const plan = await planExtract(projectRoot, {
        filePath: 'src/main.ts',
        startLine: 1,
        endLine: 1,
        newFunctionName: 'not valid',
      })
      const conflict = plan.conflicts.find((c) => c.kind === 'reserved')
      expect(conflict).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 3: range outside any function returns not-found', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/top.ts': 'const a = 1\nconst b = 2\n',
    })
    try {
      const plan = await planExtract(projectRoot, {
        filePath: 'src/top.ts',
        startLine: 1,
        endLine: 2,
        newFunctionName: 'foo',
      })
      const nf = plan.conflicts.find((c) => c.kind === 'not-found')
      expect(nf).toBeDefined()
      expect(nf?.message).toMatch(/not inside a function/i)
    } finally {
      await cleanup()
    }
  })

  it('Test 4: range with a write to outer-scope variable returns not-found with reason', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/main.ts':
        `function run(): void {\n  let total = 0\n  total = total + 1\n  total = total + 2\n  console.log(total)\n}\n`,
    })
    try {
      const plan = await planExtract(projectRoot, {
        filePath: 'src/main.ts',
        startLine: 3,
        endLine: 4,
        newFunctionName: 'incr',
      })
      const conflict = plan.conflicts.find((c) =>
        c.message.includes('writes to outer-scope vars'),
      )
      expect(conflict).toBeDefined()
      expect(conflict?.message).toContain('total')
    } finally {
      await cleanup()
    }
  })

  it('Test 5: range with a return statement returns not-found', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/main.ts': `function run(): number {\n  const x = 1\n  return x\n}\n`,
    })
    try {
      const plan = await planExtract(projectRoot, {
        filePath: 'src/main.ts',
        startLine: 2,
        endLine: 3,
        newFunctionName: 'mkX',
      })
      const conflict = plan.conflicts.find((c) =>
        c.message.includes('return statements'),
      )
      expect(conflict).toBeDefined()
    } finally {
      await cleanup()
    }
  })

  it('Test 6: read-only outer var becomes a parameter', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/main.ts':
        `function run(label: string): void {\n  console.log(label)\n  console.log(label.toUpperCase())\n}\n`,
    })
    try {
      const plan = await planExtract(projectRoot, {
        filePath: 'src/main.ts',
        startLine: 2,
        endLine: 3,
        newFunctionName: 'logBoth',
      })
      expect(plan.conflicts).toEqual([])
      // The replacement edits include a call site referencing 'label' as arg
      const editTexts = plan.fileEdits[0].edits.map((e) => e.replacement).join(' | ')
      expect(editTexts).toMatch(/logBoth\([^)]*label[^)]*\)/)
      expect(editTexts).toMatch(/function logBoth\(\s*label/m)
    } finally {
      await cleanup()
    }
  })
})
