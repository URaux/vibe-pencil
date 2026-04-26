import { buildAnalystInput } from '@/lib/deep-analyze/prompt-builder'
import { PERSPECTIVE_NAMES } from '@/lib/deep-analyze/types'
import type { Handler, HandlerResult } from '../types'

export const handleDeepAnalyze: Handler = async (ctx): Promise<HandlerResult> => {
  if (!ctx.ir) {
    return { intent: 'deep_analyze', status: 'error', error: 'deep_analyze requires full IR' }
  }

  const projectRoot = ctx.workDir ?? process.cwd()
  const analystInputs = PERSPECTIVE_NAMES.map((perspective) =>
    buildAnalystInput(perspective, ctx.ir!, projectRoot)
  )

  return {
    intent: 'deep_analyze',
    status: 'ok',
    payload: { perspectives: PERSPECTIVE_NAMES, analystInputs },
  }
}
