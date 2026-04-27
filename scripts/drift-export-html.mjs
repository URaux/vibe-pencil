/**
 * drift-export-html.mjs — convert a drift result JSON into a self-contained HTML page.
 *
 * The input JSON is the `{ summary, report, markdown, violations }` object produced by
 * `drift-check.mjs --json`. Alternatively, a bare DriftReport object is accepted
 * (detected by checking for a `clean` field at the top level).
 *
 * Usage:
 *   node scripts/drift-export-html.mjs --in result.json --out drift.html
 *
 * Exit codes:
 *   0  HTML written successfully
 *   1  Missing/unreadable --in file, or --in / --out flags absent
 */

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
function getFlag(flag) {
  const i = args.indexOf(flag)
  return i === -1 ? null : (args[i + 1] ?? null)
}

const inPath = getFlag('--in')
const outPath = getFlag('--out')

if (!inPath || !outPath) {
  console.error('usage: node scripts/drift-export-html.mjs --in <result.json> --out <drift.html>')
  process.exit(1)
}

const absIn = path.resolve(inPath)
if (!fs.existsSync(absIn)) {
  console.error(`drift-export-html: file not found: ${absIn}`)
  process.exit(1)
}

let raw
try {
  raw = JSON.parse(fs.readFileSync(absIn, 'utf8'))
} catch (err) {
  console.error(`drift-export-html: JSON parse failed: ${err.message}`)
  process.exit(1)
}

// Accept either { summary, report, markdown, violations } or a bare DriftReport.
const report = typeof raw.clean === 'boolean' ? raw : raw.report
const summary = raw.summary ?? null
const violations = raw.violations ?? []

if (!report || typeof report.clean !== 'boolean') {
  console.error('drift-export-html: input JSON does not look like a drift result')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function badge(label, count, color) {
  if (count === 0) return ''
  return `<span class="badge badge-${color}">${esc(label)} ${count}</span>`
}

function renderItemList(title, items, renderFn) {
  if (!items || items.length === 0) return ''
  const rows = items.map((it) => `<li>${esc(renderFn(it))}</li>`).join('\n')
  return `
    <details open>
      <summary class="section-title">${esc(title)} <span class="count">(${items.length})</span></summary>
      <ul>${rows}</ul>
    </details>`
}

function renderBlockChange(c) {
  const changes = c.changes.join('; ')
  return `${c.before.id} (${c.before.name}): ${changes}`
}

// ---------------------------------------------------------------------------
// Build HTML
// ---------------------------------------------------------------------------

const generatedAt = new Date().toISOString()
const isClean = report.clean === true

const statusClass = isClean ? 'clean' : 'dirty'
const statusText = isClean ? 'No drift detected' : `Drift detected — ${summary ? summary.total : '?'} change(s)`

const badgesHtml = isClean ? '' : [
  badge('+blocks', summary?.addedBlocks ?? report.addedBlocks.length, 'green'),
  badge('−blocks', summary?.removedBlocks ?? report.removedBlocks.length, 'red'),
  badge('~blocks', summary?.changedBlocks ?? report.changedBlocks.length, 'yellow'),
  badge('+containers', summary?.addedContainers ?? report.addedContainers.length, 'green'),
  badge('−containers', summary?.removedContainers ?? report.removedContainers.length, 'red'),
  badge('+edges', summary?.addedEdges ?? report.addedEdges.length, 'green'),
  badge('−edges', summary?.removedEdges ?? report.removedEdges.length, 'red'),
].filter(Boolean).join(' ')

const sectionsHtml = isClean ? '<p class="clean-msg">Diagram and code are in sync.</p>' : [
  renderItemList('Added blocks', report.addedBlocks, (b) => `${b.id} (${b.name})`),
  renderItemList('Removed blocks', report.removedBlocks, (b) => `${b.id} (${b.name})`),
  renderItemList('Changed blocks', report.changedBlocks, renderBlockChange),
  renderItemList('Added containers', report.addedContainers, (c) => `${c.id} (${c.name})`),
  renderItemList('Removed containers', report.removedContainers, (c) => `${c.id} (${c.name})`),
  renderItemList('Added edges', report.addedEdges, (e) => `${e.id} (${e.source} → ${e.target})`),
  renderItemList('Removed edges', report.removedEdges, (e) => `${e.id} (${e.source} → ${e.target})`),
].join('\n')

const violationsHtml = violations.length === 0 ? '' : `
  <section class="violations">
    <h2>Policy violations (${violations.length})</h2>
    <ul>
      ${violations.map((v) => `<li><code>[${esc(v.rule)}]</code> ${esc(v.message)}</li>`).join('\n')}
    </ul>
  </section>`

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Drift Report</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #1a1a2e;
      background: #f5f7fa;
      margin: 0;
      padding: 24px;
    }
    .container { max-width: 860px; margin: 0 auto; }
    header {
      background: #fff;
      border-radius: 8px;
      padding: 20px 24px;
      margin-bottom: 20px;
      box-shadow: 0 1px 4px rgba(0,0,0,.08);
    }
    h1 { margin: 0 0 8px; font-size: 1.4rem; }
    .status {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-weight: 600;
      font-size: 0.85rem;
      margin-bottom: 12px;
    }
    .status.clean { background: #d1fae5; color: #065f46; }
    .status.dirty { background: #fee2e2; color: #991b1b; }
    .badges { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.78rem;
      font-weight: 600;
    }
    .badge-green { background: #d1fae5; color: #065f46; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .badge-yellow { background: #fef3c7; color: #92400e; }
    .meta { color: #6b7280; font-size: 0.8rem; margin-top: 8px; }
    .sections { background: #fff; border-radius: 8px; padding: 16px 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 16px; }
    details { margin-bottom: 12px; }
    details:last-child { margin-bottom: 0; }
    .section-title {
      cursor: pointer;
      font-weight: 600;
      font-size: 0.95rem;
      padding: 6px 0;
      list-style: none;
      user-select: none;
    }
    .section-title::-webkit-details-marker { display: none; }
    .section-title::before { content: "▶ "; font-size: 0.7rem; }
    details[open] .section-title::before { content: "▼ "; }
    .count { color: #6b7280; font-weight: 400; font-size: 0.85rem; }
    ul { margin: 6px 0 0 0; padding-left: 20px; }
    li { margin: 3px 0; color: #374151; }
    .clean-msg { color: #065f46; font-weight: 600; padding: 12px 0; }
    .violations {
      background: #fff5f5;
      border: 1px solid #fca5a5;
      border-radius: 8px;
      padding: 16px 24px;
    }
    .violations h2 { color: #991b1b; font-size: 1rem; margin: 0 0 10px; }
    code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-family: monospace; }
    footer { text-align: center; color: #9ca3af; font-size: 0.75rem; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>ArchViber Drift Report</h1>
      <div class="status ${statusClass}">${esc(statusText)}</div>
      <div class="badges">${badgesHtml}</div>
      <div class="meta">Generated at ${esc(generatedAt)}</div>
    </header>

    <section class="sections">
      ${sectionsHtml}
    </section>
    ${violationsHtml}

    <footer>Generated by drift-export-html.mjs</footer>
  </div>
</body>
</html>`

const absOut = path.resolve(outPath)
fs.writeFileSync(absOut, html, 'utf8')
console.log(`[drift-export-html] written → ${absOut}`)
process.exit(0)
