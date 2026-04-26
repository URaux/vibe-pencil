import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'

export async function makeTmpProject(
  files: Record<string, string>
): Promise<{ projectRoot: string; cleanup: () => Promise<void> }> {
  const id = crypto.randomBytes(8).toString('hex')
  const projectRoot = path.join(os.tmpdir(), `archviber-test-${id}`)
  await fs.mkdir(projectRoot, { recursive: true })

  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(projectRoot, relPath)
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, content, 'utf8')
  }

  const cleanup = async () => {
    try {
      await fs.rm(projectRoot, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup
    }
  }

  return { projectRoot, cleanup }
}
