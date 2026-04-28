/**
 * Add export — Modify v0.4.
 *
 * Finds a top-level declaration in a TypeScript file and adds the `export`
 * keyword to it. If the declaration is already exported the result is a
 * no-conflict plan with no edits (idempotent).
 *
 * Supported declaration kinds (when kind is omitted, all are tried):
 *   function, class, const (VariableStatement), interface, type alias, enum
 *
 * Returns a RenamePlan-shaped result compatible with applyRenamePlan/runSandbox.
 */

import { Project, SyntaxKind, Node } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { RenamePlan, FileEdit, RenameConflict } from './rename'

export interface AddExportRequest {
  filePath: string
  symbolName: string
  kind?: 'function' | 'class' | 'const' | 'interface' | 'type' | 'enum'
}

export async function planAddExport(
  projectRoot: string,
  req: AddExportRequest,
): Promise<RenamePlan> {
  const conflicts: RenameConflict[] = []

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

  // Find the declaration matching symbolName
  let targetNode: Node | undefined

  // Check function declarations
  const funcDecl = sourceFile.getFunction(req.symbolName)
  if (funcDecl && (!req.kind || req.kind === 'function')) {
    targetNode = funcDecl
  }

  // Check class declarations
  if (!targetNode) {
    const classDecl = sourceFile.getClass(req.symbolName)
    if (classDecl && (!req.kind || req.kind === 'class')) {
      targetNode = classDecl
    }
  }

  // Check variable statements (const/let/var)
  if (!targetNode) {
    const varDecl = sourceFile.getVariableDeclaration(req.symbolName)
    if (varDecl && (!req.kind || req.kind === 'const')) {
      targetNode = varDecl.getParent()?.getParent() // VariableDeclarationList -> VariableStatement
    }
  }

  // Check interface declarations
  if (!targetNode) {
    const ifaceDecl = sourceFile.getInterface(req.symbolName)
    if (ifaceDecl && (!req.kind || req.kind === 'interface')) {
      targetNode = ifaceDecl
    }
  }

  // Check type alias declarations
  if (!targetNode) {
    const typeDecl = sourceFile.getTypeAlias(req.symbolName)
    if (typeDecl && (!req.kind || req.kind === 'type')) {
      targetNode = typeDecl
    }
  }

  // Check enum declarations
  if (!targetNode) {
    const enumDecl = sourceFile.getEnum(req.symbolName)
    if (enumDecl && (!req.kind || req.kind === 'enum')) {
      targetNode = enumDecl
    }
  }

  if (!targetNode) {
    conflicts.push({ kind: 'not-found', message: `symbol "${req.symbolName}" not found in ${req.filePath}` })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound, allFilesInProject: true } }
  }

  // Check if already exported — idempotent: return empty plan (no conflict, no edits)
  const nodeText = targetNode.getText()
  const isAlreadyExported = nodeText.startsWith('export ')

  if (isAlreadyExported) {
    return {
      fileEdits: [],
      conflicts: [],
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // Insert 'export ' before the declaration
  const insertAt = targetNode.getStart()

  const edit: FileEdit = {
    filePath: absPath,
    edits: [
      {
        start: insertAt,
        end: insertAt,
        original: '',
        replacement: 'export ',
      },
    ],
  }

  return {
    fileEdits: [edit],
    conflicts: [],
    safetyChecks: { tsConfigFound, allFilesInProject: true },
  }
}
