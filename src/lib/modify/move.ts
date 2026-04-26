/**
 * Move method/decl — Phase 3 Modify v0.3.
 *
 * Moves a top-level declaration from one file to another and rewrites all
 * importers to reference the new location.
 *
 * Scope (v0.3 — single symbol, same project):
 *   - Symbol must be a TOP-LEVEL declaration (class/interface/function/type/enum/const/var)
 *   - fromFile and toFile must both be inside projectRoot
 *   - Detects circular-import risk: if fromFile and toFile already form an
 *     edge graph that would close on this move, reject with conflict.
 *   - Does NOT rewrite the moved decl's own internal imports — if the decl
 *     references things still in fromFile, the sandbox tsc step catches the
 *     break and the user gets a clear error to clarify.
 *
 * Output: RenamePlan-shape so it composes with the existing applyRenamePlan
 * + runSandbox + createRenamePr pipeline.
 */

import { Project, SyntaxKind, Node } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { RenamePlan, FileEdit, RenameConflict } from './rename'

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export interface MoveRequest {
  symbol: string
  fromFile: string
  toFile: string
}

interface ImporterRewrite {
  filePath: string
  importStart: number
  importEnd: number
  oldSpecifier: string
  newSpecifier: string
}

function computeRelativeSpecifier(fromImporterFile: string, toFile: string): string {
  // Compute a relative specifier from importer → toFile. ts-morph paths are
  // OS-native; convert to POSIX for the import string.
  const dir = path.dirname(fromImporterFile)
  const rel = path.relative(dir, toFile).replace(/\\/g, '/')
  // Strip extension (TS imports drop .ts)
  const noExt = rel.replace(/\.(ts|tsx|js|jsx|mts|cts)$/, '')
  // Ensure relative-prefix
  if (noExt.startsWith('./') || noExt.startsWith('../')) return noExt
  return './' + noExt
}

