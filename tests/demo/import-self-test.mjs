/**
 * Import-self demo: runs the full import → enhance pipeline on the ArchViber
 * repo against a locally-running dev server, captures the resulting canvas
 * state and writes it as a reviewable artifact.
 *
 * Usage: node tests/demo/import-self-test.mjs
 * Requires: `npm run dev` already running at http://localhost:3000
 */

import { promises as fs } from 'fs'
import path from 'path'

const BASE = process.env.ARCHVIBER_BASE ?? 'http://localhost:3000'
const PROJECT_DIR = process.env.TARGET_DIR ?? process.cwd()
const BACKEND = process.env.BACKEND ?? 'claude-code'
const OUTPUT_DIR = path.join(process.cwd(), '.planning', 'phase1', 'demo-runs')

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function main() {
  console.log(`[demo] base=${BASE} target=${PROJECT_DIR} backend=${BACKEND}`)
  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const runId = `self-import-${ts()}`
  const artifact = {
    runId,
    base: BASE,
    target: PROJECT_DIR,
    backend: BACKEND,
    startedAt: new Date().toISOString(),
    scan: null,
    enhance: {
      events: [],
      finalCanvas: null,
      errors: [],
    },
    durations: {},
  }

  try {
    console.log('[demo] step 1: POST /api/project/scan')
    const t0 = Date.now()
    const scanRes = await fetch(`${BASE}/api/project/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dir: PROJECT_DIR }),
    })
    if (!scanRes.ok) {
      throw new Error(`scan failed HTTP ${scanRes.status}: ${await scanRes.text()}`)
    }
    const scanJson = await scanRes.json()
    artifact.scan = scanJson
    artifact.durations.scanMs = Date.now() - t0
    console.log(
      `[demo]   scan: ${scanJson.nodes?.length ?? 0} nodes, ${
        scanJson.edges?.length ?? 0
      } edges in ${artifact.durations.scanMs}ms`
    )

    console.log('[demo] step 2: POST /api/project/import/enhance (SSE)')
    const t1 = Date.now()
    const enhanceRes = await fetch(`${BASE}/api/project/import/enhance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dir: PROJECT_DIR,
        scan: scanJson.scan,
        skeletonNodes: scanJson.nodes,
        skeletonEdges: scanJson.edges,
        backend: BACKEND,
        locale: 'zh',
      }),
    })
    if (!enhanceRes.ok) {
      throw new Error(`enhance failed HTTP ${enhanceRes.status}: ${await enhanceRes.text()}`)
    }

    const reader = enhanceRes.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let idx
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const rawEvent = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 2)
        if (!rawEvent) continue

        const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'))
        if (!dataLine) continue

        try {
          const evt = JSON.parse(dataLine.slice(5).trim())
          artifact.enhance.events.push(evt)
          const head = evt.type ?? 'unknown'
          if (head === 'enhanced') {
            artifact.enhance.finalCanvas = {
              nodes: evt.nodes ?? [],
              edges: evt.edges ?? [],
              projectName: evt.projectName ?? null,
            }
            console.log(
              `[demo]   enhanced: ${evt.nodes?.length ?? 0} nodes, ${
                evt.edges?.length ?? 0
              } edges`
            )
          } else if (head === 'error') {
            artifact.enhance.errors.push(evt)
            console.log(`[demo]   error event: ${evt.message ?? JSON.stringify(evt)}`)
          } else {
            console.log(`[demo]   event: ${head}`)
          }
        } catch (err) {
          console.log(`[demo]   (unparsable data line: ${dataLine.slice(0, 120)})`)
        }
      }
    }
    artifact.durations.enhanceMs = Date.now() - t1

    artifact.success = Boolean(artifact.enhance.finalCanvas)
    artifact.completedAt = new Date().toISOString()
  } catch (err) {
    artifact.success = false
    artifact.fatalError = {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : null,
    }
    console.error(`[demo] FAIL: ${artifact.fatalError.message}`)
  }

  const outFile = path.join(OUTPUT_DIR, `${runId}.json`)
  await fs.writeFile(outFile, JSON.stringify(artifact, null, 2), 'utf8')
  console.log(`[demo] artifact: ${outFile}`)
  console.log(`[demo] success=${artifact.success}`)
  if (!artifact.success) process.exitCode = 1
}

main().catch((err) => {
  console.error('[demo] unhandled:', err)
  process.exitCode = 2
})
