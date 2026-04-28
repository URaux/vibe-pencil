import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  planReplaceInFile,
  InvalidPatternError,
  FileNotFoundError,
} from '@/lib/modify/replace-in-file'

interface MinimalEdit {
  start: number
  end: number
  original: string
  replacement: string
}

interface MinimalFileEdit {
  filePath: string
  edits: MinimalEdit[]
}

interface MinimalPlan {
  fileEdits: MinimalFileEdit[]
  conflicts: Array<{ kind: string; message: string }>
}

function applyPlan(content: string, plan: MinimalPlan): string {
  if (plan.fileEdits.length === 0) return content
  const edits = [...plan.fileEdits[0].edits].sort((a, b) => b.start - a.start)
  let result = content
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

let tmpDir: string
let filePath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replace-test-'))
  filePath = path.join(tmpDir, 'file.ts')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('planReplaceInFile', () => {
  it('replaces all literal occurrences', async () => {
    const content = 'foo bar foo baz foo'
    await fs.writeFile(filePath, content, 'utf8')
    const plan = await planReplaceInFile(tmpDir, {
      filePath,
      pattern: 'foo',
      replacement: 'qux',
    })
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.fileEdits).toHaveLength(1)
    expect(applyPlan(content, plan)).toBe('qux bar qux baz qux')
  })

  it('replaces with capture group back-reference', async () => {
    const content = 'hello world\nhello alice'
    await fs.writeFile(filePath, content, 'utf8')
    const plan = await planReplaceInFile(tmpDir, {
      filePath,
      pattern: 'hello (\\w+)',
      replacement: 'hi $1',
    })
    expect(plan.conflicts).toHaveLength(0)
    expect(applyPlan(content, plan)).toBe('hi world\nhi alice')
  })

  it('respects case-insensitive flag (gi)', async () => {
    const content = 'Foo foo FOO'
    await fs.writeFile(filePath, content, 'utf8')
    const plan = await planReplaceInFile(tmpDir, {
      filePath,
      pattern: 'foo',
      replacement: 'bar',
      flags: 'gi',
    })
    expect(plan.conflicts).toHaveLength(0)
    expect(applyPlan(content, plan)).toBe('bar bar bar')
  })

  it('respects multiline flag (gm)', async () => {
    const content = 'foo\nfoo\nbar'
    await fs.writeFile(filePath, content, 'utf8')
    const plan = await planReplaceInFile(tmpDir, {
      filePath,
      pattern: '^foo',
      replacement: 'baz',
      flags: 'gm',
    })
    expect(plan.conflicts).toHaveLength(0)
    expect(applyPlan(content, plan)).toBe('baz\nbaz\nbar')
  })

  it('returns not-found conflict when pattern matches nothing', async () => {
    await fs.writeFile(filePath, 'hello world', 'utf8')
    const plan = await planReplaceInFile(tmpDir, {
      filePath,
      pattern: 'xyz',
      replacement: 'abc',
    })
    expect(plan.fileEdits).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0].kind).toBe('not-found')
    expect(plan.conflicts[0].message).toContain('0 occurrences')
  })

  it('throws InvalidPatternError for invalid regex pattern', async () => {
    await fs.writeFile(filePath, 'content', 'utf8')
    await expect(
      planReplaceInFile(tmpDir, { filePath, pattern: '(unclosed', replacement: 'x' }),
    ).rejects.toThrow(InvalidPatternError)
  })

  it('throws InvalidPatternError for invalid flags', async () => {
    await fs.writeFile(filePath, 'content', 'utf8')
    await expect(
      planReplaceInFile(tmpDir, { filePath, pattern: 'foo', replacement: 'bar', flags: 'gz' }),
    ).rejects.toThrow(InvalidPatternError)
  })

  it('throws FileNotFoundError when file does not exist', async () => {
    await expect(
      planReplaceInFile(tmpDir, {
        filePath: path.join(tmpDir, 'nonexistent.ts'),
        pattern: 'foo',
        replacement: 'bar',
      }),
    ).rejects.toThrow(FileNotFoundError)
  })

  it('accepts absolute filePath', async () => {
    const content = 'alpha alpha'
    await fs.writeFile(filePath, content, 'utf8')
    const plan = await planReplaceInFile(tmpDir, {
      filePath,
      pattern: 'alpha',
      replacement: 'beta',
    })
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.fileEdits[0].filePath).toBe(filePath)
    expect(applyPlan(content, plan)).toBe('beta beta')
  })

  it('defaults to global flag (replaces all occurrences)', async () => {
    const content = 'a a a'
    await fs.writeFile(filePath, content, 'utf8')
    const plan = await planReplaceInFile(tmpDir, {
      filePath,
      pattern: 'a',
      replacement: 'b',
    })
    expect(plan.conflicts).toHaveLength(0)
    expect(applyPlan(content, plan)).toBe('b b b')
  })
})
