import { describe, it, expect } from 'vitest'
import {
  irSchema,
  schemaDocumentToIr,
  irToSchemaDocument,
  UNGROUPED_CONTAINER_ID,
  IR_VERSION,
  type Ir,
  type SchemaDocument,
} from '@/lib/ir'

const fixedMetadata = {
  createdAt: '2026-04-14T00:00:00.000Z',
  updatedAt: '2026-04-14T00:00:00.000Z',
  archviberVersion: '0.1.0',
}

function schemaToIrWithFixedMeta(doc: SchemaDocument): Ir {
  return schemaDocumentToIr(doc, { metadata: fixedMetadata })
}

describe('ir schema validation', () => {
  it('accepts a minimal valid IR document', () => {
    const ir: Ir = {
      version: IR_VERSION,
      project: { name: 'Test', metadata: fixedMetadata },
      containers: [],
      blocks: [],
      edges: [],
      audit_log: [],
      seed_state: {},
    }
    expect(() => irSchema.parse(ir)).not.toThrow()
  })

  it('rejects unknown top-level fields (strict mode)', () => {
    const ir = {
      version: IR_VERSION,
      project: { name: 'Test', metadata: fixedMetadata },
      containers: [],
      blocks: [],
      edges: [],
      audit_log: [],
      seed_state: {},
      rogue_field: 'oops',
    }
    expect(() => irSchema.parse(ir)).toThrow()
  })

  it('rejects invalid edge type', () => {
    const ir = {
      version: IR_VERSION,
      project: { name: 'Test', metadata: fixedMetadata },
      containers: [],
      blocks: [],
      edges: [{ id: 'e1', source: 'a', target: 'b', type: 'invalid' }],
      audit_log: [],
      seed_state: {},
    }
    expect(() => irSchema.parse(ir)).toThrow()
  })

  it('accepts orphan blocks with container_id null', () => {
    const ir: Ir = {
      version: IR_VERSION,
      project: { name: 'Test', metadata: fixedMetadata },
      containers: [],
      blocks: [
        {
          id: 'blk_orphan',
          name: 'Orphan',
          description: '',
          status: 'idle',
          container_id: null,
          code_anchors: [],
        },
      ],
      edges: [],
      audit_log: [],
      seed_state: {},
    }
    expect(() => irSchema.parse(ir)).not.toThrow()
  })
})

