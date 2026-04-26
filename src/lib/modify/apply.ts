import fs from 'node:fs/promises'
import type { RenamePlan } from './rename'

export async function applyRenamePlan(projectRoot: string, plan: RenamePlan): Promise<void> {
  for (const fileEdit of plan.fileEdits) {
    const content = await fs.readFile(fileEdit.filePath, 'utf8')
    const sortedEdits = [...fileEdit.edits].sort((a, b) => b.start - a.start)

    let result = content
    for (const edit of sortedEdits) {
      result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
    }

    await fs.writeFile(fileEdit.filePath, result, 'utf8')
  }
}

export async function applyRenamePlanMapped(
  projectRoot: string,
  plan: RenamePlan,
  pathMapper: (orig: string) => string
): Promise<void> {
  for (const fileEdit of plan.fileEdits) {
    const srcPath = fileEdit.filePath
    const destPath = pathMapper(srcPath)
    const content = await fs.readFile(srcPath, 'utf8')
    const sortedEdits = [...fileEdit.edits].sort((a, b) => b.start - a.start)

    let result = content
    for (const edit of sortedEdits) {
      result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
    }

    await fs.writeFile(destPath, result, 'utf8')
  }
}
