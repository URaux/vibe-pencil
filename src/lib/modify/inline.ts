/**
 * Inline variable — phase3/modify-inline.
 *
 * Replaces every use-site of a variable with its paren-wrapped initializer,
 * then removes the declaration statement.
 *
 * Rejects when:
 *   - variable not found in file
 *   - declaration has no initializer
 *   - let/var that is reassigned anywhere in scope
 *   - identifier name is not a valid JS identifier
 */

import { Project, Node, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { RenamePlan, FileEdit, RenameConflict } from './rename'

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export interface InlineRequest {
  filePath: string
  variableName: string
}

export async function planInlineVariable(
  projectRoot: string,
  req: InlineRequest,
): Promise<RenamePlan> {
  const conflicts: RenameConflict[] = []

  if (!IDENTIFIER_RE.test(req.variableName)) {
    conflicts.push({
      kind: 'reserved',
      message: `"${req.variableName}" is not a valid JS identifier`,
    })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound: false, allFilesInProject: false } }
  }

  const tsConfigPath = path.join(projectRoot, 'tsconfig.json')
  let tsConfigFound = false
  try {
    await fs.access(tsConfigPath)
    tsConfigFound = true
  } catch {
    // no tsconfig
  }

  const project = tsConfigFound
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: false })
    : new Project({ compilerOptions: { allowJs: true } })

  if (!tsConfigFound) {
    project.addSourceFilesAtPaths(path.join(projectRoot, '**/*.{ts,tsx,js,jsx}'))
  }

  const absPath = path.isAbsolute(req.filePath)
    ? req.filePath
    : path.join(projectRoot, req.filePath)

  const sourceFile = project.getSourceFile(absPath) ?? project.addSourceFileAtPathIfExists(absPath)
  if (!sourceFile) {
    conflicts.push({ kind: 'not-found', message: `source file not found: ${req.filePath}` })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound, allFilesInProject: false } }
  }

  // Find variable declaration
  const varDecls = sourceFile
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter((d) => d.getName() === req.variableName)

  if (varDecls.length === 0) {
    conflicts.push({ kind: 'not-found', message: `variable "${req.variableName}" not found` })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound, allFilesInProject: true } }
  }

  const varDecl = varDecls[0]
  const initializer = varDecl.getInitializer()
  if (!initializer) {
    conflicts.push({ kind: 'not-found', message: `"${req.variableName}" has no initializer` })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound, allFilesInProject: true } }
  }

  const initText = initializer.getText()

  // Check if it's let/var — if so, reject if reassigned
  const declList = varDecl.getParent()
  if (Node.isVariableDeclarationList(declList)) {
    const flags = declList.getFlags()
    const isConst = (flags & 2) !== 0 // ts.NodeFlags.Const = 2
    if (!isConst) {
      // Find all identifier nodes with this name in the file
      const allIds = sourceFile
        .getDescendantsOfKind(SyntaxKind.Identifier)
        .filter((id) => id.getText() === req.variableName)

      const isReassigned = allIds.some((id) => {
        const parent = id.getParent()
        if (!parent) return false
        // assignment: x = ..., x += ..., x++, ++x, etc.
        if (Node.isBinaryExpression(parent)) {
          const op = parent.getOperatorToken().getKind()
          const assignOps = new Set([
            SyntaxKind.EqualsToken,
            SyntaxKind.PlusEqualsToken,
            SyntaxKind.MinusEqualsToken,
            SyntaxKind.AsteriskEqualsToken,
            SyntaxKind.SlashEqualsToken,
            SyntaxKind.PercentEqualsToken,
            SyntaxKind.AmpersandEqualsToken,
            SyntaxKind.BarEqualsToken,
            SyntaxKind.CaretEqualsToken,
            SyntaxKind.LessThanLessThanEqualsToken,
            SyntaxKind.GreaterThanGreaterThanEqualsToken,
            SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
          ])
          if (assignOps.has(op) && parent.getLeft() === id) return true
        }
        // prefix/postfix ++/--
        if (
          Node.isPrefixUnaryExpression(parent) || Node.isPostfixUnaryExpression(parent)
        ) {
          const op = parent.getOperatorToken()
          if (
            op === SyntaxKind.PlusPlusToken ||
            op === SyntaxKind.MinusMinusToken
          ) {
            return true
          }
        }
        return false
      })

      if (isReassigned) {
        conflicts.push({
          kind: 'not-found',
          message: `"${req.variableName}" is a let/var that is reassigned; cannot inline`,
        })
        return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound, allFilesInProject: true } }
      }
    }
  }

  // Collect use-sites (all identifiers referencing this variable, excluding the declaration itself)
  const declId = varDecl.getNameNode()
  const refNodes = declId.findReferencesAsNodes()

  // The declaration statement to remove
  // VariableDeclaration → VariableDeclarationList → VariableStatement
  const varStmt = declList?.getParent()
  if (!varStmt || !Node.isVariableStatement(varStmt)) {
    conflicts.push({ kind: 'not-found', message: 'could not locate variable statement for removal' })
    return { fileEdits: [], conflicts, safetyChecks: { tsConfigFound, allFilesInProject: true } }
  }

  const replacement = `(${initText})`
  const edits: FileEdit['edits'] = []

  // Replace each use-site
  for (const ref of refNodes) {
    // Skip if this ref IS the declaration identifier itself
    if (ref.getSourceFile().getFilePath() !== sourceFile.getFilePath()) continue
    edits.push({
      start: ref.getStart(),
      end: ref.getEnd(),
      original: ref.getText(),
      replacement,
    })
  }

  // Remove the declaration statement (full line including trailing newline if present)
  const stmtStart = varStmt.getStart()
  const stmtEnd = varStmt.getEnd()
  // Include the newline after the statement if present
  const fullText = sourceFile.getFullText()
  const endWithNewline =
    fullText[stmtEnd] === '\n' ? stmtEnd + 1 : fullText[stmtEnd] === '\r' ? stmtEnd + 2 : stmtEnd

  edits.push({
    start: stmtStart,
    end: endWithNewline,
    original: fullText.slice(stmtStart, endWithNewline),
    replacement: '',
  })

  // Sort descending so earlier edits don't shift later offsets during apply
  edits.sort((a, b) => b.start - a.start)

  return {
    fileEdits: [{ filePath: sourceFile.getFilePath(), edits }],
    conflicts,
    safetyChecks: { tsConfigFound, allFilesInProject: true },
  }
}
