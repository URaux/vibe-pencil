import { promises as fs } from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { Ir, IrAuditEntry } from './schema'
import { irSchema } from './schema'
import { parseIr, serializeIr, irFilePath, IR_DIR_NAME, IR_FILE_NAME } from './serialize'

const execFileAsync = promisify(execFile)

const AUDIT_LOG_MAX = 100

export {
  IrValidationError,
  parseIr,
  serializeIr,
  irFilePath,
  IR_DIR_NAME,
  IR_FILE_NAME,
} from './serialize'

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

/**
 * Ensure `.archviber/` exists with a `.gitignore` that excludes `cache/`.
 * Safe to call repeatedly; will not overwrite an existing `.gitignore`.
 */
export async function ensureArchviberDir(projectRoot: string): Promise<string> {
  const dir = path.join(projectRoot, IR_DIR_NAME)
  await fs.mkdir(dir, { recursive: true })
  const gitignorePath = path.join(dir, '.gitignore')
  try {
    await fs.access(gitignorePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.writeFile(gitignorePath, 'cache/\n', 'utf8')
    } else {
      throw error
    }
  }
  return dir
}

/**
 * Resolve the current git HEAD SHA for the given dir, or `undefined` if the
 * dir is not a git repo / git is not installed / HEAD is unborn.
 */
async function getGitHeadSha(projectRoot: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'])
    const sha = stdout.trim()
    return sha.length > 0 ? sha : undefined
  } catch {
    return undefined
  }
}

function appendAuditEntry(ir: Ir, commit: string | undefined): Ir {
  const entry: IrAuditEntry = {
    timestamp: new Date().toISOString(),
    action: 'save',
    actor: 'archviber',
    details: commit ? { commit } : {},
  }
  const next = [...(ir.audit_log ?? []), entry]
  const trimmed = next.length > AUDIT_LOG_MAX ? next.slice(next.length - AUDIT_LOG_MAX) : next
  return { ...ir, audit_log: trimmed }
}

export async function writeIrFile(projectRoot: string, ir: Ir): Promise<string> {
  // Validate input before any side effects.
  irSchema.parse(ir)

  await ensureArchviberDir(projectRoot)

  const commit = await getGitHeadSha(projectRoot)
  const withAudit = appendAuditEntry(ir, commit)
  const validated = irSchema.parse(withAudit)

  const filePath = irFilePath(projectRoot)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const yaml = serializeIr(validated)

  const tmpPath = `${filePath}.tmp`
  try {
    await fs.writeFile(tmpPath, yaml, 'utf8')
    await fs.rename(tmpPath, filePath)
  } catch (error) {
    // Best-effort cleanup of the tmp file; ignore if it never existed.
    try {
      await fs.unlink(tmpPath)
    } catch {
      /* swallow */
    }
    throw error
  }
  return filePath
}

/**
 * Save IR to disk. Alias of writeIrFile, matching the PLAN W1.D4 contract.
 */
export const saveIr = writeIrFile
