import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { planAddImport } from '../../../src/lib/modify/add-import'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'add-import-'))
})

afterAll(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(name: string, content: string): Promise<string> {
  const p = path.join(tmpDir, name)
  await fs.writeFile(p, content, 'utf8')
  return p
}

describe('planAddImport', () => {
  it('inserts a named import after existing imports', async () => {
    const filePath = await writeFile('a.ts', `import React from 'react'\n\nconst x = 1\n`)
    const plan = await planAddImport(tmpDir, {
      filePath,
      moduleSpecifier: './utils',
      named: ['formatDate'],
    })
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.fileEdits).toHaveLength(1)
    const edit = plan.fileEdits[0]!.edits[0]!
    expect(edit.replacement).toContain("from './utils'")
    expect(edit.replacement).toContain('formatDate')
    // Should be inserted after the React import line
    expect(edit.start).toBeGreaterThan(0)
  })

  it('inserts a default import into a file with no existing imports', async () => {
    const filePath = await writeFile('b.ts', `const x = 1\n`)
    const plan = await planAddImport(tmpDir, {
      filePath,
      moduleSpecifier: 'lodash',
      default: '_',
    })
    expect(plan.conflicts).toHaveLength(0)
    const edit = plan.fileEdits[0]!.edits[0]!
    expect(edit.replacement).toBe("import _ from 'lodash'\n")
    expect(edit.start).toBe(0)
  })

  it('merges named imports when specifier already imported', async () => {
    const filePath = await writeFile('c.ts', `import { useState } from 'react'\n\nconst x = 1\n`)
    const plan = await planAddImport(tmpDir, {
      filePath,
      moduleSpecifier: 'react',
      named: ['useEffect', 'useCallback'],
    })
    expect(plan.conflicts).toHaveLength(0)
    const edit = plan.fileEdits[0]!.edits[0]!
    expect(edit.replacement).toContain('useState')
    expect(edit.replacement).toContain('useEffect')
    expect(edit.replacement).toContain('useCallback')
    // Should replace (same start as the original import)
    expect(edit.original).toContain('useState')
  })

  it('inserts a side-effect import when named and default are absent', async () => {
    const filePath = await writeFile('d.ts', `const x = 1\n`)
    const plan = await planAddImport(tmpDir, {
      filePath,
      moduleSpecifier: './side-effect',
    })
    expect(plan.conflicts).toHaveLength(0)
    const edit = plan.fileEdits[0]!.edits[0]!
    expect(edit.replacement).toBe("import './side-effect'\n")
  })

  it('returns not-found conflict for missing file', async () => {
    const plan = await planAddImport(tmpDir, {
      filePath: path.join(tmpDir, 'nonexistent.ts'),
      moduleSpecifier: 'react',
      named: ['useState'],
    })
    expect(plan.fileEdits).toHaveLength(0)
    expect(plan.conflicts[0]?.kind).toBe('not-found')
  })

  it('returns empty fileEdits when import is already present with same names', async () => {
    const filePath = await writeFile('e.ts', `import { useState } from 'react'\n`)
    const plan = await planAddImport(tmpDir, {
      filePath,
      moduleSpecifier: 'react',
      named: ['useState'],
    })
    // Nothing to merge — plan should be a no-op
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.fileEdits).toHaveLength(0)
  })
})
