import type { Handler, HandlerContext, HandlerResult, Intent } from './types'
import { handleDesignEdit } from './handlers/design_edit'
import { handleBuild } from './handlers/build'
import { handleModify } from './handlers/modify'
import { handleDeepAnalyze } from './handlers/deep_analyze'
import { handleExplain } from './handlers/explain'

const handlersByIntent: Record<Intent, Handler> = {
  design_edit: handleDesignEdit,
  build: handleBuild,
  modify: handleModify,
  deep_analyze: handleDeepAnalyze,
  explain: handleExplain,
}

export async function dispatchIntent(ctx: HandlerContext): Promise<HandlerResult> {
  if (ctx.classifyResult.fallback === true) {
    return handleExplain(ctx)
  }
  return handlersByIntent[ctx.classifyResult.intent](ctx)
}
