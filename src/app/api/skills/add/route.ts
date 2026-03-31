import fs from 'fs'
import path from 'path'
import { invalidateSkillIndex } from '@/lib/skill-loader'

export const runtime = 'nodejs'

interface AddSkillRequest {
  name: string
  category: string
  description: string
  scope: string[]
  tags: string[]
  content: string
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as AddSkillRequest

    if (!payload.name?.trim() || !payload.content?.trim()) {
      return Response.json({ error: 'Name and content are required.' }, { status: 400 })
    }

    const name = payload.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
    const category = payload.category || 'core'
    const scope = payload.scope?.length ? payload.scope : ['global', 'node', 'build']
    const tags = payload.tags?.length ? payload.tags : []

    const frontmatter = [
      '---',
      `name: ${name}`,
      `description: ${payload.description || ''}`,
      `category: ${category}`,
      `source: local`,
      `tags: [${tags.join(', ')}]`,
      `scope: [${scope.join(', ')}]`,
      `priority: 85`,
      '---',
      '',
    ].join('\n')

    const fileContent = frontmatter + payload.content.trim() + '\n'
    const dir = path.join(process.cwd(), 'skills', category)

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const filePath = path.join(dir, `${name}.md`)
    fs.writeFileSync(filePath, fileContent, 'utf-8')

    invalidateSkillIndex()

    return Response.json({ ok: true, path: `skills/${category}/${name}.md` })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to add skill' },
      { status: 500 }
    )
  }
}
