import { promises as fs } from 'node:fs'
import path from 'node:path'
import { IrValidationError, irFilePath, readIrFile, writeIrFile } from '@/lib/ir/persist'
import { irSchema } from '@/lib/ir/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Canvas autosave target: the dev-server's own project root. Multi-project support
// lands in Phase 2 when workspace switching is a product feature.
const PROJECT_ROOT = process.cwd()

export async function GET() {
  try {
    const ir = await readIrFile(PROJECT_ROOT)
    if (ir === null) {
      return Response.json({ ir: null, path: irFilePath(PROJECT_ROOT) })
    }

    const stat = await fs.stat(irFilePath(PROJECT_ROOT))
    return Response.json({
      ir,
      path: irFilePath(PROJECT_ROOT),
      mtime: stat.mtimeMs,
      size: stat.size,
    })
  } catch (err) {
    if (err instanceof IrValidationError) {
      return Response.json(
        { error: 'ir validation failed', issues: err.issues },
        { status: 422 }
      )
    }
    console.error('[api/ir] GET failed:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = irSchema.safeParse(body?.ir)
    if (!parsed.success) {
      return Response.json(
        { error: 'ir validation failed', issues: parsed.error.issues },
        { status: 422 }
      )
    }

    const filePath = await writeIrFile(PROJECT_ROOT, parsed.data)
    const stat = await fs.stat(filePath)
    return Response.json({
      ok: true,
      path: filePath,
      mtime: stat.mtimeMs,
      size: stat.size,
    })
  } catch (err) {
    console.error('[api/ir] POST failed:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    await fs.unlink(irFilePath(PROJECT_ROOT))
    return Response.json({ ok: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return Response.json({ ok: true, absent: true })
    }
    console.error('[api/ir] DELETE failed:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

// Lightweight head check used by autosave to detect external edits without
// re-downloading the full IR payload.
export async function HEAD() {
  try {
    const stat = await fs.stat(irFilePath(PROJECT_ROOT))
    return new Response(null, {
      headers: {
        'x-ir-mtime': String(stat.mtimeMs),
        'x-ir-size': String(stat.size),
      },
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Response(null, { status: 404 })
    }
    return new Response(null, { status: 500 })
  }
}
