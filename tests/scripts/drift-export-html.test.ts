/**
 * Tests for scripts/drift-export-html.mjs.
 * Spawns the real script with JSON fixture files and checks outputs.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const exec = promisify(execFile)

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'drift-export-html.mjs')

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'drift-html-test-'))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeDriftJson(overrides: Record<string, unknown> = {}): string {
  const report = {
    clean: false,
    addedBlocks: [{ id: 'b1', name: 'Auth', description: '', status: 'idle', container_id: null, code_anchors: [] }],
    removedBlocks: [],
    changedBlocks: [],
    addedContainers: [],
    removedContainers: [],
    addedEdges: [],
    removedEdges: [],
    ...overrides,
  }
  const summary = {
    addedBlocks: report.addedBlocks.length,
    removedBlocks: report.removedBlocks.length,
    changedBlocks: report.changedBlocks.length,
    addedContainers: report.addedContainers.length,
    removedContainers: report.removedContainers.length,
    addedEdges: report.addedEdges.length,
    removedEdges: report.removedEdges.length,
    total: report.addedBlocks.length + report.removedBlocks.length + report.changedBlocks.length,
  }
  return JSON.stringify({ summary, report, markdown: '', violations: [] })
}

function makeCleanJson(): string {
  const report = {
    clean: true,
    addedBlocks: [],
    removedBlocks: [],
    changedBlocks: [],
    addedContainers: [],
    removedContainers: [],
    addedEdges: [],
    removedEdges: [],
  }
  const summary = {
    addedBlocks: 0, removedBlocks: 0, changedBlocks: 0,
    addedContainers: 0, removedContainers: 0, addedEdges: 0, removedEdges: 0, total: 0,
  }
  return JSON.stringify({ summary, report, markdown: 'Diagram and code are in sync.', violations: [] })
}

// ---------------------------------------------------------------------------

describe('drift-export-html.mjs', () => {
  it('case 1: valid input emits well-formed HTML with drift sections', async () => {
    const inFile = path.join(tmpDir, 'drift.json')
    const outFile = path.join(tmpDir, 'drift.html')
    await fs.writeFile(inFile, makeDriftJson())

    await exec('node', [SCRIPT, '--in', inFile, '--out', outFile])

    const html = await fs.readFile(outFile, 'utf8')

    // Well-formed structure
    expect(html).toMatch(/^<!DOCTYPE html>/i)
    expect(html).toContain('</html>')

    // Title
    expect(html).toContain('ArchViber Drift Report')

    // Dirty status shown
    expect(html).toContain('Drift detected')
    expect(html).not.toContain('No drift detected')

    // Added block is listed
    expect(html).toContain('Auth')
    expect(html).toContain('b1')

    // Collapsible details elements
    expect(html).toMatch(/<details/i)
    expect(html).toMatch(/<summary/i)

    // Self-contained — no external stylesheet or script links
    expect(html).not.toMatch(/<link[^>]+href="http/i)
    expect(html).not.toMatch(/<script[^>]+src="http/i)
  })

  it('case 2: missing --in file exits 1 with error message', async () => {
    const outFile = path.join(tmpDir, 'should-not-exist.html')
    try {
      await exec('node', [SCRIPT, '--in', '/nonexistent/path/drift.json', '--out', outFile])
      expect.fail('should have thrown')
    } catch (err: unknown) {
      const e = err as { code: number; stderr: string }
      expect(e.code).toBe(1)
      expect(e.stderr).toContain('file not found')
    }
    // Output file must not have been created
    await expect(fs.access(outFile)).rejects.toThrow()
  })

  it('case 3: clean drift renders a "no drift" page without detail sections', async () => {
    const inFile = path.join(tmpDir, 'clean.json')
    const outFile = path.join(tmpDir, 'clean.html')
    await fs.writeFile(inFile, makeCleanJson())

    await exec('node', [SCRIPT, '--in', inFile, '--out', outFile])

    const html = await fs.readFile(outFile, 'utf8')

    expect(html).toContain('No drift detected')
    expect(html).toContain('Diagram and code are in sync')

    // No detail sections for individual changes
    expect(html).not.toMatch(/Added blocks/i)
    expect(html).not.toMatch(/Removed blocks/i)
  })
})
