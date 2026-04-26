import type { Handler, HandlerResult } from '../types'

export const handleBuild: Handler = async (ctx): Promise<HandlerResult> => {
  return { intent: 'build', status: 'not_implemented', payload: { intent: 'build', userPrompt: ctx.userPrompt } }
}
