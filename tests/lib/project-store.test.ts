import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { saveProject, loadProject } from '@/lib/project-store'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('project-store', () => {
  let tmpRoot: string
  let originalRoot: string | undefined

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-test-'))
    originalRoot = process.env.ARCHVIBER_PROJECT_ROOT
    // Scope all save/load operations to the per-test tmp root so the
    // cwd-containment guard in project-store doesn't reject OS-tmpdir paths.
    process.env.ARCHVIBER_PROJECT_ROOT = tmpRoot
  })

  afterEach(() => {
    if (originalRoot === undefined) {
      delete process.env.ARCHVIBER_PROJECT_ROOT
    } else {
      process.env.ARCHVIBER_PROJECT_ROOT = originalRoot
    }
    fs.rmSync(tmpRoot, { recursive: true })
  })

  it('saves and loads a project', () => {
    const project = {
      name: 'test-project',
      version: '1.0',
      canvas: { nodes: [], edges: [] },
      config: { agent: 'claude-code' as const, model: 'claude-sonnet-4-6', workDir: './output', maxParallel: 3 },
      history: [],
    }

    saveProject('proj', project)

    const loaded = loadProject('proj')
    expect(loaded).toEqual(project)
  })

  it('returns null for nonexistent project', () => {
    expect(loadProject('does-not-exist')).toBeNull()
  })

  it('rejects paths that climb outside the project root', () => {
    expect(() => loadProject('../escape')).toThrow(/inside/i)
    expect(() => saveProject('../escape', {} as never)).toThrow(/inside/i)
  })
})
