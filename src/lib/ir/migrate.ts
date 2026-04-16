import type { Ir, IrBlock, IrContainer, IrEdge } from './schema'
import { IR_VERSION, UNGROUPED_CONTAINER_ID } from './schema'

// SchemaDocument shape — intentionally mirrored from schema-engine.ts.
// Kept local to avoid a circular dep through schema-engine → ir → schema-engine.
interface SerializedBlock {
  id: string
  name: string
  description: string
  status: string
  schema?: IrBlock['schema']
  schemaRefs?: string[]
  schemaFieldRefs?: Record<string, string[]>
  techStack?: string
  summary?: string
  errorMessage?: string
}

interface SerializedContainer {
  id: string
  name: string
  color: string
  blocks: SerializedBlock[]
}

interface SerializedEdge {
  id: string
  source: string
  target: string
  type: string
  label?: string
}

export interface SchemaDocument {
  project: string
  containers: SerializedContainer[]
  edges: SerializedEdge[]
}

const BLOCK_STATUSES = new Set<IrBlock['status']>(['idle', 'building', 'done', 'error'])
const EDGE_TYPES = new Set<IrEdge['type']>(['sync', 'async', 'bidirectional'])
const CONTAINER_COLORS = new Set<IrContainer['color']>([
  'blue',
  'green',
  'purple',
  'amber',
  'rose',
  'slate',
])

function normalizeStatus(status: string): IrBlock['status'] {
  return BLOCK_STATUSES.has(status as IrBlock['status']) ? (status as IrBlock['status']) : 'idle'
}

function normalizeEdgeType(type: string): IrEdge['type'] {
  return EDGE_TYPES.has(type as IrEdge['type']) ? (type as IrEdge['type']) : 'sync'
}

function normalizeContainerColor(color: string): IrContainer['color'] {
  return CONTAINER_COLORS.has(color as IrContainer['color'])
    ? (color as IrContainer['color'])
    : 'blue'
}

function serializedBlockToIr(block: SerializedBlock, containerId: string | null): IrBlock {
  const ir: IrBlock = {
    id: block.id,
    name: block.name,
    description: block.description ?? '',
    status: normalizeStatus(block.status ?? 'idle'),
    container_id: containerId,
    code_anchors: [],
  }

  if (block.schema) ir.schema = block.schema
  if (block.schemaRefs && block.schemaRefs.length > 0) ir.schema_refs = block.schemaRefs
  if (block.schemaFieldRefs && Object.keys(block.schemaFieldRefs).length > 0) {
    ir.schema_field_refs = block.schemaFieldRefs
  }
  if (block.techStack) ir.tech_stack = block.techStack
  if (block.summary) ir.summary = block.summary
  if (block.errorMessage) ir.error_message = block.errorMessage

  return ir
}

function irBlockToSerialized(block: IrBlock): SerializedBlock {
  const out: SerializedBlock = {
    id: block.id,
    name: block.name,
    description: block.description,
    status: block.status,
  }

  if (block.schema) out.schema = block.schema
  if (block.schema_refs && block.schema_refs.length > 0) out.schemaRefs = block.schema_refs
  if (block.schema_field_refs && Object.keys(block.schema_field_refs).length > 0) {
    out.schemaFieldRefs = block.schema_field_refs
  }
  if (block.tech_stack) out.techStack = block.tech_stack
  if (block.summary) out.summary = block.summary
  if (block.error_message) out.errorMessage = block.error_message

  return out
}

export interface SchemaDocumentToIrOptions {
  projectName?: string
  metadata?: Partial<Ir['project']['metadata']>
  auditLog?: Ir['audit_log']
  seedState?: Ir['seed_state']
}

// Forward migration: SchemaDocument → IR.
// The synthetic `ungrouped` container is unpacked; its blocks become orphan blocks
// (`container_id: null`). Real containers pass through unchanged.
export function schemaDocumentToIr(doc: SchemaDocument, options: SchemaDocumentToIrOptions = {}): Ir {
  const now = new Date().toISOString()

  const containers: IrContainer[] = []
  const blocks: IrBlock[] = []

  for (const container of doc.containers) {
    if (container.id === UNGROUPED_CONTAINER_ID) {
      for (const block of container.blocks) {
        blocks.push(serializedBlockToIr(block, null))
      }
      continue
    }

    containers.push({
      id: container.id,
      name: container.name,
      color: normalizeContainerColor(container.color),
    })

    for (const block of container.blocks) {
      blocks.push(serializedBlockToIr(block, container.id))
    }
  }

  const edges: IrEdge[] = doc.edges.map((edge) => {
    const mapped: IrEdge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: normalizeEdgeType(edge.type ?? 'sync'),
    }
    if (edge.label) mapped.label = edge.label
    return mapped
  })

  return {
    version: IR_VERSION,
    project: {
      name: options.projectName ?? doc.project,
      metadata: {
        createdAt: options.metadata?.createdAt ?? now,
        updatedAt: options.metadata?.updatedAt ?? now,
        archviberVersion: options.metadata?.archviberVersion ?? '0.1.0',
      },
    },
    containers,
    blocks,
    edges,
    audit_log: options.auditLog ?? [],
    seed_state: options.seedState ?? {},
  }
}

// Reverse migration: IR → SchemaDocument.
// Orphan blocks (container_id === null) are reconstructed into the synthetic `ungrouped` bucket
// only when non-empty, matching canvasToYaml's behavior in schema-engine.ts.
export function irToSchemaDocument(ir: Ir): SchemaDocument {
  const byContainer = new Map<string, SerializedBlock[]>()
  const orphans: SerializedBlock[] = []

  for (const block of ir.blocks) {
    const serialized = irBlockToSerialized(block)
    if (block.container_id === null) {
      orphans.push(serialized)
      continue
    }

    const bucket = byContainer.get(block.container_id)
    if (bucket) {
      bucket.push(serialized)
    } else {
      byContainer.set(block.container_id, [serialized])
    }
  }

  const containers: SerializedContainer[] = ir.containers.map((container) => ({
    id: container.id,
    name: container.name,
    color: container.color,
    blocks: byContainer.get(container.id) ?? [],
  }))

  if (orphans.length > 0) {
    containers.push({
      id: UNGROUPED_CONTAINER_ID,
      name: 'Ungrouped',
      color: 'slate',
      blocks: orphans,
    })
  }

  const edges: SerializedEdge[] = ir.edges.map((edge) => {
    const mapped: SerializedEdge = {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
    }
    if (edge.label) mapped.label = edge.label
    return mapped
  })

  return {
    project: ir.project.name,
    containers,
    edges,
  }
}
