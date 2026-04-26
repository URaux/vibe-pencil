import type { Handler, HandlerResult } from '../types'

export const handleModify: Handler = async (ctx): Promise<HandlerResult> => {
  return { intent: 'modify', status: 'not_implemented', payload: { intent: 'modify', userPrompt: ctx.userPrompt } }
}
