import { describe, it, expect } from 'vitest'
import {
  PERSPECTIVE_NAMES,
  PERSPECTIVE_SECTIONS,
  buildAnalystInput,
  collectAnchorPaths,
  renderAnalystMessage,
  type PerspectiveName,
} from '@/lib/deep-analyze'
import type { Ir } from '@/lib/ir/schema'

const fixtureIr: Ir = {
  version: '1.0',
  project: {
    name: 'fixture-proj',
    metadata: {
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
      archviberVersion: '0.1.0',
    },
  },
  containers: [
    { id: 'ui', name: 'UI Layer', color: 'blue' },
    { id: 'data', name: 'Data Layer', color: 'green' },
  ],
  blocks: [
    {
      id: 'page',
      name: 'Home Page',
      description: 'landing route',
      status: 'idle',
      container_id: 'ui',
      code_anchors: [
        {
          files: [
            { path: 'src/app/page.tsx', symbols: ['Page'], lines: { start: 1, end: 40 } },
            { path: 'src/components/Hero.tsx', symbols: ['Hero'] },
          ],
          primary_entry: 'src/app/page.tsx',
        },
      ],
    },
    {
      id: 'store',
      name: 'Store',
      description: 'zustand store',
      status: 'idle',
      container_id: 'data',
      code_anchors: [
        {
          files: [{ path: 'src/lib/store.ts', symbols: ['useAppStore'] }],
          primary_entry: 'src/lib/store.ts',
        },
      ],
    },
  ],
  edges: [
    { id: 'e1', source: 'page', target: 'store', type: 'sync' },
  ],
  audit_log: [],
  seed_state: {},
}

describe('deep-analyze/prompt-builder', () => {
  describe('collectAnchorPaths', () => {
    it('collects unique paths across all blocks, primary_entry first', () => {
      const paths = collectAnchorPaths(fixtureIr)
      expect(paths).toEqual([
        'src/app/page.tsx',
        'src/components/Hero.tsx',
        'src/lib/store.ts',
      ])
    })

    it('deduplicates when the same file appears in multiple anchors', () => {
      const dup: Ir = {
        ...fixtureIr,
        blocks: [
          ...fixtureIr.blocks,
          {
            id: 'page-test',
            name: 'Page tests',
            description: '',
            status: 'idle',
            container_id: 'ui',
            code_anchors: [
              {
                files: [
                  { path: 'src/app/page.tsx', symbols: [] },
                  { path: 'src/app/page.test.tsx', symbols: [] },
                ],
              },
            ],
          },
        ],
      }
      const paths = collectAnchorPaths(dup)
      expect(paths.filter((p) => p === 'src/app/page.tsx')).toHaveLength(1)
      expect(paths).toContain('src/app/page.test.tsx')
    })

    it('returns an empty list when no blocks have anchors', () => {
      const empty: Ir = { ...fixtureIr, blocks: [] }
      expect(collectAnchorPaths(empty)).toEqual([])
    })
  })

  describe('buildAnalystInput', () => {
    it.each(PERSPECTIVE_NAMES)('produces an envelope for %s', (name) => {
      const input = buildAnalystInput(name, fixtureIr, '/abs/project')
      expect(input.perspective).toBe(name)
      expect(input.projectRoot).toBe('/abs/project')
      expect(input.anchorPaths.length).toBeGreaterThan(0)
      expect(input.wordBudget).toBeGreaterThan(0)
      expect(input.irYaml).toContain('name: fixture-proj')
      expect(input.irYaml).toContain('Home Page')
    })

    it('respects custom word budget', () => {
      const input = buildAnalystInput('architect', fixtureIr, '/p', { wordBudget: 300 })
      expect(input.wordBudget).toBe(300)
    })
  })

  describe('renderAnalystMessage', () => {
    it.each(PERSPECTIVE_NAMES)('emits the 4 contract sections for %s', (name) => {
      const input = buildAnalystInput(name, fixtureIr, '/p')
      const msg = renderAnalystMessage(input)
      for (const section of PERSPECTIVE_SECTIONS[name]) {
        expect(msg).toContain(`## ${section}`)
      }
    })

    it('includes the IR yaml in a fenced block', () => {
      const input = buildAnalystInput('static', fixtureIr, '/p')
      const msg = renderAnalystMessage(input)
      expect(msg).toMatch(/```yaml[\s\S]+name: fixture-proj[\s\S]+```/)
    })

    it('includes anchor paths as a bulleted allow-list', () => {
      const input = buildAnalystInput('redteam', fixtureIr, '/p')
      const msg = renderAnalystMessage(input)
      expect(msg).toContain('- src/app/page.tsx')
      expect(msg).toContain('- src/lib/store.ts')
    })

    it('handles the no-anchors case without producing an empty allow-list', () => {
      const noAnchors: Ir = {
        ...fixtureIr,
        blocks: fixtureIr.blocks.map((b) => ({ ...b, code_anchors: [] })),
      }
      const input = buildAnalystInput('product', noAnchors, '/p')
      const msg = renderAnalystMessage(input)
      expect(msg).toContain('(none — block-level findings only)')
    })

    it('names the correct subagent in the title line', () => {
      const input = buildAnalystInput('reproducibility', fixtureIr, '/p')
      const msg = renderAnalystMessage(input)
      expect(msg).toMatch(/archviber-analyst-reproducibility/)
    })
  })

  describe('perspective contract', () => {
    it('defines exactly 5 perspectives', () => {
      expect(PERSPECTIVE_NAMES).toHaveLength(5)
    })

    it.each(PERSPECTIVE_NAMES)('%s declares exactly 4 output sections', (name) => {
      expect(PERSPECTIVE_SECTIONS[name]).toHaveLength(4)
    })

    it('has no duplicate section names across all perspectives', () => {
      const all = PERSPECTIVE_NAMES.flatMap((n: PerspectiveName) => PERSPECTIVE_SECTIONS[n])
      expect(new Set(all).size).toBe(all.length)
    })
  })
})
