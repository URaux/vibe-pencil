import { loadSkillIndex, invalidateSkillIndex } from '@/lib/skill-loader'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    invalidateSkillIndex()  // Always reload fresh
    const index = loadSkillIndex()

    const skills = index.map((entry) => ({
      name: entry.metadata.name,
      description: entry.metadata.description,
      category: entry.metadata.category,
      source: entry.metadata.source,
      tags: entry.metadata.tags,
      scope: entry.metadata.scope,
      priority: entry.metadata.priority,
    }))

    return Response.json({ skills, total: skills.length })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load skills' },
      { status: 500 }
    )
  }
}
