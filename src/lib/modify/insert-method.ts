/**
 * Insert method — Modify v0.4.
 *
 * Finds a named class in a TypeScript file and inserts a new method into it.
 * Returns a RenamePlan-shaped result compatible with applyRenamePlan/runSandbox.
 *
 * Placement options:
 *   default (position omitted)  → append at end of class body
 *   position: 'before:<name>'   → insert immediately before the named method
 */

import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { RenamePlan, FileEdit, RenameConflict } from './rename'

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const BEFORE_RE = /^before:([A-Za-z_$][A-Za-z0-9_$]*)$/

export interface InsertMethodRequest {
  filePath: string
  className: string
  methodName: string
  body: string
  position?: string // e.g. 'before:existingMethod'
}

export async function planInsertMethod(
  projectRoot: string,
  req: InsertMethodRequest,
): Promise<RenamePlan> {
  const conflicts: RenameConflict[] = []

  if (!IDENTIFIER_RE.test(req.className)) {
    conflicts.push({ kind: 'reserved', message: `"${req.className}" is not a valid class name` })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound: false, allFilesInProject: false } }
  }

  if (!IDENTIFIER_RE.test(req.methodName)) {
    conflicts.push({ kind: 'reserved', message: `"${req.methodName}" is not a valid method name` })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound: false, allFilesInProject: false } }
  }

  let beforeMethod: string | null = null
  if (req.position !== undefined && req.position !== '') {
    const m = BEFORE_RE.exec(req.position)
    if (!m) {
      conflicts.push({
        kind: 'reserved',
        message: `invalid position "${req.position}"; expected 'before:<methodName>' or omit`,
      })
      return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound: false, allFilesInProject: false } }
    }
    beforeMethod = m[1]
  }

  const absPath = path.isAbsolute(req.filePath) ? req.filePath : path.join(projectRoot, req.filePath)

  try {
    await fs.access(absPath)
  } catch {
    conflicts.push({ kind: 'not-found', message: `file not found: ${req.filePath}` })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound: false, allFilesInProject: false } }
  }

  const tsConfigPath = path.join(projectRoot, 'tsconfig.json')
  let tsConfigFound = false
  try {
    await fs.access(tsConfigPath)
    tsConfigFound = true
  } catch { /* no tsconfig */ }

  const project = tsConfigFound
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: false })
    : new Project({ compilerOptions: { allowJs: true } })

  if (!tsConfigFound) {
    project.addSourceFilesAtPaths(path.join(projectRoot, '**/*.{ts,tsx,js,jsx}'))
  }

  const sourceFile = project.getSourceFile(absPath) ?? project.addSourceFileAtPath(absPath)

  const classDecl = sourceFile.getClasses().find((c) => c.getName() === req.className)
  if (!classDecl) {
    conflicts.push({ kind: 'not-found', message: `class "${req.className}" not found in ${req.filePath}` })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound, allFilesInProject: true } }
  }

  // Check method does not already exist
  const existingMethod = classDecl.getMethod(req.methodName)
  if (existingMethod) {
    conflicts.push({ kind: 'collision', message: `method "${req.methodName}" already exists in class "${req.className}"` })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound, allFilesInProject: true } }
  }

  // Determine insertion position
  let insertAt: number

  if (beforeMethod !== null) {
    const anchorMember = classDecl.getMembers().find(
      (m) =>
        m.isKind(SyntaxKind.MethodDeclaration) &&
        m.asKindOrThrow(SyntaxKind.MethodDeclaration).getName() === beforeMethod,
    )
    if (!anchorMember) {
      conflicts.push({ kind: 'not-found', message: `anchor method "${beforeMethod}" not found in class "${req.className}"` })
      return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound, allFilesInProject: true } }
    }
    insertAt = anchorMember.getStart()
  } else {
    // Append before the closing brace of the class
    const closingBrace = classDecl.getLastChildByKind(SyntaxKind.CloseBraceToken)
    if (!closingBrace) {
      conflicts.push({ kind: 'external', message: 'could not locate class closing brace' })
      return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound, allFilesInProject: true } }
    }
    insertAt = closingBrace.getStart()
  }

  // Determine indentation from existing members
  const originalText = sourceFile.getFullText()
  const classStart = classDecl.getStart()
  const classBodyText = originalText.slice(classStart, classDecl.getEnd())
  const indentMatch = /\n([ \t]+)\S/.exec(classBodyText)
  const indent = indentMatch ? indentMatch[1] : '  '

  const newMethod = `${indent}${req.body.trimEnd()}\n`

  const edit: FileEdit = {
    filePath: absPath,
    edits: [
      {
        start: insertAt,
        end: insertAt,
        original: '',
        replacement: newMethod,
      },
    ],
  }

  return {
    fileEdits: [edit],
    conflicts: [],
    safetyChecks: { tsConfigFound, allFilesInProject: true },
  }
}
