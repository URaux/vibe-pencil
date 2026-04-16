import { parse } from 'yaml'
import type { Edge, Node } from '@xyflow/react'
import { canvasToYaml } from '@/lib/schema-engine'
import type { CanvasNodeData } from '@/lib/types'
import type { Ir } from './schema'
import {
  schemaDocumentToIr,
  type SchemaDocument,
  type SchemaDocumentToIrOptions,
} from './migrate'

// Round-trip Canvas state through the authoritative canvasToYaml to get a
// SchemaDocument, then migrate into IR. We parse canvasToYaml's output instead
// of duplicating its logic to keep schema-engine.ts as the single source of
// truth for canvas serialization.
export function canvasToSchemaDocument(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  projectName: string
): SchemaDocument {
  const yaml = canvasToYaml(nodes, edges, projectName)
  return parse(yaml) as SchemaDocument
}

export function canvasToIr(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  projectName: string,
  options: SchemaDocumentToIrOptions = {}
): Ir {
  const doc = canvasToSchemaDocument(nodes, edges, projectName)
  return schemaDocumentToIr(doc, options)
}
