/**
 * Extract method — W3.D6 (Modify v0.2).
 *
 * Takes a contiguous range of lines inside a function/method body and pulls
 * them out into a new function declaration in the same file, replacing the
 * extracted range with a call to the new function.
 *
 * Scope (v0.2 — keep small):
 *   - Source range must be a contiguous run of statements at the same block
 *     depth. Mid-statement extraction (a single expression inside a return)
 *     is NOT supported.
 *   - Captured variables (closure): we detect ANY identifier in the source
 *     range that resolves to a binding outside the range. If detected,
 *     return an error with the closure list — caller can clarify.
 *   - Return value: if the extracted range mutates a variable in the outer
 *     scope OR contains a `return` statement, return error with the reason.
 *     v0.2 only handles "pure-statement" extraction (println-style side
 *     effects on already-captured globals are out of scope but they ARE
 *     considered closures and rejected).
 *   - Function naming: caller supplies the new function name; we validate it
 *     as a JS identifier.
 *
 * Returns a `RenamePlan`-shaped result so the existing `applyRenamePlan` and
 * `runSandbox` pipeline can apply + validate it without further plumbing.
 */

import { Project, Node, SyntaxKind, ts } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { RenamePlan, FileEdit, RenameConflict } from './rename'

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export interface ExtractRequest {
  filePath: string
  startLine: number // 1-based
  endLine: number // 1-based, inclusive
  newFunctionName: string
}

