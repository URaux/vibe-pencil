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
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  'custom-api': [],
}

async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, '')
  const headers = { Authorization: `Bearer ${apiKey}` }

  // Try multiple paths: some APIs use /models, others /v1/models
  const candidates = base.endsWith('/v1')
    ? [`${base}/models`]
    : [`${base}/models`, `${base}/v1/models`]

  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(6000) })
      if (!response.ok) continue
      const data = (await response.json()) as { data?: { id: string }[] }
      const models = (data.data ?? []).map((m) => m.id).sort()
      if (models.length > 0) return models
    } catch {
      continue
    }
  }

  return []
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
    } else if (
      backend === 'claude-code' &&
      process.env.USE_RELAY === 'true' &&
      process.env.RELAY_API_BASE_URL &&
      process.env.RELAY_API_KEY
    ) {
      // Relay fallback: fetch available Claude models from relay endpoint
      models = await fetchOpenAIModels(process.env.RELAY_API_BASE_URL, process.env.RELAY_API_KEY)
      if (models.length === 0) models = FALLBACK_MODELS[backend] ?? []
    } else {
      // Use predefined model list for stability and cleanliness
      models = FALLBACK_MODELS[backend] ?? []
    }

    return Response.json({ models })
  } catch {
    return Response.json({ models: FALLBACK_MODELS[backend] ?? [] })
  }
}
