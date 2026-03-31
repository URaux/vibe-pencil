import fs from 'fs'
import path from 'path'
import { invalidateSkillIndex } from '@/lib/skill-loader'

export const runtime = 'nodejs'

interface ImportRequest {
  source: string
}

interface ImportedSkill {
  name: string
  path: string
}

// Convert GitHub blob URL to raw URL
function toRawGitHubUrl(url: string): string {
  // https://github.com/user/repo/blob/main/path/file.md
  // → https://raw.githubusercontent.com/user/repo/main/path/file.md
  return url
    .replace('https://github.com/', 'https://raw.githubusercontent.com/')
    .replace('/blob/', '/')
}

// Infer category from file path or content keywords
function inferCategory(filePath: string, content: string): string {
  const lower = (filePath + ' ' + content.slice(0, 500)).toLowerCase()
  if (lower.includes('react') || lower.includes('vue') || lower.includes('frontend') || lower.includes('css') || lower.includes('html')) return 'frontend'
  if (lower.includes('backend') || lower.includes('api') || lower.includes('server') || lower.includes('database') || lower.includes('sql')) return 'backend'
  if (lower.includes('architect') || lower.includes('system design') || lower.includes('microservice')) return 'architect'
  if (lower.includes('test') || lower.includes('jest') || lower.includes('vitest') || lower.includes('cypress')) return 'testing'
  return 'core'
}

// Parse YAML frontmatter (simple key: value, arrays as [a, b])
function parseFrontmatter(raw: string): { meta: Record<string, string | string[]>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { meta: {}, body: raw }
  const meta: Record<string, string | string[]> = {}
  for (const line of match[1].split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim())
    if (!kv) continue
    const [, key, val] = kv
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
    } else {
      meta[key] = val.trim()
    }
  }
  return { meta, body: match[2] }
}

// Build frontmatter + content and save to disk
function saveSkill(
  name: string,
  category: string,
  description: string,
  scope: string[],
  tags: string[],
  content: string,
  sourceType: 'github' | 'local',
): ImportedSkill {
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const frontmatter = [
    '---',
    `name: ${safeName}`,
    `description: ${description}`,
    `category: ${category}`,
    `source: ${sourceType}`,
    `tags: [${tags.join(', ')}]`,
    `scope: [${scope.join(', ')}]`,
    `priority: 85`,
    '---',
    '',
  ].join('\n')

  const dir = path.join(process.cwd(), 'skills', sourceType === 'github' ? 'github' : 'local')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const filePath = path.join(dir, `${safeName}.md`)
  fs.writeFileSync(filePath, frontmatter + content.trim() + '\n', 'utf-8')

  return { name: safeName, path: `skills/${sourceType === 'github' ? 'github' : 'local'}/${safeName}.md` }
}

// Process a single markdown content string into a saved skill
function processContent(
  content: string,
  fileName: string,
  filePath: string,
  sourceType: 'github' | 'local',
): ImportedSkill {
  const { meta, body } = parseFrontmatter(content)

  const name = typeof meta.name === 'string' && meta.name
    ? meta.name
    : path.basename(fileName, '.md')

  const category = typeof meta.category === 'string' && meta.category
    ? meta.category
    : inferCategory(filePath, content)

  const description = typeof meta.description === 'string' && meta.description
    ? meta.description
    : body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.slice(0, 120) ?? ''

  const scope = Array.isArray(meta.scope) && meta.scope.length
    ? meta.scope
    : ['global', 'node', 'build']

  const tags = Array.isArray(meta.tags) && meta.tags.length ? meta.tags : []

  // If there was valid frontmatter, use body; otherwise use full content
  const bodyToSave = Object.keys(meta).length > 0 ? body : content

  return saveSkill(name, category, description, scope, tags, bodyToSave, sourceType)
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ImportRequest

    if (!payload.source?.trim()) {
      return Response.json({ error: 'source is required' }, { status: 400 })
    }

    const source = payload.source.trim()
    const imported: ImportedSkill[] = []

    if (source.startsWith('http://') || source.startsWith('https://')) {
      // URL import
      const rawUrl = source.includes('github.com') ? toRawGitHubUrl(source) : source
      const res = await fetch(rawUrl)
      if (!res.ok) {
        return Response.json({ error: `Failed to fetch URL: ${res.status} ${res.statusText}` }, { status: 400 })
      }
      const content = await res.text()
      const fileName = path.basename(new URL(rawUrl).pathname)
      imported.push(processContent(content, fileName, rawUrl, 'github'))
    } else {
      // Local path import
      const normalizedPath = source.replace(/\\/g, '/')

      if (!fs.existsSync(normalizedPath)) {
        return Response.json({ error: `Path not found: ${source}` }, { status: 400 })
      }

      const stat = fs.statSync(normalizedPath)

      if (stat.isDirectory()) {
        // Batch import: read all .md files up to depth 2
        const collectMd = (dir: string, depth: number): string[] => {
          if (depth > 2) return []
          const files: string[] = []
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isFile() && entry.name.endsWith('.md')) {
              files.push(full)
            } else if (entry.isDirectory() && depth < 2) {
              files.push(...collectMd(full, depth + 1))
            }
          }
          return files
        }
        const mdFiles = collectMd(normalizedPath, 0)
        if (mdFiles.length === 0) {
          return Response.json({ error: 'No .md files found in directory' }, { status: 400 })
        }
        for (const fp of mdFiles) {
          const content = fs.readFileSync(fp, 'utf-8')
          imported.push(processContent(content, path.basename(fp), fp, 'local'))
        }
      } else {
        // Single file
        if (!normalizedPath.endsWith('.md')) {
          return Response.json({ error: 'Only .md files are supported' }, { status: 400 })
        }
        const content = fs.readFileSync(normalizedPath, 'utf-8')
        imported.push(processContent(content, path.basename(normalizedPath), normalizedPath, 'local'))
      }
    }

    invalidateSkillIndex()

    return Response.json({ ok: true, imported })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to import skill' },
      { status: 500 },
    )
  }
}
