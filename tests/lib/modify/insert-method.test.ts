import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { planInsertMethod } from '../../../src/lib/modify/insert-method'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { applyRenamePlan } from '../../../src/lib/modify/apply'

const SAMPLE_CLASS = `export class Greeter {
  name: string

  constructor(name: string) {
    this.name = name
  }

  greet() {
    return \`Hello, \${this.name}!\`
  }
}
`

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'insert-method-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(name: string, content: string) {
  const p = path.join(tmpDir, name)
  await fs.writeFile(p, content, 'utf8')
  return p
}

describe('planInsertMethod', () => {
  it('Test 1: insert method at end of class (default position)', async () => {
    const filePath = await writeFile('greeter.ts', SAMPLE_CLASS)
    const plan = await planInsertMethod(tmpDir, {
      filePath,
      className: 'Greeter',
      methodName: 'farewell',
      body: 'farewell() { return `Goodbye!`; }',
    })
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.fileEdits).toHaveLength(1)
    await applyRenamePlan(tmpDir, plan)
    const result = await fs.readFile(filePath, 'utf8')
    expect(result).toContain('farewell()')
    expect(result).toContain('Goodbye')
    expect(result).toContain('greet()')
  })

  it('Test 2: insert method before an existing method', async () => {
    const filePath = await writeFile('greeter.ts', SAMPLE_CLASS)
    const plan = await planInsertMethod(tmpDir, {
      filePath,
      className: 'Greeter',
      methodName: 'shout',
      body: 'shout() { return this.name.toUpperCase(); }',
      position: 'before:greet',
    })
    expect(plan.conflicts).toHaveLength(0)
    await applyRenamePlan(tmpDir, plan)
    const result = await fs.readFile(filePath, 'utf8')
    expect(result).toContain('shout()')
    // shout should appear before greet in the file
    expect(result.indexOf('shout()')).toBeLessThan(result.indexOf('greet()'))
  })

  it('Test 3: class-not-found returns conflict', async () => {
    const filePath = await writeFile('greeter.ts', SAMPLE_CLASS)
    const plan = await planInsertMethod(tmpDir, {
      filePath,
      className: 'NonExistent',
      methodName: 'foo',
      body: 'foo() {}',
    })
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0].kind).toBe('not-found')
    expect(plan.conflicts[0].message).toMatch(/class "NonExistent"/)
  })

  it('Test 4: method-already-exists returns conflict', async () => {
    const filePath = await writeFile('greeter.ts', SAMPLE_CLASS)
    const plan = await planInsertMethod(tmpDir, {
      filePath,
      className: 'Greeter',
      methodName: 'greet',
      body: 'greet() { return "duplicate"; }',
    })
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0].kind).toBe('collision')
    expect(plan.conflicts[0].message).toMatch(/already exists/)
  })

  it('Test 5: invalid filePath returns conflict', async () => {
    const plan = await planInsertMethod(tmpDir, {
      filePath: '/no/such/file.ts',
      className: 'Greeter',
      methodName: 'foo',
      body: 'foo() {}',
    })
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0].kind).toBe('not-found')
    expect(plan.conflicts[0].message).toMatch(/file not found/)
  })

  it('Test 6: invalid position string returns conflict', async () => {
    const filePath = await writeFile('greeter.ts', SAMPLE_CLASS)
    const plan = await planInsertMethod(tmpDir, {
      filePath,
      className: 'Greeter',
      methodName: 'foo',
      body: 'foo() {}',
      position: 'after:greet',
    })
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0].message).toMatch(/invalid position/)
  })

  it('Test 7: anchor method not found returns conflict', async () => {
    const filePath = await writeFile('greeter.ts', SAMPLE_CLASS)
    const plan = await planInsertMethod(tmpDir, {
      filePath,
      className: 'Greeter',
      methodName: 'newMethod',
      body: 'newMethod() {}',
      position: 'before:noSuchMethod',
    })
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0].kind).toBe('not-found')
    expect(plan.conflicts[0].message).toMatch(/anchor method "noSuchMethod"/)
  })
})
