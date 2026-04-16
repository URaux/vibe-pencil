import { describe, it, expect } from 'vitest'
import { parse, stringify } from 'yaml'
import {
  irSchema,
  schemaDocumentToIr,
  irToSchemaDocument,
  IR_VERSION,
  UNGROUPED_CONTAINER_ID,
  type SchemaDocument,
} from '@/lib/ir'

// W1 backward-compat verification — load legacy SchemaDocument YAMLs (pre-IR),
// run schemaDocumentToIr, validate against irSchema, check defaults,
// and round-trip via irToSchemaDocument.

const fixtures: Record<string, string> = {
  // 1. Minimal: project only, no containers/edges
  minimal: `
project: Empty Project
containers: []
edges: []
`.trim(),

  // 2. Flat: a single container with a few blocks, no edges
  flat: `
project: Legacy Flat
containers:
  - id: services
    name: Services
    color: purple
    blocks:
      - id: auth
        name: AuthService
        description: handles login
        status: idle
      - id: users
        name: UsersService
        description: ''
        status: done
edges: []
`.trim(),

  // 3. Orphan blocks in synthetic "ungrouped" container
  orphan: `
project: With Orphans
containers:
  - id: core
    name: Core
    color: blue
    blocks:
      - id: api
        name: API
        description: ''
        status: idle
  - id: ${UNGROUPED_CONTAINER_ID}
    name: Ungrouped
    color: slate
    blocks:
      - id: loose
        name: LooseBlock
        description: no home
        status: building
edges: []
`.trim(),

  // 4. Full-featured: containers, blocks with optional fields, edges with labels
  full: `
project: E-Commerce Legacy
containers:
  - id: frontend
    name: Frontend
    color: blue
    blocks:
      - id: web
        name: Web App
        description: consumer-facing SPA
        status: idle
        techStack: Next.js
        summary: shipped v1
  - id: backend
    name: Backend
    color: green
    blocks:
      - id: orders
        name: OrdersService
        description: handles checkout
        status: done
        techStack: Go
        schema:
          tables:
            - name: orders
              columns:
                - name: id
                  type: uuid
                  constraints:
                    primary: true
                - name: user_id
                  type: uuid
        schemaRefs:
          - users.id
        schemaFieldRefs:
          users:
            - id
            - email
edges:
  - id: e1
    source: web
    target: orders
    type: sync
    label: POST /orders
  - id: e2
    source: orders
    target: web
    type: async
`.trim(),

  // 5. Unknown/weird values that migrator should normalize
  weird: `
project: Weird Legacy
containers:
  - id: c1
    name: Mixed
    color: chartreuse
    blocks:
      - id: b1
        name: Bogus
        description: ''
        status: in_progress
edges:
  - id: e1
    source: b1
    target: b1
    type: weird_type
`.trim(),
}

describe('W1 backward-compat: legacy SchemaDocument YAML -> IR', () => {
  for (const [name, yaml] of Object.entries(fixtures)) {
    describe(`fixture: ${name}`, () => {
      const doc = parse(yaml) as SchemaDocument

      it('migrator produces irSchema-valid output', () => {
        const ir = schemaDocumentToIr(doc)
        const result = irSchema.safeParse(ir)
        if (!result.success) {
          console.error(`[${name}] validation issues:`, JSON.stringify(result.error.issues, null, 2))
        }
        expect(result.success).toBe(true)
      })

      it('has current IR_VERSION', () => {
        const ir = schemaDocumentToIr(doc)
        expect(ir.version).toBe(IR_VERSION)
      })

      it('has defaulted empty/valid audit_log, seed_state, metadata', () => {
        const ir = schemaDocumentToIr(doc)
        expect(ir.audit_log).toEqual([])
        expect(ir.seed_state).toEqual({})
        expect(ir.project.metadata.archviberVersion).toBe('0.1.0')
        expect(typeof ir.project.metadata.createdAt).toBe('string')
        expect(typeof ir.project.metadata.updatedAt).toBe('string')
      })

      it('every block has empty code_anchors by default', () => {
        const ir = schemaDocumentToIr(doc)
        for (const block of ir.blocks) {
          expect(block.code_anchors).toEqual([])
        }
      })

      it('policies field is absent (optional unknown)', () => {
        const ir = schemaDocumentToIr(doc)
        expect(ir.policies).toBeUndefined()
      })

      it('round-trips schemaDocumentToIr -> irToSchemaDocument', () => {
        const ir = schemaDocumentToIr(doc)
        const back = irToSchemaDocument(ir)

        // For "weird" fixture, migrator normalizes values (color chartreuse -> blue,
        // status in_progress -> idle, type weird_type -> sync). Those fields
        // lossfully change in both passes — check post-normalization equality.
        if (name === 'weird') {
          const normalized: SchemaDocument = {
            ...doc,
            containers: doc.containers.map((c) => ({
              ...c,
              color: 'blue',
              blocks: c.blocks.map((b) => ({ ...b, status: 'idle' })),
            })),
            edges: doc.edges.map((e) => ({ ...e, type: 'sync' })),
          }
          expect(back).toEqual(normalized)
        } else {
          expect(back).toEqual(doc)
        }
      })

      it('YAML -> IR -> YAML produces parseable output', () => {
        const ir = schemaDocumentToIr(doc)
        const yamlOut = stringify(ir)
        expect(() => parse(yamlOut)).not.toThrow()
        const reparsed = parse(yamlOut)
        expect(() => irSchema.parse(reparsed)).not.toThrow()
      })
    })
  }
})
