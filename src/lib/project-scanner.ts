import fs from 'fs'
import path from 'path'

export type FrameworkType =
  | 'nextjs'
  | 'react'
  | 'vue'
  | 'nuxt'
  | 'angular'
  | 'svelte'
  | 'sveltekit'
  | 'express'
  | 'fastify'
  | 'nestjs'
  | 'fastapi'
  | 'django'
  | 'flask'
  | 'gin'
  | 'echo'
  | 'spring'
  | 'rails'
  | 'electron'
  | 'tauri'

export type LanguageType =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'java'
  | 'rust'
  | 'ruby'
  | 'unknown'

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: FileTreeNode[]
}

export interface DirectoryInfo {
  path: string
  fileCount: number
  dominantExtension: string | null
  role: DirectoryRole | null
}

export type DirectoryRole =
  | 'frontend'
  | 'components'
  | 'api'
  | 'lib'
  | 'services'
  | 'database'
  | 'infrastructure'
  | 'config'
  | 'tests'
  | 'docs'
  | 'monorepo-package'

export interface ProjectScan {
  name: string
  framework: FrameworkType | null
  language: LanguageType
  fileTree: FileTreeNode[]
  dependencies: string[]
  entryPoints: string[]
  directories: DirectoryInfo[]
  totalFiles: number
  totalLines: number
  keyFileContents: Record<string, string>
  truncated?: boolean
}

// ---- Constants ----

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.env',
  'target',
  '.turbo',
  '.vercel',
  '.output',
  'coverage',
  '.nyc_output',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'vendor',
  'Pods',
])

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp4',
  '.webm',
  '.zip',
  '.tar',
  '.gz',
  '.lock',
  '.map',
])

const MAX_FILES = 500
const MAX_DEPTH = 4
const KEY_FILE_BUDGET = 30 * 1024 // 30KB
const KEY_FILE_LINE_LIMIT = 200
const KEY_FILE_BYTE_LIMIT = 5 * 1024 // 5KB per file

// ---- Directory role mapping ----

const DIR_ROLE_MAP: Array<{ pattern: RegExp; role: DirectoryRole }> = [
  { pattern: /^(src\/app\/api|src\/api|api|routes|controllers)(\/|$)/, role: 'api' },
  { pattern: /^(src\/components|components)(\/|$)/, role: 'components' },
  { pattern: /^(src\/app|pages|src\/pages|src\/views)(\/|$)/, role: 'frontend' },
  { pattern: /^(src\/lib|src\/utils|src\/helpers|lib|utils)(\/|$)/, role: 'lib' },
  { pattern: /^(src\/services|services)(\/|$)/, role: 'services' },
  { pattern: /^(prisma|src\/db|db|migrations|src\/models)(\/|$)/, role: 'database' },
  { pattern: /^(docker|infra|terraform|\.github|k8s)(\/|$)/, role: 'infrastructure' },
  { pattern: /^(tests|test|__tests__|spec)(\/|$)/, role: 'tests' },
  { pattern: /^(docs|doc)(\/|$)/, role: 'docs' },
]

function assignDirectoryRole(relPath: string): DirectoryRole | null {
  const normalized = relPath.replace(/\\/g, '/')
  for (const { pattern, role } of DIR_ROLE_MAP) {
    if (pattern.test(normalized + '/')) return role
  }
  return null
}

// ---- File tree walker ----

function walkTree(
  absDir: string,
  relBase: string,
  depth: number,
  fileCount: { value: number },
  truncated: { value: boolean }
): FileTreeNode[] {
  if (depth > MAX_DEPTH) return []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: FileTreeNode[] = []

  for (const entry of entries) {
    if (fileCount.value >= MAX_FILES) {
      truncated.value = true
      break
    }

    const name = entry.name
    const relPath = relBase ? `${relBase}/${name}` : name
    const absPath = path.join(absDir, name)

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(name) || name.startsWith('.')) continue
      const children = walkTree(absPath, relPath, depth + 1, fileCount, truncated)
      nodes.push({ name, path: relPath, type: 'dir', children })
    } else if (entry.isFile()) {
      const ext = path.extname(name).toLowerCase()
      if (BINARY_EXTENSIONS.has(ext)) continue
      fileCount.value++
      let size: number | undefined
      try {
        size = fs.statSync(absPath).size
      } catch {
        // ignore
      }
      nodes.push({ name, path: relPath, type: 'file', size })
    }
  }

  return nodes
}

