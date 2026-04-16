import { parse, stringify } from 'yaml'
import path from 'path'
import type { Ir } from './schema'
import { irSchema } from './schema'

// Browser-safe IR serialization. No fs imports — the server-only read/write
// paths live in persist.ts and import from here. path is ok here: webpack
// polyfills path-browserify automatically for client bundles.

export const IR_DIR_NAME = '.archviber'
export const IR_FILE_NAME = 'ir.yaml'

export function irFilePath(projectRoot: string): string {
  return path.join(projectRoot, IR_DIR_NAME, IR_FILE_NAME)
}

export class IrValidationError extends Error {
  readonly issues: unknown

  constructor(message: string, issues: unknown) {
    super(message)
    this.name = 'IrValidationError'
    this.issues = issues
  }
}

export function parseIr(raw: string): Ir {
  const parsed = parse(raw) as unknown
  const result = irSchema.safeParse(parsed)
  if (!result.success) {
    throw new IrValidationError('IR validation failed', result.error.issues)
  }
  return result.data
}

export function serializeIr(ir: Ir): string {
  return stringify(ir)
}