export async function planMove(
  projectRoot: string,
  req: MoveRequest,
): Promise<RenamePlan> {
  const conflicts: RenameConflict[] = []

  if (!IDENTIFIER_RE.test(req.symbol)) {
    conflicts.push({ kind: 'reserved', message: `"${req.symbol}" is not a valid identifier` })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  if (req.fromFile === req.toFile) {
    conflicts.push({
      kind: 'not-found',
      message: `fromFile and toFile are the same: ${req.fromFile}`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  const tsConfigPath = path.join(projectRoot, 'tsconfig.json')
  let tsConfigFound = false
  try {
    await fs.access(tsConfigPath)
    tsConfigFound = true
  } catch {
    // none
  }

  const project = tsConfigFound
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: false })
    : new Project({ compilerOptions: { allowJs: true } })

  if (!tsConfigFound) {
    project.addSourceFilesAtPaths(path.join(projectRoot, '**/*.{ts,tsx,js,jsx}'))
  }

  const fromAbs = path.isAbsolute(req.fromFile) ? req.fromFile : path.join(projectRoot, req.fromFile)
  const toAbs = path.isAbsolute(req.toFile) ? req.toFile : path.join(projectRoot, req.toFile)

  const fromSourceFile = project.getSourceFile(fromAbs)
  if (!fromSourceFile) {
    conflicts.push({ kind: 'not-found', message: `fromFile not found: ${req.fromFile}` })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: false },
    }
  }

  // toFile may not exist yet — caller can create it on apply. For now require it.
  let toSourceFile = project.getSourceFile(toAbs)
  if (!toSourceFile) {
    // Allow creating by adding an empty source file (caller's apply step writes it).
    // For the plan we need its current content (might be ''); read from disk if exists.
    let initialText = ''
    try {
      initialText = await fs.readFile(toAbs, 'utf8')
    } catch {
      // toFile doesn't exist; will be created with just the moved decl
    }
    toSourceFile = project.createSourceFile(toAbs, initialText, { overwrite: true })
  }

  // Find the top-level declaration node for `symbol` in fromFile.
  const declarationNode = fromSourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .find((id) => {
      if (id.getText() !== req.symbol) return false
      const parent = id.getParent()
      if (!parent) return false
      const kind = parent.getKind()
      // Must be a top-level decl
      if (
        kind !== SyntaxKind.ClassDeclaration &&
        kind !== SyntaxKind.InterfaceDeclaration &&
        kind !== SyntaxKind.FunctionDeclaration &&
        kind !== SyntaxKind.VariableDeclaration &&
        kind !== SyntaxKind.TypeAliasDeclaration &&
        kind !== SyntaxKind.EnumDeclaration
      ) {
        return false
      }
      // Identifier's grandparent must be the source file (or a VariableStatement directly under it)
      const grandparent = parent.getParent()
      if (!grandparent) return false
      const gpKind = grandparent.getKind()
      if (gpKind === SyntaxKind.SourceFile) return true
      if (gpKind === SyntaxKind.VariableDeclarationList) {
        const varStmt = grandparent.getParent()
        return !!varStmt && varStmt.getParent()?.getKind() === SyntaxKind.SourceFile
      }
      return false
    })

  if (!declarationNode) {
    conflicts.push({
      kind: 'not-found',
      message: `top-level declaration "${req.symbol}" not found in ${req.fromFile}`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // Determine the FULL declaration node (e.g. a class statement, not just the identifier).
  let declStmt: Node = declarationNode.getParent() as Node
  // For variable declarations the actual statement is the VariableStatement two levels up.
  if (declStmt.getKind() === SyntaxKind.VariableDeclaration) {
    const list = declStmt.getParent()
    if (list && list.getKind() === SyntaxKind.VariableDeclarationList) {
      const stmt = list.getParent()
      if (stmt && stmt.getKind() === SyntaxKind.VariableStatement) declStmt = stmt
    }
  }

  // Capture text + range of the decl to move (with leading export keyword if present).
  const declText = declStmt.getFullText().trimStart() // drop leading whitespace
  const declStart = declStmt.getStart()
  const declEnd = declStmt.getEnd()

  // Find all references via the symbol's identifier node.
  const refNodes = declarationNode.findReferencesAsNodes()

  // Build importer rewrites: any reference whose source file != fromFile and
  // whose ancestor is an ImportDeclaration MUST have its import specifier rewritten.
  const importerRewrites: ImporterRewrite[] = []
  const importersHandled = new Set<string>()
  for (const refNode of refNodes) {
    const refFilePath = refNode.getSourceFile().getFilePath()
    if (refFilePath === fromSourceFile.getFilePath()) continue

    // Walk up to ImportDeclaration ancestor.
    const importDecl = refNode.getFirstAncestor((n) => Node.isImportDeclaration(n))
    if (!importDecl || !Node.isImportDeclaration(importDecl)) continue
    const key = `${refFilePath}::${importDecl.getStart()}`
    if (importersHandled.has(key)) continue
    importersHandled.add(key)

    const stringLit = importDecl.getModuleSpecifier()
    const oldSpec = stringLit.getLiteralValue()
    const newSpec = computeRelativeSpecifier(refFilePath, toAbs)
    importerRewrites.push({
      filePath: refFilePath,
      importStart: stringLit.getStart() + 1, // skip opening quote
      importEnd: stringLit.getEnd() - 1, // before closing quote
      oldSpecifier: oldSpec,
      newSpecifier: newSpec,
    })
  }

  // Circular-import detection: does toFile already (transitively) import fromFile?
  // ts-morph normalizes file paths to POSIX (forward slashes); path.resolve uses
  // OS-native separators on Windows. Normalize both sides to POSIX before comparing.
  const fromFilePosix = fromSourceFile.getFilePath().replace(/\\/g, '/')
  const toImports = toSourceFile.getImportDeclarations()
  for (const imp of toImports) {
    const spec = imp.getModuleSpecifierValue()
    if (!spec) continue
    const toDir = path.dirname(toSourceFile.getFilePath())
    const resolved = path.resolve(toDir, spec).replace(/\\/g, '/')
    if (
      resolved === fromFilePosix ||
      resolved + '.ts' === fromFilePosix ||
      resolved + '.tsx' === fromFilePosix ||
      resolved + '.js' === fromFilePosix
    ) {
      conflicts.push({
        kind: 'collision',
        message: `circular import: ${path.basename(toSourceFile.getFilePath())} already imports from ${path.basename(fromSourceFile.getFilePath())}`,
      })
      return {
        fileEdits: [],
        conflicts,
        safetyChecks: { tsConfigFound, allFilesInProject: true },
      }
    }
  }

  // Build edits.
  // 1. Remove decl from fromFile (replace declStart..declEnd with empty + cleanup leading newline).
  const fromFileEdits: FileEdit['edits'] = [
    {
      start: declStart,
      end: declEnd,
      original: declStmt.getText(),
      replacement: '',
    },
  ]

  // 2. Append decl to toFile (with a leading newline for separation).
  const toFileText = toSourceFile.getFullText()
  const insertOffset = toFileText.length
  const toFileEdits: FileEdit['edits'] = [
    {
      start: insertOffset,
      end: insertOffset,
      original: '',
      replacement: (toFileText.endsWith('\n') ? '\n' : '\n\n') + declText.trim() + '\n',
    },
  ]

  // 3. Importer rewrites.
  const editsByFile = new Map<string, FileEdit['edits']>()
  editsByFile.set(fromSourceFile.getFilePath(), fromFileEdits)
  editsByFile.set(toSourceFile.getFilePath(), toFileEdits)

  for (const r of importerRewrites) {
    if (!editsByFile.has(r.filePath)) editsByFile.set(r.filePath, [])
    editsByFile.get(r.filePath)!.push({
      start: r.importStart,
      end: r.importEnd,
      original: r.oldSpecifier,
      replacement: r.newSpecifier,
    })
  }

  const fileEdits: FileEdit[] = []
  for (const [filePath, edits] of editsByFile.entries()) {
    fileEdits.push({ filePath, edits })
  }

  return {
    fileEdits,
    conflicts,
    safetyChecks: { tsConfigFound, allFilesInProject: true },
  }
}
