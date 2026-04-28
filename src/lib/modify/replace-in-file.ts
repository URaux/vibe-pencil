import fs from 'node:fs/promises'
import path from 'node:path'
import type { RenamePlan, FileEdit, RenameConflict } from './types'

export interface ReplaceInFileRequest {
  filePath: string
  pattern: string
  replacement: string
  flags?: string
}

export class InvalidPatternError extends Error {
  readonly kind = 'invalid-pattern' as const
  constructor(message: string) {
    super(message)
    this.name = 'InvalidPatternError'
  }
}

export class FileNotFoundError extends Error {
  readonly kind = 'file-not-found' as const
  constructor(filePath: string) {
    super(`file not found: ${filePath}`)
    this.name = 'FileNotFoundError'
  }
}

const ALLOWED_FLAGS_RE = /^[gimsuy]*$/

export async function planReplaceInFile(
  projectRoot: string,
  req: ReplaceInFileRequest,
): Promise<RenamePlan> {
  const conflicts: RenameConflict[] = []
  const flags = req.flags ?? 'g'

  if (!ALLOWED_FLAGS_RE.test(flags)) {
    throw new InvalidPatternError(
      `invalid regex flags: "${flags}" — only g, i, m, s, u, y are allowed`,
    )
  }

  try {
    new RegExp(req.pattern, flags)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new InvalidPatternError(`invalid regex pattern "${req.pattern}": ${msg}`)
  }

  const absPath = path.isAbsolute(req.filePath)
    ? req.filePath
    : path.join(projectRoot, req.filePath)

  let content: string
  try {
    content = await fs.readFile(absPath, 'utf8')
  } catch {
    throw new FileNotFoundError(req.filePath)
  }

  const edits: FileEdit['edits'] = []

  // Use separate regex objects: execRegex (always global) for the exec loop,
  // replaceRegex (non-global) for computing replacement strings.
  // Critical: if both were the same global regex object, calling .replace() on it
  // would reset lastIndex to 0 after each match, causing an infinite loop.
  const execFlags = flags.includes('g') ? flags : flags + 'g'
  const execRegex = new RegExp(req.pattern, execFlags)
  const replaceRegex = new RegExp(req.pattern, flags.replace('g', ''))

  let match: RegExpExecArray | null
  while ((match = execRegex.exec(content)) !== null) {
    const start = match.index
    const end = start + match[0].length
    const original = match[0]
    const replacement = original.replace(replaceRegex, req.replacement)
    edits.push({ start, end, original, replacement })
    if (match[0].length === 0) {
      execRegex.lastIndex++
    }
  }

  if (edits.length === 0) {
    conflicts.push({
      kind: 'not-found',
      message: `pattern "${req.pattern}" matched 0 occurrences in ${req.filePath}`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  const fileEdit: FileEdit = { filePath: absPath, edits }
  return {
    fileEdits: [fileEdit],
    conflicts: [],
    safetyChecks: { tsConfigFound: false, allFilesInProject: false },
  }
}
