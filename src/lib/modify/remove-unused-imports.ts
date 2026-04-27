/**
 * remove-unused-imports verb — phase3/modify-remove-unused-imports
 *
 * Uses ts-morph to find import bindings with no in-file references, then
 * returns a RenamePlan describing the edits needed to prune them.
 * Side-effect-only imports (no bindings) are always preserved.
 * Type-only import declarations are treated the same as value imports.
 */

import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import type { RenamePlan, FileEdit } from './rename'

export interface RemoveUnusedImportsOptions {
  filePath: string
}

export async function planRemoveUnusedImports(
  projectRoot: string,
  opts: RemoveUnusedImportsOptions,
): Promise<RenamePlan> {
  const absPath = path.isAbsolute(opts.filePath)
    ? opts.filePath
    : path.join(projectRoot, opts.filePath)

  const project = new Project({ useInMemoryFileSystem: false, skipFileDependencyResolution: true })
  let sourceFile
  try {
    sourceFile = project.addSourceFileAtPath(absPath)
  } catch {
    return {
      fileEdits: [],
      conflicts: [{ kind: 'not-found', message: `File not found: ${absPath}` }],
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  const source = sourceFile.getFullText()
  const edits: FileEdit['edits'] = []

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const namedImports = importDecl.getNamedImports()
    const defaultImport = importDecl.getDefaultImport()

    // Side-effect-only import (no bindings) — always preserve
    if (!defaultImport && namedImports.length === 0) continue

    const unusedNamed: string[] = []
    const usedNamed: string[] = []

    for (const named of namedImports) {
      const alias = named.getAliasNode() ?? named.getNameNode()
      const localName = alias.getText()
      // Count references excluding the import declaration itself
      const refs = sourceFile.getDescendantsOfKind(
        // SyntaxKind.Identifier
        SyntaxKind.Identifier,
      ).filter((id) => {
        if (id.getText() !== localName) return false
        // Exclude identifiers that ARE the import specifier itself
        const pos = id.getStart()
        const declStart = importDecl.getStart()
        const declEnd = importDecl.getEnd()
        return pos < declStart || pos >= declEnd
      })
      if (refs.length === 0) unusedNamed.push(localName)
      else usedNamed.push(named.getText())
    }

    let defaultUnused = false
    if (defaultImport) {
      const localName = defaultImport.getText()
      const refs = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).filter(
        (id) => {
          if (id.getText() !== localName) return false
          const pos = id.getStart()
          const declStart = importDecl.getStart()
          const declEnd = importDecl.getEnd()
          return pos < declStart || pos >= declEnd
        },
      )
      if (refs.length === 0) defaultUnused = true
    }

    const allNamedUnused = unusedNamed.length > 0 && usedNamed.length === 0
    const removeDefault = defaultImport ? defaultUnused : false
    const removeAll =
      (removeDefault || !defaultImport) &&
      (allNamedUnused || namedImports.length === 0)

    if (!removeDefault && unusedNamed.length === 0) continue

    const declStart = importDecl.getStart()
    // Include trailing newline in the removal range
    let declEnd = importDecl.getEnd()
    if (source[declEnd] === '\n') declEnd++
    const original = source.slice(declStart, declEnd)

    if (removeAll) {
      edits.push({ start: declStart, end: declEnd, original, replacement: '' })
    } else {
      // Rebuild import with only used names
      const spec = importDecl.getModuleSpecifierValue()
      const parts: string[] = []
      const keepDefault = defaultImport && !defaultUnused ? defaultImport.getText() : null
      if (keepDefault) parts.push(keepDefault)
      if (usedNamed.length > 0) parts.push(`{ ${usedNamed.join(', ')} }`)
      const rebuilt = `import ${parts.join(', ')} from '${spec}'\n`
      edits.push({ start: declStart, end: declEnd, original, replacement: rebuilt })
    }
  }

  if (edits.length === 0) {
    return {
      fileEdits: [],
      conflicts: [],
      safetyChecks: { tsConfigFound: true, allFilesInProject: true },
    }
  }

  return {
    fileEdits: [{ filePath: absPath, edits }],
    conflicts: [],
    safetyChecks: { tsConfigFound: true, allFilesInProject: true },
  }
}
