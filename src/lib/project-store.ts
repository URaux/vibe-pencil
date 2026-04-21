import fs from 'fs'
import path from 'path'
import type { ArchitectProject } from '@/lib/types'

const PROJECT_FILE = 'architect.json'

function getProjectPath(dir: string) {
  return path.join(dir, PROJECT_FILE)
}

// Any caller-supplied `dir` must resolve inside the server's cwd. Prior to
// this guard, the save/load routes trusted `dir` from the request body and
// would read/write `architect.json` anywhere on disk — arbitrary-file-write
// primitive exposed to any client. Override via ARCHVIBER_PROJECT_ROOT env
// if a deployment needs a different base (e.g. absolute workspace mount).
function resolveAllowedDir(dir: string): string {
  if (typeof dir !== 'string' || !dir.trim()) {
    throw new Error('project dir required')
  }
  const root = process.env.ARCHVIBER_PROJECT_ROOT
    ? path.resolve(process.env.ARCHVIBER_PROJECT_ROOT)
    : process.cwd()
  const resolved = path.resolve(root, dir)
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`project dir must be inside ${root} (got ${resolved})`)
  }
  return resolved
}

export function saveProject(dir: string, project: ArchitectProject) {
  const safeDir = resolveAllowedDir(dir)
  fs.mkdirSync(safeDir, { recursive: true })
  fs.writeFileSync(getProjectPath(safeDir), JSON.stringify(project, null, 2), 'utf8')
}

export function loadProject(dir: string): ArchitectProject | null {
  const safeDir = resolveAllowedDir(dir)
  const projectPath = getProjectPath(safeDir)

  if (!fs.existsSync(projectPath)) {
    return null
  }

  return JSON.parse(fs.readFileSync(projectPath, 'utf8')) as ArchitectProject
}
