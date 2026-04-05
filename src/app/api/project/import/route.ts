import fs from 'fs'
import { extractAgentText, extractJsonObject } from '@/lib/agent-output'
import { buildSystemContext } from '@/lib/context-engine'
import { agentRunner } from '@/lib/agent-runner-instance'
import { normalizeCanvas } from '@/lib/import-normalizer'
import type { Locale } from '@/lib/i18n'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ImportProjectRequest {
  dir: string
  backend?: 'claude-code' | 'codex' | 'gemini'
  locale?: Locale // NEW
}

function getBackend(backend?: 'claude-code' | 'codex' | 'gemini') {
  if (backend === 'codex' || backend === 'claude-code' || backend === 'gemini') {
    return backend
  }

  const envBackend = process.env.VIBE_IMPORT_AGENT_BACKEND
  return envBackend === 'codex' || envBackend === 'gemini' || envBackend === 'claude-code' ? envBackend : 'codex'
}

function buildPrompt(dir: string, locale: Locale = 'en') {
  return buildSystemContext({
    agentType: 'canvas',
    task: 'import',
    locale,
    taskParams: { dir: dir.trim() },
  })
}

async function waitForCompletion(agentId: string, timeoutMs = 300000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const status = agentRunner.getStatus(agentId)

    if (!status) {
      throw new Error('Import agent not found.')
    }

    if (status.status === 'done') {
      if (status.exitCode && status.exitCode !== 0 && !status.output.trim()) {
        throw new Error(
          `Agent exited with code ${status.exitCode}.${status.errorMessage ? ` ${status.errorMessage.slice(0, 200)}` : ''}`
        )
      }
      // Non-zero exit with output — attempt best-effort parse (deliberate: fall through)
      return status
    }

    if (status.status === 'error') {
      const code = status.exitCode
      const stderr = status.errorMessage?.slice(0, 300) ?? ''
      const parts = ['Import agent failed']
      if (code !== undefined && code !== null) parts.push(`(exit code ${code})`)
      if (stderr) parts.push(`: ${stderr}`)
      throw new Error(parts.join(''))
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  agentRunner.stopAgent(agentId)
  throw new Error('Import timed out after 5 minutes. Try a smaller project or a faster backend.')
}

export async function POST(request: Request) {
  const { dir, backend, locale } = (await request.json()) as ImportProjectRequest

  if (!dir?.trim()) {
    return Response.json({ error: 'Project directory path cannot be empty.' }, { status: 400 })
  }

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return Response.json({ error: 'Project directory does not exist.' }, { status: 400 })
  }

  try {
    const agentId = agentRunner.spawnAgent(
      'project-import',
      buildPrompt(dir, locale),
      getBackend(backend),
      dir
    )
    const status = await waitForCompletion(agentId)
    const agentText = extractAgentText(status.output)
    const parsed = extractJsonObject(agentText)

    if (!parsed) {
      throw new Error('Could not parse structured JSON from the import agent output.')
    }

    const canvas = normalizeCanvas(parsed)
    return Response.json(canvas)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Project import failed.' },
      { status: 500 }
    )
  }
}