// ---- Dependency extraction ----

function extractDependencies(dir: string): string[] {
  const deps: string[] = []

  // package.json
  const pkgPath = path.join(dir, 'package.json')
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const allDeps = {
        ...((pkg.dependencies as Record<string, string>) ?? {}),
        ...((pkg.devDependencies as Record<string, string>) ?? {}),
      }
      deps.push(...Object.keys(allDeps))
    } catch {
      // ignore
    }
  }

  // requirements.txt
  const reqPath = path.join(dir, 'requirements.txt')
  if (fs.existsSync(reqPath)) {
    try {
      const lines = fs.readFileSync(reqPath, 'utf-8').split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          deps.push(trimmed.split(/[=<>!;[\s]/)[0].trim())
        }
      }
    } catch {
      // ignore
    }
  }

  // go.mod
  const goModPath = path.join(dir, 'go.mod')
  if (fs.existsSync(goModPath)) {
    try {
      const lines = fs.readFileSync(goModPath, 'utf-8').split('\n')
      for (const line of lines) {
        const m = line.trim().match(/^require\s+(\S+)/)
        if (m) deps.push(m[1])
        const m2 = line.trim().match(/^\t?(\S+)\s+v/)
        if (m2 && !m2[1].startsWith('//')) deps.push(m2[1])
      }
    } catch {
      // ignore
    }
  }

  // Cargo.toml
  const cargoPath = path.join(dir, 'Cargo.toml')
  if (fs.existsSync(cargoPath)) {
    try {
      const content = fs.readFileSync(cargoPath, 'utf-8')
      const matches = content.matchAll(/^(\w[\w-]*)\s*=/gm)
      for (const m of matches) deps.push(m[1])
    } catch {
      // ignore
    }
  }

  // pyproject.toml
  const pyprojectPath = path.join(dir, 'pyproject.toml')
  if (fs.existsSync(pyprojectPath)) {
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8')
      const matches = content.matchAll(/^(\w[\w-]*)\s*[>=<!]/gm)
      for (const m of matches) deps.push(m[1])
    } catch {
      // ignore
    }
  }

  return [...new Set(deps)].filter(Boolean)
}

// ---- Framework detection ----

function detectFramework(dir: string, deps: string[], fileTree: FileTreeNode[]): FrameworkType | null {
  const exists = (rel: string) => fs.existsSync(path.join(dir, rel))
  const existsGlob = (patterns: string[]) => patterns.some((p) => exists(p))
  const depSet = new Set(deps)

  // nextjs
  if (existsGlob(['next.config.js', 'next.config.ts', 'next.config.mjs'])) return 'nextjs'

  // nuxt
  if (existsGlob(['nuxt.config.js', 'nuxt.config.ts'])) return 'nuxt'

  // angular
  if (exists('angular.json')) return 'angular'

  // sveltekit / svelte
  if (existsGlob(['svelte.config.js', 'svelte.config.ts'])) {
    if (exists('src/routes')) return 'sveltekit'
    return 'svelte'
  }

  // vue
  if (existsGlob(['vue.config.js', 'vue.config.ts'])) return 'vue'
  if (existsGlob(['vite.config.js', 'vite.config.ts', 'vite.config.mts'])) {
    // check for any .vue files in tree
    const hasVue = flattenTree(fileTree).some((n) => n.type === 'file' && n.name.endsWith('.vue'))
    if (hasVue) return 'vue'
  }

  // tauri
  if (exists('Cargo.toml') && exists('src/main.rs') && depSet.has('tauri')) return 'tauri'

  // electron
  if (existsGlob(['main.js', 'electron.js']) && depSet.has('electron')) return 'electron'

  // django
  if (exists('manage.py')) return 'django'

  // fastapi
  if (depSet.has('fastapi')) return 'fastapi'

  // flask
  if (depSet.has('flask') || depSet.has('Flask')) return 'flask'

  // Go frameworks
  if (exists('go.mod')) {
    if (depSet.has('github.com/gin-gonic/gin')) return 'gin'
    if (depSet.has('github.com/labstack/echo') || depSet.has('github.com/labstack/echo/v4')) return 'echo'
    return 'gin' // generic Go, default to gin label
  }

  // nestjs
  if (depSet.has('@nestjs/core')) return 'nestjs'

  // express
  if (depSet.has('express') && !depSet.has('react') && !depSet.has('vue')) return 'express'

  // fastify
  if (depSet.has('fastify')) return 'fastify'

  // spring
  if (exists('pom.xml') || exists('build.gradle')) return 'spring'

  // rails
  if (exists('Gemfile') && deps.some((d) => d === 'rails')) return 'rails'

  // react (catch-all for JS projects with react)
  if (depSet.has('react')) return 'react'

  return null
}