describe('schemaDocumentToIr / irToSchemaDocument round-trip', () => {
  it('round-trips empty SchemaDocument', () => {
    const doc: SchemaDocument = { project: 'Empty', containers: [], edges: [] }
    const ir = schemaToIrWithFixedMeta(doc)
    const back = irToSchemaDocument(ir)
    expect(back).toEqual(doc)
  })

  it('round-trips container without blocks', () => {
    const doc: SchemaDocument = {
      project: 'Containers Only',
      containers: [{ id: 'c1', name: 'Services', color: 'purple', blocks: [] }],
      edges: [],
    }
    const ir = schemaToIrWithFixedMeta(doc)
    expect(ir.containers).toEqual([{ id: 'c1', name: 'Services', color: 'purple' }])
    expect(irToSchemaDocument(ir)).toEqual(doc)
  })

  it('round-trips grouped blocks', () => {
    const doc: SchemaDocument = {
      project: 'Grouped',
      containers: [
        {
          id: 'c1',
          name: 'Services',
          color: 'purple',
          blocks: [
            { id: 'b1', name: 'Auth', description: 'login flow', status: 'idle' },
            { id: 'b2', name: 'Session', description: '', status: 'building' },
          ],
        },
      ],
      edges: [],
    }
    const ir = schemaToIrWithFixedMeta(doc)
    expect(ir.blocks).toHaveLength(2)
    expect(ir.blocks.every((b) => b.container_id === 'c1')).toBe(true)
    expect(irToSchemaDocument(ir)).toEqual(doc)
  })

  // Targets Codex review blocker #1 — reverse migrator used to drop orphan blocks.
  it('reconstructs ungrouped bucket on reverse when orphans exist', () => {
    const doc: SchemaDocument = {
      project: 'Orphan Test',
      containers: [
        { id: 'c1', name: 'Services', color: 'purple', blocks: [] },
        {
          id: UNGROUPED_CONTAINER_ID,
          name: 'Ungrouped',
          color: 'slate',
          blocks: [{ id: 'orph1', name: 'Loose', description: '', status: 'idle' }],
        },
      ],
      edges: [],
    }
    const ir = schemaToIrWithFixedMeta(doc)
    // Synthetic ungrouped container is unpacked — orphan lives flat with container_id: null.
    expect(ir.containers.map((c) => c.id)).not.toContain(UNGROUPED_CONTAINER_ID)
    expect(ir.blocks.find((b) => b.id === 'orph1')?.container_id).toBeNull()
    // Reverse path rebuilds it.
    expect(irToSchemaDocument(ir)).toEqual(doc)
  })

  it('does not emit ungrouped container when no orphans exist', () => {
    const doc: SchemaDocument = {
      project: 'No Orphans',
      containers: [
        {
          id: 'c1',
          name: 'Services',
          color: 'purple',
          blocks: [{ id: 'b1', name: 'Auth', description: '', status: 'idle' }],
        },
      ],
      edges: [],
    }
    const ir = schemaToIrWithFixedMeta(doc)
    const back = irToSchemaDocument(ir)
    expect(back.containers.map((c) => c.id)).not.toContain(UNGROUPED_CONTAINER_ID)
    expect(back).toEqual(doc)
  })

  it('round-trips mix of grouped and orphan blocks', () => {
    const doc: SchemaDocument = {
      project: 'Mixed',
      containers: [
        {
          id: 'c1',
          name: 'Services',
          color: 'purple',
          blocks: [{ id: 'b1', name: 'Auth', description: '', status: 'idle' }],
        },
        {
          id: UNGROUPED_CONTAINER_ID,
          name: 'Ungrouped',
          color: 'slate',
          blocks: [{ id: 'orph1', name: 'Loose', description: '', status: 'idle' }],
        },
      ],
      edges: [],
    }
    const ir = schemaToIrWithFixedMeta(doc)
    expect(irToSchemaDocument(ir)).toEqual(doc)
  })

  it('preserves edges with and without labels', () => {
    const doc: SchemaDocument = {
      project: 'Edges',
      containers: [
        {
          id: 'c1',
          name: 'S',
          color: 'blue',
          blocks: [
            { id: 'a', name: 'A', description: '', status: 'idle' },
            { id: 'b', name: 'B', description: '', status: 'idle' },
          ],
        },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'sync' },
        { id: 'e2', source: 'b', target: 'a', type: 'async', label: 'callback' },
      ],
    }
    const ir = schemaToIrWithFixedMeta(doc)
    expect(irToSchemaDocument(ir)).toEqual(doc)
  })

  it('preserves optional block fields (schema, techStack, summary, errorMessage)', () => {
    const doc: SchemaDocument = {
      project: 'Optionals',
      containers: [
        {
          id: 'c1',
          name: 'Data',
          color: 'amber',
          blocks: [
            {
              id: 'b1',
              name: 'UsersTable',
              description: 'primary users',
              status: 'done',
              schema: {
                tables: [
                  {
                    name: 'users',
                    columns: [{ name: 'id', type: 'uuid', constraints: { primary: true } }],
                  },
                ],
              },
              schemaRefs: ['orders.user_id'],
              schemaFieldRefs: { users: ['id', 'email'] },
              techStack: 'postgres',
              summary: 'built successfully',
              errorMessage: undefined,
            } as SchemaDocument['containers'][number]['blocks'][number],
          ],
        },
      ],
      edges: [],
    }
    const ir = schemaToIrWithFixedMeta(doc)
    expect(irToSchemaDocument(ir)).toEqual(doc)
  })

  it('normalizes unknown block status to idle on forward migrate', () => {
    const doc: SchemaDocument = {
      project: 'Weird Status',
      containers: [
        {
          id: 'c1',
          name: 'S',
          color: 'blue',
          blocks: [{ id: 'b1', name: 'X', description: '', status: 'bogus' }],
        },
      ],
      edges: [],
    }
    const ir = schemaToIrWithFixedMeta(doc)
    expect(ir.blocks[0].status).toBe('idle')
  })

  it('returns byte-identical IR when forward-migrated twice from same input', () => {
    const doc: SchemaDocument = {
      project: 'Determinism',
      containers: [
        {
          id: 'c1',
          name: 'S',
          color: 'blue',
          blocks: [{ id: 'b1', name: 'A', description: '', status: 'idle' }],
        },
      ],
      edges: [{ id: 'e1', source: 'b1', target: 'b1', type: 'sync' }],
    }
    const ir1 = schemaToIrWithFixedMeta(doc)
    const ir2 = schemaToIrWithFixedMeta(doc)
    expect(JSON.stringify(ir1)).toEqual(JSON.stringify(ir2))
  })

  it('preserves IDs through round-trip (no prefixing)', () => {
    const doc: SchemaDocument = {
      project: 'ID Preservation',
      containers: [
        {
          id: 'canvas-editor',
          name: 'Canvas Editor',
          color: 'blue',
          blocks: [{ id: 'store', name: 'Store', description: '', status: 'idle' }],
        },
      ],
      edges: [],
    }
    const ir = schemaToIrWithFixedMeta(doc)
    expect(ir.containers[0].id).toBe('canvas-editor')
    expect(ir.blocks[0].id).toBe('store')
    const back = irToSchemaDocument(ir)
    expect(back.containers[0].id).toBe('canvas-editor')
    expect(back.containers[0].blocks[0].id).toBe('store')
  })
})
