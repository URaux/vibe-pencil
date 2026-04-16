import { promises as fs } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DATA_DIR = path.join(process.cwd(), 'data')
const FILE_PATH = path.join(DATA_DIR, 'sessions.json')
const TMP_PATH = path.join(DATA_DIR, 'sessions.json.tmp')

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

export async function GET() {
  try {
    const raw = await fs.readFile(FILE_PATH, 'utf8')
    const sessions = JSON.parse(raw)
    if (!Array.isArray(sessions)) throw new Error('not an array')
    return Response.json({ sessions })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return Response.json({ sessions: [] })
    console.error('[api/sessions] GET failed:', err)
    return Response.json({ sessions: [], error: String(err) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const sessions = body?.sessions
    if (!Array.isArray(sessions)) {
      return Response.json({ error: 'sessions must be an array' }, { status: 400 })
    }
    await ensureDir()
    // Atomic write: write temp, then rename. Survives crashes mid-write.
    await fs.writeFile(TMP_PATH, JSON.stringify(sessions), 'utf8')
    await fs.rename(TMP_PATH, FILE_PATH)
    return Response.json({ ok: true, count: sessions.length })
  } catch (err) {
    console.error('[api/sessions] POST failed:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
