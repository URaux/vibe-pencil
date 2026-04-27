/**
 * add-import verb — phase3/modify-add-import
 *
 * Inserts or merges an import statement in a TypeScript/JavaScript file.
 * Returns a RenamePlan (single fileEdit, no conflicts) so the caller can
 * apply via the existing apply.ts machinery.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { RenamePlan, FileEdit } from './rename'

export interface AddImportOptions {
  /** Absolute or project-relative path of the file to modify. */
  filePath: string
  /** Module specifier, e.g. 'react', './utils', '@/lib/foo'. */
  moduleSpecifier: string
  /** Named imports to add, e.g. ['useState', 'useEffect']. */
  named?: string[]
  /** Default import name, e.g. 'React'. */
  default?: string
}

function buildImportStatement(opts: AddImportOptions): string {
  const spec = opts.moduleSpecifier
  const named = opts.named ?? []
  const def = opts.default

  if (!def && named.length === 0) {
    // Side-effect import
    return `import '${spec}'\n`
  }

  const parts: string[] = []
  if (def) parts.push(def)
  if (named.length > 0) parts.push(`{ ${named.join(', ')} }`)
  return `import ${parts.join(', ')} from '${spec}'\n`
}

/** Returns the byte offset just after the last consecutive import line, or 0. */
function findImportInsertionOffset(source: string): number {
  const lines = source.split('\n')
  let lastImportLine = -1
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    if (trimmed.startsWith('import ') || trimmed.startsWith("import'") || trimmed.startsWith('import"')) {
      lastImportLine = i
    } else if (lastImportLine >= 0 && trimmed !== '') {
      // First non-empty, non-import line after imports — stop
      break
    }
  }

  if (lastImportLine === -1) return 0

  // Offset = sum of lengths of lines 0..lastImportLine (inclusive) + their \n
  let offset = 0
  for (let i = 0; i <= lastImportLine; i++) {
    offset += (lines[i]?.length ?? 0) + 1 // +1 for \n
  }
  return offset
}

interface ExistingImport {
  named: string[]
  defaultName: string | null
  /** Start offset of the full import statement. */
  start: number
  /** End offset (exclusive) of the full import statement (including \n). */
  end: number
  /** Full original text. */
  original: string
}

function parseExistingImports(source: string, specifier: string): ExistingImport | null {
  // Match: import [defaultName,] { named... } from 'specifier'
  // or: import defaultName from 'specifier'
  // or: import 'specifier' (side-effect)
  const escapedSpec = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `import\\s+((?:[^'"\\n]+?)\\s+from\\s+)?['"]${escapedSpec}['"][;\\s]*\\n?`,
    'g',
  )
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    const full = match[0]!
    const start = match.index
    const end = start + full.length
    const clausePart = match[1]?.trim() ?? ''

    if (!clausePart) {
      // Side-effect import
      return { named: [], defaultName: null, start, end, original: full }
    }

    // Strip 'from' suffix
    const clause = clausePart.replace(/\s+from\s*$/, '').trim()

    let defaultName: string | null = null
    const named: string[] = []

    const braceMatch = clause.match(/\{([^}]*)\}/)
    if (braceMatch) {
      const inside = braceMatch[1]!
      for (const n of inside.split(',').map((s) => s.trim()).filter(Boolean)) {
        named.push(n)
      }
      const beforeBrace = clause.slice(0, braceMatch.index!).replace(/,\s*$/, '').trim()
      if (beforeBrace) defaultName = beforeBrace
    } else {
      defaultName = clause || null
    }

    return { named, defaultName, start, end, original: full }
  }
  return null
}

function buildMergedImport(
  existing: ExistingImport,
  opts: AddImportOptions,
): string {
  const newNamed = opts.named ?? []
  const newDefault = opts.default

  const mergedDefault = newDefault ?? existing.defaultName
  const mergedNamed = [...new Set([...existing.named, ...newNamed])]

  const parts: string[] = []
  if (mergedDefault) parts.push(mergedDefault)
  if (mergedNamed.length > 0) parts.push(`{ ${mergedNamed.join(', ')} }`)

  if (parts.length === 0) return existing.original
  return `import ${parts.join(', ')} from '${opts.moduleSpecifier}'\n`
}

export async function planAddImport(
  projectRoot: string,
  opts: AddImportOptions,
): Promise<RenamePlan> {
  const absPath = path.isAbsolute(opts.filePath)
    ? opts.filePath
    : path.join(projectRoot, opts.filePath)

  let source: string
  try {
    source = await fs.readFile(absPath, 'utf8')
  } catch (err) {
    return {
      fileEdits: [],
      conflicts: [{ kind: 'not-found', message: `File not found: ${absPath}` }],
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  const existing = parseExistingImports(source, opts.moduleSpecifier)

  let edit: FileEdit['edits'][number]

  if (existing) {
    // Merge into existing import
    const merged = buildMergedImport(existing, opts)
    if (merged === existing.original) {
      // Nothing to change — return empty plan
      return {
        fileEdits: [],
        conflicts: [],
        safetyChecks: { tsConfigFound: true, allFilesInProject: true },
      }
    }
    edit = {
      start: existing.start,
      end: existing.end,
      original: existing.original,
      replacement: merged,
    }
  } else {
    // Insert new import after existing imports block
    const insertOffset = findImportInsertionOffset(source)
    const newImport = buildImportStatement(opts)
    edit = {
      start: insertOffset,
      end: insertOffset,
      original: '',
      replacement: newImport,
    }
  }

  return {
    fileEdits: [{ filePath: absPath, edits: [edit] }],
    conflicts: [],
    safetyChecks: { tsConfigFound: true, allFilesInProject: true },
  }
}