export async function planExtract(
  projectRoot: string,
  req: ExtractRequest,
): Promise<RenamePlan> {
  const conflicts: RenameConflict[] = []

  if (!IDENTIFIER_RE.test(req.newFunctionName)) {
    conflicts.push({
      kind: 'reserved',
      message: `"${req.newFunctionName}" is not a valid JS identifier`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  if (req.endLine < req.startLine) {
    conflicts.push({
      kind: 'not-found',
      message: `endLine (${req.endLine}) < startLine (${req.startLine})`,
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

  const absPath = path.isAbsolute(req.filePath)
    ? req.filePath
    : path.join(projectRoot, req.filePath)

  const sourceFile = project.getSourceFile(absPath) ?? project.addSourceFileAtPathIfExists(absPath)
  if (!sourceFile) {
    conflicts.push({
      kind: 'not-found',
      message: `source file not found: ${req.filePath}`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: false },
    }
  }

  // Convert 1-based lines to character offsets via the source file's full text.
  const fullText = sourceFile.getFullText()
  const lines = fullText.split(/\r?\n/)
  if (req.endLine > lines.length) {
    conflicts.push({
      kind: 'not-found',
      message: `endLine ${req.endLine} > file length ${lines.length}`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  function lineColToOffset(line1: number, col0: number): number {
    let off = 0
    for (let i = 0; i < line1 - 1; i++) {
      off += lines[i].length + 1 // +1 for the newline
    }
    return off + col0
  }
  const rangeStart = lineColToOffset(req.startLine, 0)
  // End offset is the END of endLine (after the last char of that line).
  const rangeEnd = lineColToOffset(req.endLine, lines[req.endLine - 1].length)

  const extractedText = fullText.slice(rangeStart, rangeEnd)

  // Find the enclosing function-like ancestor for the range start.
  const startNode = sourceFile.getDescendantAtPos(rangeStart)
  if (!startNode) {
    conflicts.push({ kind: 'not-found', message: `no node at start offset ${rangeStart}` })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }
  const enclosingFn = startNode.getFirstAncestor((n) =>
    Node.isFunctionDeclaration(n) ||
    Node.isMethodDeclaration(n) ||
    Node.isArrowFunction(n) ||
    Node.isFunctionExpression(n),
  )
  if (!enclosingFn) {
    conflicts.push({
      kind: 'not-found',
      message: 'extracted range is not inside a function/method body',
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // Closure detection: collect identifiers in the range, check if their
  // declaration is OUTSIDE the range. Out-of-range declarations = captured.
  const captured = new Set<string>()
  const writesOutsideRange = new Set<string>()
  const seen = new Set<string>()

  sourceFile.forEachDescendant((node) => {
    if (!Node.isIdentifier(node)) return
    const pos = node.getStart()
    if (pos < rangeStart || pos >= rangeEnd) return
    const name = node.getText()
    if (seen.has(name)) return
    seen.add(name)
    // Skip property access (foo.bar — we care about foo, not bar)
    const parent = node.getParent()
    if (parent && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) return

    // Find the symbol's declarations
    const symbol = node.getSymbol()
    if (!symbol) return
    const decls = symbol.getDeclarations()

    // Skip globals: any declaration originating in a lib.*.d.ts or node_modules
    // path is part of the ambient environment, not the user's outer scope.
    const isAllAmbient = decls.every((d) => {
      const file = d.getSourceFile().getFilePath()
      return file.includes('node_modules') || /lib\.[\w.-]+\.d\.ts$/.test(file)
    })
    if (decls.length > 0 && isAllAmbient) return

    for (const d of decls) {
      const dStart = d.getStart()
      const dFile = d.getSourceFile().getFilePath()
      // Ignore ambient/globals.
      if (dFile.includes('node_modules') || /lib\.[\w.-]+\.d\.ts$/.test(dFile)) continue
      // Ignore declarations in OTHER files — only same-file outer-scope counts as captured.
      if (dFile !== sourceFile.getFilePath()) continue
      // If declared OUTSIDE the range, it's a captured variable.
      if (dStart < rangeStart || dStart >= rangeEnd) {
        captured.add(name)
        // Detect if this identifier is being written to (assignment LHS)
        if (parent && Node.isBinaryExpression(parent)) {
          const op = parent.getOperatorToken().getKind()
          if (op === SyntaxKind.EqualsToken && parent.getLeft() === node) {
            writesOutsideRange.add(name)
          }
        }
      }
    }
  })

  // Detect return statements in the extracted range
  let hasReturnStatement = false
  sourceFile.forEachDescendant((node) => {
    if (hasReturnStatement) return
    if (!Node.isReturnStatement(node)) return
    const pos = node.getStart()
    if (pos < rangeStart || pos >= rangeEnd) return
    hasReturnStatement = true
  })

  if (writesOutsideRange.size > 0) {
    conflicts.push({
      kind: 'not-found',
      message: `extract requires no writes to outer-scope vars; range writes to: ${Array.from(writesOutsideRange).join(', ')}`,
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }
  if (hasReturnStatement) {
    conflicts.push({
      kind: 'not-found',
      message: 'extract v0.2 does not support ranges containing return statements',
    })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // Build the new function body. Captured (read-only) vars become parameters.
  const params = Array.from(captured).sort()
  const paramList = params.join(', ')
  const indented = extractedText.replace(/^/gm, '  ').trimEnd()
  const newFunctionDecl = `\nfunction ${req.newFunctionName}(${paramList}) {\n${indented}\n}\n`
  const callSite = `  ${req.newFunctionName}(${paramList})\n`

  // Determine the insertion point for the new function: AFTER the enclosing
  // function's end. This keeps the original function's body intact in the
  // same file order.
  const insertOffset = enclosingFn.getEnd() + 1 // after the }

  // Edits (sorted descending so earlier edits don't shift later offsets).
  // 1. Replace the extracted range with the call.
  // 2. Insert the new function decl after the enclosing function.
  const edits: FileEdit['edits'] = [
    {
      start: insertOffset,
      end: insertOffset,
      original: '',
      replacement: newFunctionDecl,
    },
    {
      start: rangeStart,
      end: rangeEnd,
      original: extractedText,
      replacement: callSite,
    },
  ]

  const fileEdit: FileEdit = {
    filePath: sourceFile.getFilePath(),
    edits,
  }

  return {
    fileEdits: [fileEdit],
    conflicts,
    safetyChecks: { tsConfigFound, allFilesInProject: true },
  }
}
