import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { planAddExport } from '../../../src/lib/modify/add-export'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { applyRenamePlan } from '../../../src/lib/modify/apply'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'add-export-test-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(name: string, content: string) {
  const p = path.join(tmpDir, name)
  await fs.writeFile(p, content, 'utf8')
  return p
}

describe('planAddExport', () => {
  it('Test 1: adds export to a function declaration', async () => {
    const src = `function greet(name: string) {\n  return \`Hello \${name}\`\n}\n`
    const filePath = await writeFile('greet.ts', src)
    const plan = await planAddExport(tmpDir, { filePath, symbolName: 'greet' })
    expect(plan.conflicts).toHaveLength(0)
    await applyRenamePlan(tmpDir, plan)
    const result = await fs.readFile(filePath, 'utf8')
    expect(result).toMatch(/^export function greet/)
  })

  it('Test 2: adds export to a class declaration', async () => {
    const src = `class User {\n  name: string\n  constructor(n: string) { this.name = n }\n}\n`
    const filePath = await writeFile('user.ts', src)
    const plan = await planAddExport(tmpDir, { filePath, symbolName: 'User', kind: 'class' })
    expect(plan.conflicts).toHaveLength(0)
    await applyRenamePlan(tmpDir, plan)
    const result = await fs.readFile(filePath, 'utf8')
    expect(result).toMatch(/^export class User/)
  })

  it('Test 3: adds export to a const declaration', async () => {
    const src = `const MAX_RETRIES = 3\n`
    const filePath = await writeFile('config.ts', src)
    const plan = await planAddExport(tmpDir, { filePath, symbolName: 'MAX_RETRIES', kind: 'const' })
    expect(plan.conflicts).toHaveLength(0)
    await applyRenamePlan(tmpDir, plan)
    const result = await fs.readFile(filePath, 'utf8')
    expect(result).toMatch(/^export const MAX_RETRIES/)
  })

  it('Test 4: already-exported is idempotent (no edits, no conflicts)', async () => {
    const src = `export function alreadyExported() { return 1 }\n`
    const filePath = await writeFile('already.ts', src)
    const plan = await planAddExport(tmpDir, { filePath, symbolName: 'alreadyExported' })
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.fileEdits).toHaveLength(0)
    // File unchanged
    const result = await fs.readFile(filePath, 'utf8')
    expect(result).toBe(src)
  })

  it('Test 5: symbol-not-found returns conflict', async () => {
    const src = `function greet() {}\n`
    const filePath = await writeFile('greet.ts', src)
    const plan = await planAddExport(tmpDir, { filePath, symbolName: 'noSuchFn' })
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0].kind).toBe('not-found')
    expect(plan.conflicts[0].message).toMatch(/symbol "noSuchFn" not found/)
  })

  it('Test 6: file-not-found returns conflict', async () => {
    const plan = await planAddExport(tmpDir, {
      filePath: '/no/such/file.ts',
      symbolName: 'anything',
    })
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0].kind).toBe('not-found')
    expect(plan.conflicts[0].message).toMatch(/file not found/)
  })

  it('Test 7: adds export to interface declaration', async () => {
    const src = `interface Shape {\n  area(): number\n}\n`
    const filePath = await writeFile('shape.ts', src)
    const plan = await planAddExport(tmpDir, { filePath, symbolName: 'Shape', kind: 'interface' })
    expect(plan.conflicts).toHaveLength(0)
    await applyRenamePlan(tmpDir, plan)
    const result = await fs.readFile(filePath, 'utf8')
    expect(result).toMatch(/^export interface Shape/)
  })
})
