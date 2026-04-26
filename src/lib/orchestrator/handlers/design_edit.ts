import type { Handler, HandlerResult } from '../types'

export const handleDesignEdit: Handler = async (ctx): Promise<HandlerResult> => {
  return { intent: 'design_edit', status: 'not_implemented', payload: { intent: 'design_edit', userPrompt: ctx.userPrompt } }
}
