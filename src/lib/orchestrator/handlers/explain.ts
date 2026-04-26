import type { Handler, HandlerResult } from '../types'

export const handleExplain: Handler = async (ctx): Promise<HandlerResult> => {
  return { intent: 'explain', status: 'not_implemented', payload: { intent: 'explain', userPrompt: ctx.userPrompt } }
}