function flattenTree(nodes: FileTreeNode[]): FileTreeNode[] {
  const result: FileTreeNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.children) result.push(...flattenTree(node.children))
  }
  return result
}

// ---- Language detection ----

function detectLanguage(dir: string, fileTree: FileTreeNode[]): LanguageType {
  const srcDir = path.join(dir, 'src')
  const searchBase = fs.existsSync(srcDir) ? 'src' : ''

  const counts: Record<string, number> = {}
  const allFiles = flattenTree(fileTree)

  for (const node of allFiles) {
    if (node.type !== 'file') continue
    if (searchBase && !node.path.startsWith(searchBase)) continue
    const ext = path.extname(node.name).toLowerCase()
    counts[ext] = (counts[ext] ?? 0) + 1
  }

  const extLangMap: Array<[string[], LanguageType]> = [
    [['.ts', '.tsx'], 'typescript'],
    [['.js', '.jsx'], 'javascript'],
    [['.py'], 'python'],
    [['.go'], 'go'],
    [['.java'], 'java'],
    [['.rs'], 'rust'],
    [['.rb'], 'ruby'],
  ]

  let best: LanguageType = 'unknown'
  let bestCount = 0

  for (const [exts, lang] of extLangMap) {
    const total = exts.reduce((sum, e) => sum + (counts[e] ?? 0), 0)
    if (total > bestCount) {
      bestCount = total
      best = lang
    }
  }

  return best
}

// ---- Entry point detection ----

function detectEntryPoints(dir: string): string[] {
  const candidates = [
    'src/app/page.tsx',
    'src/app/page.ts',
    'pages/index.tsx',
    'pages/index.ts',
    'src/main.ts',
    'src/main.tsx',
    'src/main.js',
    'src/main.jsx',
    'src/index.ts',
    'src/index.tsx',
    'src/index.js',
    'src/index.jsx',
    'src/App.tsx',
    'src/App.jsx',
    'main.py',
    'app.py',
    'src/main.py',
    'main.go',
    'src/main.rs',
    'src/lib.rs',
  ]

  const found: string[] = []
  for (const rel of candidates) {
    if (fs.existsSync(path.join(dir, rel))) found.push(rel)
  }

  // cmd/*/main.go pattern
  const cmdDir = path.join(dir, 'cmd')
  if (fs.existsSync(cmdDir)) {
    try {
      const subdirs = fs.readdirSync(cmdDir, { withFileTypes: true })
      for (const sub of subdirs) {
        if (sub.isDirectory()) {
          const goMain = `cmd/${sub.name}/main.go`
          if (fs.existsSync(path.join(dir, goMain))) found.push(goMain)
        }
      }
    } catch {
      // ignore
    }
  }

  return found
}

// ---- Directory role scanning ----

