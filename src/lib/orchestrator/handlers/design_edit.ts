import { agentRunner } from '@/lib/agent-runner-instance'
import type { AgentBackend } from '@/lib/agent-runner'
import { tryRepairJson, VALID_NODE_TYPES, VALID_EDGE_TYPES } from '@/lib/canvas-action-types'
import type { CanvasAction } from '@/lib/canvas-action-types'
import type { AgentRunnerLike } from '../classify'
import type { Handler, HandlerContext, HandlerResult } from '../types'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_BACKEND: AgentBackend = 'codex'
const DEFAULT_MODEL = 'gpt-5-codex-mini'
const POLL_INTERVAL_MS = 25

const DESIGN_EDIT_SYSTEM_PROMPT =
  'You are a design-edit planner for ArchViber. Given a user request and IR summary, output a JSON array of CanvasAction objects that achieve the request. Output ONLY the JSON array, no markdown, no prose. Each action must have a valid `action` field.'

export interface DesignEditOptions {
  runner?: AgentRunnerLike
  backend?: AgentBackend
  model?: string
  workDir?: string
  timeoutMs?: number
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

type AddNodeAction = Extract<CanvasAction, { action: 'add-node' }>
type UpdateNodeAction = Extract<CanvasAction, { action: 'update-node' }>
type AddEdgeAction = Extract<CanvasAction, { action: 'add-edge' }>

export function validateActions(raw: unknown): CanvasAction[] {
  if (!Array.isArray(raw)) {
    throw new Error('Validation failed: expected an array of actions')
  }

  const result: CanvasAction[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw new Error('Validation failed: each action must be an object')
    }

    const entry = item as Record<string, unknown>
    const action = entry['action']

    if (action === 'add-node') {
      const node = entry['node']
      if (!node || typeof node !== 'object') {
        throw new Error('Validation failed: add-node requires a node object')
      }
      const nodeObj = node as Record<string, unknown>
      if (nodeObj['type'] !== undefined && !VALID_NODE_TYPES.has(nodeObj['type'] as never)) {
        throw new Error(`Validation failed: add-node has invalid type "${String(nodeObj['type'])}"`)
      }
      result.push({ action: 'add-node', node: nodeObj } as AddNodeAction)
    } else if (action === 'update-node') {
      const target_id = entry['target_id']
      if (typeof target_id !== 'string' || !target_id) {
        throw new Error('Validation failed: update-node requires a target_id string')
      }
      const data = entry['data']
      if (!data || typeof data !== 'object') {
        throw new Error('Validation failed: update-node requires a data object')
      }
      result.push({ action: 'update-node', target_id, data } as UpdateNodeAction)
    } else if (action === 'remove-node') {
      const target_id = entry['target_id']
      if (typeof target_id !== 'string' || !target_id) {
        throw new Error('Validation failed: remove-node requires a target_id string')
      }
      result.push({ action: 'remove-node', target_id })
    } else if (action === 'add-edge') {
      const edge = entry['edge']
      if (!edge || typeof edge !== 'object') {
        throw new Error('Validation failed: add-edge requires an edge object')
      }
      const edgeObj = edge as Record<string, unknown>
      if (typeof edgeObj['source'] !== 'string' || !edgeObj['source']) {
        throw new Error('Validation failed: add-edge edge must have a source string')
      }
      if (typeof edgeObj['target'] !== 'string' || !edgeObj['target']) {
        throw new Error('Validation failed: add-edge edge must have a target string')
      }
      if (edgeObj['type'] !== undefined && !VALID_EDGE_TYPES.has(edgeObj['type'] as never)) {
        throw new Error(`Validation failed: add-edge has invalid type "${String(edgeObj['type'])}"`)
      }
      result.push({ action: 'add-edge', edge: edgeObj } as AddEdgeAction)
    } else {
      throw new Error(`Validation failed: unknown action "${String(action)}"`)
    }
  }

  return result
}

async function waitForTerminalStatus(
  runner: AgentRunnerLike,
  agentId: string,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    const status = runner.getStatus(agentId)
    if (!status) {
      return { type: 'missing' as const, rawOutput: '', errorMessage: 'Agent status disappeared' }
    }

    if (status.status === 'done') {
      return { type: 'done' as const, rawOutput: status.output }
    }

    if (status.status === 'error') {
      return {
        type: 'error' as const,
        rawOutput: status.output,
        errorMessage: status.errorMessage ?? 'Agent failed',
      }
    }

    await sleep(POLL_INTERVAL_MS)
  }

  try {
    runner.stopAgent?.(agentId)
  } catch {
    // Best-effort stop only.
  }

  return { type: 'timeout' as const, rawOutput: runner.getStatus(agentId)?.output ?? '' }
}

export function makeDesignEditHandler(opts: DesignEditOptions = {}): Handler {
  return async (ctx: HandlerContext): Promise<HandlerResult> => {
    const runner = opts.runner ?? ctx.runner ?? agentRunner
    const backend = opts.backend ?? DEFAULT_BACKEND
    const model = opts.model ?? DEFAULT_MODEL
    const workDir = opts.workDir ?? ctx.workDir ?? process.cwd()
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const agentPrompt = JSON.stringify({
      task: 'plan canvas edits',
      userPrompt: ctx.userPrompt,
      irSummary: ctx.irSummary,
      allowedActions: ['add-node', 'update-node', 'remove-node', 'add-edge'],
      allowedNodeTypes: ['container', 'block'],
      allowedEdgeTypes: ['sync', 'async', 'bidirectional'],
    })

    const agentId = runner.spawnAgent(
      'orchestrator-design-edit',
      agentPrompt,
      backend,
      workDir,
      model,
      undefined,
      undefined,
      DESIGN_EDIT_SYSTEM_PROMPT
    )

    const terminal = await waitForTerminalStatus(runner, agentId, timeoutMs)

    if (terminal.type === 'timeout') {
      return { intent: 'design_edit', status: 'error', error: `Design edit timeout after ${timeoutMs}ms` }
    }

    if (terminal.type === 'missing') {
      return { intent: 'design_edit', status: 'error', error: terminal.errorMessage }
    }

    if (terminal.type === 'error') {
      return { intent: 'design_edit', status: 'error', error: `Design edit agent error: ${terminal.errorMessage}` }
    }

    const parsed = tryRepairJson(terminal.rawOutput)
    if (parsed === null) {
      return {
        intent: 'design_edit',
        status: 'error',
        error: 'Design edit parse failed: could not extract JSON from agent output',
      }
    }

    let actions: CanvasAction[]
    try {
      actions = validateActions(parsed)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { intent: 'design_edit', status: 'error', error: message }
    }

    return { intent: 'design_edit', status: 'ok', payload: { actions } }
  }
}

export const handleDesignEdit: Handler = makeDesignEditHandler()
export const designEditHandler: Handler = handleDesignEdit
