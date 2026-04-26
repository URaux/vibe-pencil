/**
 * /api/drift — W3.D3.
 *
 * POST endpoint that diffs two Ir snapshots and returns a DriftReport plus a
 * pre-rendered markdown summary suitable for chat surface.
 *
 * Request body shape (JSON): { headIr: Ir }
 *   - headIr is the freshly-ingested IR the caller produced from current code
 *
 * Server reads baseIr from `.archviber/ir.yaml` via the existing readIrFile
 * helper. If no base IR exists, the route returns 404; the UI should then
 * offer to seed the IR rather than treating the entire codebase as "added".
 *
 * Response: { summary, report, markdown }
 */

import { readIrFile } from '@/lib/ir/persist'
import { irSchema, type Ir } from '@/lib/ir/schema'
import { detectDrift, summarizeDrift } from '@/lib/drift/detect'
import { renderDriftMarkdown } from '@/lib/drift/render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DriftRequest {
  headIr?: unknown
}

export async function POST(request: Request): Promise<Response> {
  let payload: DriftRequest
  try {
    payload = (await request.json()) as DriftRequest
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (payload.headIr === undefined) {
    return Response.json({ error: 'missing headIr in request body' }, { status: 400 })
  }

  const headParse = irSchema.safeParse(payload.headIr)
  if (!headParse.success) {
    return Response.json(
      { error: `headIr failed validation: ${headParse.error.issues[0]?.message ?? 'unknown'}` },
      { status: 400 }
    )
  }
  const headIr: Ir = headParse.data

  const baseIr = await readIrFile(process.cwd())
  if (!baseIr) {
    return Response.json(
      { error: 'no base IR at .archviber/ir.yaml — run an initial ingest first' },
      { status: 404 }
    )
  }

  const report = detectDrift(baseIr, headIr)
  const summary = summarizeDrift(report)
  const markdown = renderDriftMarkdown(report)

  return Response.json({ summary, report, markdown })
}
