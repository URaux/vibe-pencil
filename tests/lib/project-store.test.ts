import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { saveProject, loadProject } from '@/lib/project-store'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('project-store', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('saves and loads a project', () => {
    const project = {
      name: 'test-project',
      version: '1.0',
      canvas: { nodes: [], edges: [] },
      config: { agent: 'claude-code' as const, model: 'claude-sonnet-4-6', workDir: './output', maxParallel: 3 },
      history: [],
    }

    saveProject(tmpDir, project)

    const loaded = loadProject(tmpDir)
    expect(loaded).toEqual(project)
  })

  it('returns null for nonexistent project', () => {
    expect(loadProject('/nonexistent/path')).toBeNull()
  })
})
