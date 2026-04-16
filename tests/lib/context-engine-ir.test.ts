import { describe, it, expect, vi } from 'vitest'
import { buildSystemContext } from '@/lib/context-engine'
import type { Ir } from '@/lib/ir'
import { IR_VERSION } from '@/lib/ir'

const fixedMetadata = {
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
  archviberVersion: '0.1.0',
}

const sampleIr: Ir = {
  version: IR_VERSION,
  project: { name: 'TestProject', metadata: fixedMetadata },
  containers: [{ id: 'c1', name: 'Backend', color: 'green' }],
  blocks: [
    {
      id: 'b1',
      name: 'API Server',
      description: 'REST API',
      status: 'idle',
      container_id: 'c1',
      code_anchors: [],
    },
  ],
  edges: [],
  audit_log: [],
  seed_state: {},
}

const baseOptions = {
  agentType: 'canvas' as const,
  task: 'discuss' as const,
  locale: 'en' as const,
}

describe('buildSystemContext with IR', () => {
  it('uses IR-derived yaml when ir is provided', () => {
    const context = buildSystemContext({
      ...baseOptions,
      canvasYaml: 'should-not-appear: true',
      ir: sampleIr,
    })

    // IR YAML contains project name and block name
    expect(context).toContain('TestProject')
    expect(context).toContain('API Server')
    // In-memory canvas yaml must be replaced
    expect(context).not.toContain('should-not-appear')
  })

  it('falls back to canvasYaml when ir is null', () => {
    const context = buildSystemContext({
      ...baseOptions,
      canvasYaml: 'fallback-content: true',
      ir: null,
    })

    expect(context).toContain('fallback-content')
  })

  it('falls back to canvasYaml when ir is undefined', () => {
    const context = buildSystemContext({
      ...baseOptions,
      canvasYaml: 'fallback-content: true',
    })

    expect(context).toContain('fallback-content')
  })

  it('does not crash when ir fails Zod validation; falls back to canvasYaml and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const badIr = { version: '9.9', project: { name: 'bad' } } as unknown as Ir

    let context: string
    expect(() => {
      context = buildSystemContext({
        ...baseOptions,
        canvasYaml: 'canvas-fallback: true',
        ir: badIr,
      })
    }).not.toThrow()

    expect(context!).toContain('canvas-fallback')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[context-engine] IR validation failed'),
      expect.anything()
    )

    warnSpy.mockRestore()
  })

  it('builds normally with no canvasYaml and no ir', () => {
    const context = buildSystemContext({
      ...baseOptions,
    })

    // Should still produce a valid context with identity and task layers
    expect(context).toContain('ArchViber')
    expect(context).toContain('# Task')
  })

  it('uses IR in lean (claude-code) mode', () => {
    const context = buildSystemContext({
      ...baseOptions,
      backend: 'claude-code',
      canvasYaml: 'should-not-appear: true',
      ir: sampleIr,
    })

    expect(context).toContain('API Server')
    expect(context).not.toContain('should-not-appear')
  })
})
