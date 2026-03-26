import type { AgentBackendType } from '@/lib/types'

export const runtime = 'nodejs'

const FALLBACK_MODELS: Record<AgentBackendType, string[]> = {
  'claude-code': [
    'claude-sonnet-4-6',
    'claude-opus-4-6',
    'claude-haiku-4-5-20251001',
  ],
  codex: [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.2',
    'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini',
  ],
  gemini: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ],
}

async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/models`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) return []

  const data = (await response.json()) as { data?: { id: string }[] }
  return (data.data ?? []).map((m) => m.id).sort()
}

async function fetchGeminiModels(): Promise<string[]> {
  // Try Google AI Studio API with key from environment
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  if (!apiKey) return FALLBACK_MODELS.gemini

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) })

  if (!response.ok) return FALLBACK_MODELS.gemini

  const data = (await response.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace('models/', ''))
    .sort()
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const backend = searchParams.get('backend') as AgentBackendType | null
  const apiKey = searchParams.get('apiKey')
  const baseUrl = searchParams.get('baseUrl')

  if (!backend) {
    return Response.json({ error: 'backend is required' }, { status: 400 })
  }

  try {
    let models: string[]

    if (baseUrl && apiKey) {
      // Custom provider — fetch from OpenAI-compatible endpoint
      models = await fetchOpenAIModels(baseUrl, apiKey)
      if (models.length === 0) models = FALLBACK_MODELS[backend] ?? []
    } else if (backend === 'gemini') {
      models = await fetchGeminiModels()
    } else {
      models = FALLBACK_MODELS[backend] ?? []
    }

    return Response.json({ models })
  } catch {
    return Response.json({ models: FALLBACK_MODELS[backend] ?? [] })
  }
}