function scanDirectories(dir: string, fileTree: FileTreeNode[]): DirectoryInfo[] {
  const result: DirectoryInfo[] = []

  function visitNode(node: FileTreeNode) {
    if (node.type !== 'dir') return
    const role = assignDirectoryRole(node.path)

    if (role) {
      // Count files and dominant extension within this dir
      const allInDir = flattenTree(node.children ?? []).filter((n) => n.type === 'file')
      const extCounts: Record<string, number> = {}
      for (const f of allInDir) {
        const ext = path.extname(f.name).toLowerCase()
        if (ext) extCounts[ext] = (extCounts[ext] ?? 0) + 1
      }
      const dominant = Object.entries(extCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      result.push({
        path: node.path,
        fileCount: allInDir.length,
        dominantExtension: dominant,
        role,
      })
    }

    // Check for monorepo packages/apps
    const name = node.name
    if (name === 'packages' || name === 'apps') {
      for (const child of node.children ?? []) {
        if (child.type === 'dir') {
          const hasPkg = fs.existsSync(path.join(dir, child.path, 'package.json'))
            || fs.existsSync(path.join(dir, child.path, 'pyproject.toml'))
          if (hasPkg) {
            result.push({
              path: child.path,
              fileCount: flattenTree(child.children ?? []).filter((n) => n.type === 'file').length,
              dominantExtension: null,
              role: 'monorepo-package',
            })
          }
        }
      }
    }

    for (const child of node.children ?? []) {
      visitNode(child)
    }
  }

  for (const node of fileTree) {
    visitNode(node)
  }

  return result
}

// ---- Key file extraction ----

function readFileCapped(absPath: string): string {
  try {
    const raw = fs.readFileSync(absPath, 'utf-8')
    const lines = raw.split('\n').slice(0, KEY_FILE_LINE_LIMIT)
    const joined = lines.join('\n')
    return joined.length > KEY_FILE_BYTE_LIMIT ? joined.slice(0, KEY_FILE_BYTE_LIMIT) : joined
  } catch {
    return ''
  }
}

function collectKeyFiles(dir: string, fileTree: FileTreeNode[]): Record<string, string> {
  const result: Record<string, string> = {}
  let budget = KEY_FILE_BUDGET

  function tryAdd(relPath: string) {
    if (budget <= 0) return
    const absPath = path.join(dir, relPath)
    if (!fs.existsSync(absPath)) return
    const content = readFileCapped(absPath)
    if (!content) return
    result[relPath] = content
    budget -= Buffer.byteLength(content, 'utf-8')
  }

  // Priority 1: README
  for (const name of ['README.md', 'README.rst', 'README.txt', 'readme.md']) {
    tryAdd(name)
    if (result[name]) break
  }

  // Priority 2: Manifests
  for (const name of ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
    tryAdd(name)
  }

  // Priority 3: Compose files
  for (const name of ['docker-compose.yml', 'docker-compose.yaml']) {
    tryAdd(name)
    if (result[name]) break
  }

  // Priority 4: Framework config
  for (const name of [
    'next.config.js',
    'next.config.ts',
    'next.config.mjs',
    'tsconfig.json',
    'vite.config.ts',
    'vite.config.js',
  ]) {
    tryAdd(name)
  }

  // Priority 5: Entry points
  const entries = detectEntryPoints(dir)
  for (const ep of entries.slice(0, 3)) {
    tryAdd(ep)
  }

  // Priority 6: Up to 5 largest source files in src/
  if (budget > 0) {
    const srcFiles = flattenTree(fileTree)
      .filter((n) => n.type === 'file' && n.path.startsWith('src/') && n.size !== undefined)
      .filter((n) => {
        const name = n.name.toLowerCase()
        return !name.includes('test') && !name.includes('spec') && !name.endsWith('.d.ts')
      })
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
      .slice(0, 5)

    for (const f of srcFiles) {
      if (!result[f.path]) tryAdd(f.path)
    }
  }

  return result
}

// ---- Line count estimation ----

function estimateLines(keyFiles: Record<string, string>, totalFiles: number): number {
  const sampledLines = Object.values(keyFiles).reduce(
    (sum, content) => sum + content.split('\n').length,
    0
  )
  const sampledFiles = Object.keys(keyFiles).length
  if (sampledFiles === 0) return 0
  // Extrapolate: sampled average * total files
  const avgPerFile = sampledLines / sampledFiles
  return Math.round(avgPerFile * totalFiles)
}

// ---- Main export ----

export async function scanProject(dir: string): Promise<ProjectScan> {
  const absDir = path.resolve(dir)

  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new Error(`Directory does not exist: ${dir}`)
  }

  const fileCount = { value: 0 }
  const truncated = { value: false }

  const fileTree = walkTree(absDir, '', 0, fileCount, truncated)
  const dependencies = extractDependencies(absDir)
  const framework = detectFramework(absDir, dependencies, fileTree)
  const language = detectLanguage(absDir, fileTree)
  const entryPoints = detectEntryPoints(absDir)
  const directories = scanDirectories(absDir, fileTree)
  const keyFileContents = collectKeyFiles(absDir, fileTree)
  const totalLines = estimateLines(keyFileContents, fileCount.value)

  return {
    name: path.basename(absDir),
    framework,
    language,
    fileTree,
    dependencies,
    entryPoints,
    directories,
    totalFiles: fileCount.value,
    totalLines,
    keyFileContents,
    ...(truncated.value ? { truncated: true } : {}),
  }
}
