import { promises as fs } from 'fs'
import path from 'path'
import { parse, stringify } from 'yaml'
import type { Ir } from './schema'
import { irSchema } from './schema'

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

export async function readIrFile(projectRoot: string): Promise<Ir | null> {
  const filePath = irFilePath(projectRoot)

  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  return parseIr(raw)
}

export function parseIr(raw: string): Ir {
  const parsed = parse(raw) as unknown
  const result = irSchema.safeParse(parsed)
  if (!result.success) {
    throw new IrValidationError('IR validation failed', result.error.issues)
  }
  return result.data
}

export async function writeIrFile(projectRoot: string, ir: Ir): Promise<string> {
  const validated = irSchema.parse(ir)
  const filePath = irFilePath(projectRoot)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const yaml = serializeIr(validated)
  await fs.writeFile(filePath, yaml, 'utf8')
  return filePath
}

export function serializeIr(ir: Ir): string {
  return stringify(ir)
}
