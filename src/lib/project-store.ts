import fs from 'fs'
import path from 'path'
import type { ArchitectProject } from '@/lib/types'

const PROJECT_FILE = 'architect.json'

function getProjectPath(dir: string) {
  return path.join(dir, PROJECT_FILE)
}

export function saveProject(dir: string, project: ArchitectProject) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getProjectPath(dir), JSON.stringify(project, null, 2), 'utf8')
}

export function loadProject(dir: string): ArchitectProject | null {
  const projectPath = getProjectPath(dir)

  if (!fs.existsSync(projectPath)) {
    return null
  }

  return JSON.parse(fs.readFileSync(projectPath, 'utf8')) as ArchitectProject
}
