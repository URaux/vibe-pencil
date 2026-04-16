import { watch } from 'node:fs'
import { promises as fs } from 'node:fs'
import { irFilePath } from '@/lib/ir'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROJECT_ROOT = process.cwd()

export interface IrWatchEvent {
  type: 'changed' | 'deleted'
  mtime?: number
  size?: number
}

/**
 * SSE stream that pushes ir.yaml disk-change events to the client.
 *
 * Deduplication: consecutive events with the same mtime+size are suppressed.
 * The client is responsible for comparing the pushed mtime against its own
 * lastMtime so it can ignore events caused by its own autosave writes.
 *
 * Fallback: clients that cannot use SSE should fall back to polling HEAD /api/ir.
 */
export async function GET() {
  const filePath = irFilePath(PROJECT_ROOT)

  let lastMtime: number | null = null
  let lastSize: number | null = null
  let watcher: ReturnType<typeof watch> | null = null
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null

  const encoder = new TextEncoder()

  function sendEvent(event: IrWatchEvent) {
    if (!controller) return
    try {
      const data = `data: ${JSON.stringify(event)}\n\n`
      controller.enqueue(encoder.encode(data))
    } catch {
      // Stream already closed — ignore
    }
  }

  async function handleChange() {
    try {
      const stat = await fs.stat(filePath)
      const mtime = stat.mtimeMs
      const size = stat.size

      // Deduplicate: skip if mtime+size unchanged
      if (mtime === lastMtime && size === lastSize) return

      lastMtime = mtime
      lastSize = size
      sendEvent({ type: 'changed', mtime, size })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        lastMtime = null
        lastSize = null
        sendEvent({ type: 'deleted' })
      }
      // Other errors: silently ignore; watcher will retry on next fs event
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c

      // Send initial keepalive comment so the browser marks the connection open
      c.enqueue(encoder.encode(': connected\n\n'))

      try {
        watcher = watch(filePath, { persistent: false }, () => {
          void handleChange()
        })

        watcher.on('error', () => {
          // File may not exist yet — watch will error; client falls back to polling
          try {
            c.close()
          } catch {
            /* already closed */
          }
        })
      } catch {
        // File doesn't exist yet; close stream so client falls back to polling
        try {
          c.close()
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      controller = null
      try {
        watcher?.close()
      } catch {
        /* ignore */
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
