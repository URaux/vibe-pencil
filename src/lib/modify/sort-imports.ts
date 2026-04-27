import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { RenamePlan, FileEdit } from './rename'

export interface SortImportsRequest {
  filePath: string
}

type ImportGroup = 'external' | 'aliased' | 'relative'

function classifySpecifier(spec: string): ImportGroup {
  if (spec.startsWith('./') || spec.startsWith('../')) return 'relative'
  if (spec.startsWith('@/')) return 'aliased'
  return 'external'
}

const GROUP_ORDER: ImportGroup[] = ['external', 'aliased', 'relative']

export async function planSortImports(
  projectRoot: string,
  req: SortImportsRequest
): Promise<RenamePlan> {
  const absPath = path.resolve(projectRoot, req.filePath)

  try {
    await fs.access(absPath)
  } catch {
    return {
      fileEdits: [],
      conflicts: [{ kind: 'not-found', message: `file not found: ${req.filePath}` }],
      safetyChecks: { tsConfigFound: false, allFilesInProject: false },
    }
  }

  const tsConfigPath = path.join(projectRoot, 'tsconfig.json')
  let tsConfigFound = false
  try {
    await fs.access(tsConfigPath)
    tsConfigFound = true
  } catch { /* no tsconfig */ }

  const project = tsConfigFound
    ? new Project({ tsConfigFilePath: tsConfigPath, skipAddingFilesFromTsConfig: true })
    : new Project({ compilerOptions: { allowJs: true } })

  project.addSourceFileAtPath(absPath)
  const sf = project.getSourceFileOrThrow(absPath)

  const importDecls = sf.getImportDeclarations()
  if (importDecls.length === 0) {
    return {
      fileEdits: [],
      conflicts: [],
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  // Group imports. Side-effect imports (no named/default specifiers) keep their
  // relative order within their group but otherwise sort by moduleSpecifier.
  const groups: Map<ImportGroup, typeof importDecls> = new Map([
    ['external', []],
    ['aliased', []],
    ['relative', []],
  ])

  for (const decl of importDecls) {
    const spec = decl.getModuleSpecifierValue()
    groups.get(classifySpecifier(spec))!.push(decl)
  }

  // Sort each group alphabetically by specifier
  for (const [, list] of groups) {
    list.sort((a, b) => a.getModuleSpecifierValue().localeCompare(b.getModuleSpecifierValue()))
  }

  // Build sorted text for each import, also sorting named imports within each statement
  function importText(decl: (typeof importDecls)[number]): string {
    const named = decl.getNamedImports()
    if (named.length > 1) {
      const sorted = named.map((n) => n.getText()).sort((a, b) => a.localeCompare(b))
      const defaultImport = decl.getDefaultImport()
      const nsImport = decl.getNamespaceImport()
      const modSpec = decl.getModuleSpecifierValue()
      const importClause = [
        defaultImport ? defaultImport.getText() : null,
        nsImport ? `* as ${nsImport.getText()}` : null,
        `{ ${sorted.join(', ')} }`,
      ]
        .filter(Boolean)
        .join(', ')
      return `import ${importClause} from '${modSpec}'`
    }
    return decl.getText().replace(/\r?\n/g, '\n')
  }

  // Build the sorted block text
  const sortedLines: string[] = []
  for (const group of GROUP_ORDER) {
    for (const decl of groups.get(group)!) {
      sortedLines.push(importText(decl))
    }
  }

  const firstDecl = importDecls[0]
  const lastDecl = importDecls[importDecls.length - 1]
  const start = firstDecl.getStart()
  const end = lastDecl.getEnd()
  const originalBlock = sf.getFullText().slice(start, end)
  const sortedBlock = sortedLines.join('\n')

  if (originalBlock === sortedBlock) {
    return {
      fileEdits: [],
      conflicts: [],
      safetyChecks: { tsConfigFound, allFilesInProject: true },
    }
  }

  const fileEdit: FileEdit = {
    filePath: absPath,
    edits: [{ start, end, original: originalBlock, replacement: sortedBlock }],
  }

  return {
    fileEdits: [fileEdit],
    conflicts: [],
    safetyChecks: { tsConfigFound, allFilesInProject: true },
  }
}
