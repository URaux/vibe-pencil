import { z } from 'zod'

export const IR_VERSION = '1.0' as const

const containerColorSchema = z.enum(['blue', 'green', 'purple', 'amber', 'rose', 'slate'])

const blockStatusSchema = z.enum(['idle', 'building', 'done', 'error'])

const edgeTypeSchema = z.enum(['sync', 'async', 'bidirectional'])

const columnConstraintsSchema = z
  .object({
    primary: z.boolean().optional(),
    unique: z.boolean().optional(),
    notNull: z.boolean().optional(),
    default: z.string().optional(),
    foreign: z
      .object({
        table: z.string(),
        column: z.string(),
      })
      .optional(),
  })
  .strict()

const schemaColumnSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    constraints: columnConstraintsSchema.optional(),
  })
  .strict()

const schemaIndexSchema = z
  .object({
    name: z.string(),
    columns: z.array(z.string()),
    unique: z.boolean().optional(),
  })
  .strict()

const schemaTableSchema = z
  .object({
    name: z.string(),
    columns: z.array(schemaColumnSchema),
    indexes: z.array(schemaIndexSchema).optional(),
  })
  .strict()

const blockSchemaSchema = z.object({ tables: z.array(schemaTableSchema) }).strict()

export const codeAnchorSchema = z
  .object({
    files: z.array(
      z
        .object({
          path: z.string(),
          symbols: z.array(z.string()).default([]),
          lines: z
            .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
            .optional(),
        })
        .strict()
    ),
    primary_entry: z.string().optional(),
  })
  .strict()

export const irContainerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: containerColorSchema,
  })
  .strict()

export const irBlockSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().default(''),
    status: blockStatusSchema.default('idle'),
    container_id: z.string().nullable(),
    schema: blockSchemaSchema.optional(),
    schema_refs: z.array(z.string()).optional(),
    schema_field_refs: z.record(z.string(), z.array(z.string())).optional(),
    tech_stack: z.string().optional(),
    summary: z.string().optional(),
    error_message: z.string().optional(),
    code_anchors: z.array(codeAnchorSchema).default([]),
  })
  .strict()

export const irEdgeSchema = z
  .object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    type: edgeTypeSchema,
    label: z.string().optional(),
  })
  .strict()

export const auditEntrySchema = z
  .object({
    timestamp: z.string(),
    action: z.string(),
    actor: z.string(),
    details: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export const seedStateSchema = z
  .object({
    tree_sitter_version: z.string().optional(),
    grammar_shas: z.record(z.string(), z.string()).optional(),
    louvain_seed: z.number().int().optional(),
    ingest_version: z.string().optional(),
    prompt_versions: z.record(z.string(), z.string()).optional(),
    model_ids: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export const irProjectMetadataSchema = z
  .object({
    createdAt: z.string(),
    updatedAt: z.string(),
    archviberVersion: z.string().default('0.1.0'),
  })
  .strict()

export const irSchema = z
  .object({
    version: z.literal(IR_VERSION),
    project: z
      .object({
        name: z.string(),
        metadata: irProjectMetadataSchema,
      })
      .strict(),
    containers: z.array(irContainerSchema).default([]),
    blocks: z.array(irBlockSchema).default([]),
    edges: z.array(irEdgeSchema).default([]),
    audit_log: z.array(auditEntrySchema).default([]),
    seed_state: seedStateSchema.default({}),
    policies: z.unknown().optional(),
  })
  .strict()

export type CodeAnchor = z.infer<typeof codeAnchorSchema>
export type IrContainer = z.infer<typeof irContainerSchema>
export type IrBlock = z.infer<typeof irBlockSchema>
export type IrEdge = z.infer<typeof irEdgeSchema>
export type IrAuditEntry = z.infer<typeof auditEntrySchema>
export type IrSeedState = z.infer<typeof seedStateSchema>
export type IrProjectMetadata = z.infer<typeof irProjectMetadataSchema>
export type Ir = z.infer<typeof irSchema>

export const UNGROUPED_CONTAINER_ID = 'ungrouped' as const
