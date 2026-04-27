import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { planRemoveUnusedImports } from '../../../src/lib/modify/remove-unused-imports'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remove-unused-imports-'))
})

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeTs(name: string, content: string): Promise<string> {
  const p = path.join(tmpDir, name)
  await fs.writeFile(p, content, 'utf8')
  return p
}

describe('planRemoveUnusedImports', () => {
  it('removes an entirely unused named import', async () => {
    const filePath = await writeTs(
      'a.ts',
      `import { useState } from 'react'\n\nconst x = 1\n`,
    )
    const plan = await planRemoveUnusedImports(tmpDir, { filePath })
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.fileEdits).toHaveLength(1)
    const edit = plan.fileEdits[0]!.edits[0]!
    expect(edit.replacement).toBe('')
  })

  it('removes an unused default import', async () => {
    const filePath = await writeTs(
      'b.ts',
      `import React from 'react'\n\nconst x = 1\n`,
    )
    const plan = await planRemoveUnusedImports(tmpDir, { filePath })
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.fileEdits).toHaveLength(1)
    const edit = plan.fileEdits[0]!.edits[0]!
    expect(edit.replacement).toBe('')
  })

  it('drops only unused names from a partially-unused import', async () => {
    const filePath = await writeTs(
      'c.ts',
      `import { useState, useEffect } from 'react'\n\nconst x = useState(0)\n`,
    )
    const plan = await planRemoveUnusedImports(tmpDir, { filePath })
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.fileEdits).toHaveLength(1)
    const edit = plan.fileEdits[0]!.edits[0]!
    expect(edit.replacement).toContain('useState')
    expect(edit.replacement).not.toContain('useEffect')
  })

  it('preserves side-effect-only imports (no bindings)', async () => {
    const filePath = await writeTs(
      'd.ts',
      `import './polyfills'\n\nconst x = 1\n`,
    )
    const plan = await planRemoveUnusedImports(tmpDir, { filePath })
    expect(plan.fileEdits).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(0)
  })

  it('removes entire statement when all named imports are unused', async () => {
    const filePath = await writeTs(
      'e.ts',
      `import { a, b, c } from './helpers'\n\nconst x = 1\n`,
    )
    const plan = await planRemoveUnusedImports(tmpDir, { filePath })
    expect(plan.fileEdits).toHaveLength(1)
    const edit = plan.fileEdits[0]!.edits[0]!
    expect(edit.replacement).toBe('')
  })

  it('returns not-found conflict for missing file', async () => {
    const plan = await planRemoveUnusedImports(tmpDir, {
      filePath: path.join(tmpDir, 'nonexistent.ts'),
    })
    expect(plan.fileEdits).toHaveLength(0)
    expect(plan.conflicts[0]?.kind).toBe('not-found')
  })
})
