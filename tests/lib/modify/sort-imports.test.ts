import { describe, it, expect } from 'vitest'
import { planSortImports } from '@/lib/modify/sort-imports'
import { makeTmpProject } from '@/lib/modify/test-fixtures'

describe('planSortImports', () => {
  it('pre-sorted file → no edits (no-op)', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/a.ts': [
        "import fs from 'node:fs'",
        "import path from 'node:path'",
        "import { cache } from '@/lib/cache'",
        "import { util } from '@/lib/util'",
        "import { bar } from '../bar'",
        "import { foo } from './foo'",
        '',
      ].join('\n'),
    })
    try {
      const plan = await planSortImports(projectRoot, { filePath: 'src/a.ts' })
      expect(plan.conflicts).toHaveLength(0)
      expect(plan.fileEdits).toHaveLength(0)
    } finally {
      await cleanup()
    }
  })

  it('mixed groups out-of-order → sorted into external/aliased/relative groups alphabetically', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/a.ts': [
        "import { foo } from './foo'",
        "import { cache } from '@/lib/cache'",
        "import path from 'node:path'",
        "import { bar } from '../bar'",
        "import fs from 'node:fs'",
        "import { util } from '@/lib/util'",
        '',
      ].join('\n'),
    })
    try {
      const plan = await planSortImports(projectRoot, { filePath: 'src/a.ts' })
      expect(plan.conflicts).toHaveLength(0)
      expect(plan.fileEdits).toHaveLength(1)
      const replacement = plan.fileEdits[0].edits[0].replacement
      const lines = replacement.split('\n')
      // external first: node:fs before node:path
      const fsIdx = lines.findIndex((l) => l.includes("'node:fs'"))
      const pathIdx = lines.findIndex((l) => l.includes("'node:path'"))
      expect(fsIdx).toBeLessThan(pathIdx)
      // aliased after external
      const cacheIdx = lines.findIndex((l) => l.includes("'@/lib/cache'"))
      expect(cacheIdx).toBeGreaterThan(pathIdx)
      // relative after aliased
      const barIdx = lines.findIndex((l) => l.includes("'../bar'"))
      const utilIdx = lines.findIndex((l) => l.includes("'@/lib/util'"))
      expect(barIdx).toBeGreaterThan(utilIdx)
    } finally {
      await cleanup()
    }
  })

  it('named imports within a statement are sorted alphabetically', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/a.ts': "import { Zoo, Apple, Mango } from 'fruits'\n",
    })
    try {
      const plan = await planSortImports(projectRoot, { filePath: 'src/a.ts' })
      expect(plan.fileEdits).toHaveLength(1)
      const replacement = plan.fileEdits[0].edits[0].replacement
      expect(replacement).toContain('{ Apple, Mango, Zoo }')
    } finally {
      await cleanup()
    }
  })

  it('side-effect import (no specifiers) preserved in its group', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/a.ts': [
        "import 'some-polyfill'",
        "import { b } from 'b-lib'",
        '',
      ].join('\n'),
    })
    try {
      const plan = await planSortImports(projectRoot, { filePath: 'src/a.ts' })
      // both external — alphabetically 'b-lib' < 'some-polyfill', so b-lib first
      expect(plan.fileEdits).toHaveLength(1)
      const replacement = plan.fileEdits[0].edits[0].replacement
      const bIdx = replacement.indexOf("'b-lib'")
      const polyIdx = replacement.indexOf("'some-polyfill'")
      expect(bIdx).toBeLessThan(polyIdx)
    } finally {
      await cleanup()
    }
  })

  it('comments above import block are preserved (not part of edits)', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({
      'src/a.ts': [
        '// top-level comment',
        "import { z } from 'z-lib'",
        "import { a } from 'a-lib'",
        '',
      ].join('\n'),
    })
    try {
      const plan = await planSortImports(projectRoot, { filePath: 'src/a.ts' })
      expect(plan.fileEdits).toHaveLength(1)
      // The edit replaces only the import block, comment not included in replacement
      const edit = plan.fileEdits[0].edits[0]
      expect(edit.original).not.toContain('top-level comment')
      expect(edit.replacement).not.toContain('top-level comment')
      // a-lib sorts before z-lib
      const aIdx = edit.replacement.indexOf("'a-lib'")
      const zIdx = edit.replacement.indexOf("'z-lib'")
      expect(aIdx).toBeLessThan(zIdx)
    } finally {
      await cleanup()
    }
  })

  it('missing file → conflict kind not-found', async () => {
    const { projectRoot, cleanup } = await makeTmpProject({})
    try {
      const plan = await planSortImports(projectRoot, { filePath: 'src/nonexistent.ts' })
      expect(plan.fileEdits).toHaveLength(0)
      expect(plan.conflicts).toHaveLength(1)
      expect(plan.conflicts[0].kind).toBe('not-found')
    } finally {
      await cleanup()
    }
  })
})
