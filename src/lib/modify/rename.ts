import { Project, SyntaxKind, ts } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs/promises'

export interface FileEdit {
  filePath: string
  edits: Array<{ start: number; end: number; original: string; replacement: string }>
}

export interface RenameConflict {
  kind: 'collision' | 'external' | 'reserved' | 'not-found'
  message: string
}

export interface RenamePlan {
  fileEdits: FileEdit[]
  conflicts: RenameConflict[]
  safetyChecks: {
    tsConfigFound: boolean
    allFilesInProject: boolean
  }
}

const JS_RESERVED = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new',
  'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'class', 'const', 'enum', 'export', 'extends', 'import',
  'super', 'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'yield', 'null', 'true', 'false', 'undefined',
])

export async function planRename(
  projectRoot: string,
  symbol: string,
  newName: string
): Promise<RenamePlan> {
  const conflicts: RenameConflict[] = []

  if (JS_RESERVED.has(newName)) {
    conflicts.push({ kind: 'reserved', message: `"${newName}" is a reserved word` })
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
    // no tsconfig
  }

  const project = tsConfigFound
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: false })
    : new Project({ compilerOptions: { allowJs: true } })

  if (!tsConfigFound) {
    project.addSourceFilesAtPaths(path.join(projectRoot, '**/*.{ts,tsx,js,jsx}'))
  }

  const sourceFiles = project.getSourceFiles()
  const allFilePaths = sourceFiles.map((sf) => sf.getFilePath())

  const declarations = sourceFiles.flatMap((sf) =>
    sf
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .filter((id) => id.getText() === symbol)
  )

  if (declarations.length === 0) {
    conflicts.push({ kind: 'not-found', message: `symbol "${symbol}" not found in project` })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // Find the declaration node (definition, not reference)
  const declarationNode = declarations.find((id) => {
    const parent = id.getParent()
    if (!parent) return false
    const kind = parent.getKind()
    return (
      kind === SyntaxKind.ClassDeclaration ||
      kind === SyntaxKind.InterfaceDeclaration ||
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.VariableDeclaration ||
      kind === SyntaxKind.TypeAliasDeclaration ||
      kind === SyntaxKind.EnumDeclaration ||
      kind === SyntaxKind.Parameter ||
      kind === SyntaxKind.PropertyDeclaration ||
      kind === SyntaxKind.MethodDeclaration
    )
  }) ?? declarations[0]

  // Check for external (node_modules) declaration
  const declFilePath = declarationNode.getSourceFile().getFilePath()
  if (declFilePath.includes('node_modules')) {
    conflicts.push({ kind: 'external', message: `"${symbol}" is declared in node_modules and cannot be renamed` })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: false },
    }
  }

  // Check for collision: any OTHER symbol named newName at top-level of any source file
  const collision = sourceFiles.some((sf) =>
    sf
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some((id) => {
        if (id.getText() !== newName) return false
        const parent = id.getParent()
        if (!parent) return false
        const kind = parent.getKind()
        return (
          kind === SyntaxKind.ClassDeclaration ||
          kind === SyntaxKind.InterfaceDeclaration ||
          kind === SyntaxKind.FunctionDeclaration ||
          kind === SyntaxKind.VariableDeclaration ||
          kind === SyntaxKind.TypeAliasDeclaration ||
          kind === SyntaxKind.EnumDeclaration
        )
      })
  )

  if (collision) {
    conflicts.push({ kind: 'collision', message: `"${newName}" already exists in the project` })
    return {
      fileEdits: [],
      conflicts,
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // Collect all references via findReferencesAsNodes (does NOT include declaration itself)
  const refNodes = declarationNode.findReferencesAsNodes()

  // Always include the declaration node itself
  const allNodes = [declarationNode, ...refNodes]

  // Group edits by file
  const editsByFile = new Map<string, FileEdit['edits']>()

  for (const refNode of allNodes) {
    const filePath = refNode.getSourceFile().getFilePath()
    // Skip node_modules references
    if (filePath.includes('node_modules')) continue

    const start = refNode.getStart()
    const end = refNode.getEnd()
    const original = refNode.getText()

    if (!editsByFile.has(filePath)) {
      editsByFile.set(filePath, [])
    }
    editsByFile.get(filePath)!.push({ start, end, original, replacement: newName })
  }

  const fileEdits: FileEdit[] = []
  for (const [filePath, edits] of editsByFile.entries()) {
    fileEdits.push({ filePath, edits })
  }

  const allFilesInProject = allFilePaths.every((p) => !p.includes('node_modules') || tsConfigFound)

  return {
    fileEdits,
    conflicts,
    safetyChecks: { tsConfigFound, allFilesInProject },
  }
}
