/**
 * Re-run only S1 (ecommerce) and S5 (whiteboard) that failed due to disabled input
 * Key fix: wait for spinners=0 before sendMsg (canvas streaming complete)
 */

import { chromium } from 'playwright'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCREENSHOTS_DIR = path.join(__dirname, '.planning/phase1/demo-runs/screenshots')
const LOGS_DIR = path.join(__dirname, '.planning/phase1/demo-runs')

const SESSIONS = [
  {
    id: 1,
    name: 'ecommerce',
    prompt: '我想做一个电商系统，包含用户侧（浏览/下单/支付）和商家侧（商品管理/订单处理），帮我设计架构',
    qaAnswers: ['中型规模，约 10 万日活用户，Java 后端，PostgreSQL 数据库，云原生部署'],
    designTrigger: '方案确认，请生成完整的系统架构图，包含所有服务节点和数据层，直接输出 add-node 和 add-edge 动作块到画布上。',
    adjustPrompt: '把用户认证模块合并成独立的 Auth 服务，加一个 Redis 缓存层',
  },
  {
    id: 5,
    name: 'whiteboard',
    prompt: 'Design a real-time collaborative whiteboard like Miro with WebRTC, CRDT sync, and presence indicators',
    qaAnswers: ['Up to 50 concurrent users per board, Yjs CRDT, Redis for session state, WebSocket'],
    designTrigger: 'Requirements confirmed. Generate the complete real-time collaborative whiteboard architecture — output all add-node and add-edge actions to build the canvas now.',
    adjustPrompt: 'Add S3 persistence layer for canvas snapshots and version history',
  },
]

function ts() { return new Date().toISOString() }
function log(sid, msg) { console.log(`[${ts()}] [S${sid}] ${msg}`) }

async function screenshot(page, label, sid) {
  const fpath = path.join(SCREENSHOTS_DIR, `s${sid}-r2-${label}-${Date.now()}.png`)
  try { await page.screenshot({ path: fpath }) } catch { return null }
  return fpath
}

async function getChatText(page) {
  return page.evaluate(() => {
    const asides = document.querySelectorAll('aside')
    for (const a of asides) {
      if (a.querySelector('form')) return a.textContent?.slice(-5000) || ''
    }
    return document.body.textContent?.slice(-2000) || ''
  })
}

async function getNodeCount(page) {
  return page.evaluate(() => document.querySelectorAll('.react-flow__node').length)
}

async function getSpinnerCount(page) {
  return page.evaluate(() => document.querySelectorAll('.vp-spinner').length)
}

async function waitForAI(page, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  await page.waitForTimeout(4000)
  let stable = 0, last = ''

  while (Date.now() < deadline) {
    await page.waitForTimeout(3000)
    const spinners = await getSpinnerCount(page)
    const text = await getChatText(page)

    if (spinners === 0) {
      if (text === last) {
        stable++
        if (stable >= 2) return text
      } else {
        stable = 0; last = text
      }
    } else {
      stable = 0; last = text
    }
  }
  return await getChatText(page)
}

async function dismissWatcherDialog(page) {
  const dialogCount = await page.evaluate(() => {
    return document.querySelectorAll('[role="dialog"][aria-labelledby="ir-watcher-title"]').length
  })
  if (dialogCount === 0) return

  const dismissed = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const ignore = btns.find(b => b.textContent?.includes('Ignore') || b.textContent?.includes('Keep Local'))
    if (ignore) { ignore.click(); return true }
    const dlg = document.querySelector('[role="dialog"][aria-labelledby="ir-watcher-title"]')
    if (dlg) {
      const anyBtn = dlg.querySelectorAll('button')[0]
      if (anyBtn) { anyBtn.click(); return true }
    }
    return false
  })
  if (dismissed) await page.waitForTimeout(500)
}

async function waitForInputEnabled(page) {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    await dismissWatcherDialog(page)
    const isDisabled = await page.evaluate(() => {
      const el = document.querySelector('input[placeholder="输入消息..."]')
      return el?.disabled ?? true
    })
    if (!isDisabled) return
    await page.waitForTimeout(1500)
  }
  throw new Error('Input stayed disabled for 90s')
}

async function sendMsg(page, message) {
  await dismissWatcherDialog(page)
  const input = page.locator('input[placeholder="输入消息..."]')
  await input.waitFor({ state: 'visible', timeout: 15000 })
  await waitForInputEnabled(page)
  await input.click()
  await input.fill(message)
  await page.waitForTimeout(500)
  await input.press('Enter')
  await page.waitForTimeout(800)
}

async function ensureSidebarExpanded(page) {
  await dismissWatcherDialog(page)
  await page.waitForTimeout(300)

  const expandBtn = page.locator('aside:first-child button[title="Expand sidebar"]')
  if (await expandBtn.count() > 0) {
    await expandBtn.click()
    await page.waitForTimeout(600)
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const newBtn = page.locator('button').filter({ hasText: /^\+\s*新对话$/ })
    try {
      await newBtn.waitFor({ state: 'visible', timeout: 4000 })
      return newBtn
    } catch {
      await dismissWatcherDialog(page)
      await page.waitForTimeout(500)
    }
  }

  const newBtn = page.locator('button').filter({ hasText: /^\+\s*新对话$/ })
  await newBtn.waitFor({ state: 'visible', timeout: 5000 })
  return newBtn
}

async function newSession(page) {
  const newBtn = await ensureSidebarExpanded(page)
  await newBtn.click()
  await page.waitForTimeout(1200)
}

async function ensureClaudeCode(page) {
  const footerText = await page.locator('footer').textContent()
  if (footerText?.includes('Claude Code')) return

  log(0, 'Switching to claude-code...')
  await page.locator('footer button').filter({ hasText: '设置' }).click()
  await page.waitForTimeout(800)
  await page.locator('input[type="radio"][value="claude-code"]').click()
  await page.waitForTimeout(300)

  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button[type="submit"]')]
    const save = btns.find(b => b.textContent?.includes('保存'))
    if (save) save.click()
  })
  await page.waitForTimeout(1500)
}

async function runSession(page, def) {
  const { id, name, prompt, qaAnswers, designTrigger, adjustPrompt } = def
  const L = (m) => log(id, m)
  const SS = (label) => screenshot(page, label, id)
  const screenshots = []
  const events = []
  let nodeCount = 0

  try {
    L('Creating session...')
    await newSession(page)
    const s1 = await SS('01-new-session')
    if (s1) screenshots.push(s1)
    events.push({ phase: 'new_session', ts: Date.now() })

    L('Sending initial prompt...')
    await sendMsg(page, prompt)
    events.push({ phase: 'prompt_sent', ts: Date.now() })
    const s2 = await SS('02-prompt-sent')
    if (s2) screenshots.push(s2)

    L('Waiting for first AI response...')
    let chatText = await waitForAI(page, 120000)

    if (chatText.includes('无法连接到 AI 服务')) throw new Error('AI connection failed')

    const s3 = await SS('03-first-reply')
    if (s3) screenshots.push(s3)
    L(`First reply (last 200): ${chatText.slice(-200)}`)

    for (let round = 0; round < qaAnswers.length; round++) {
      const confirmEnabled = await page.evaluate(() => {
        const btn = document.querySelector('button.rounded-full.border-orange-200')
        return btn ? !btn.disabled : false
      })

      if (confirmEnabled) {
        L(`Round ${round}: Confirm button enabled, skipping to design`)
        break
      }

      L(`Round ${round}: Answering...`)
      await sendMsg(page, qaAnswers[round])
      await page.waitForTimeout(1000)
      chatText = await waitForAI(page, 90000)
      const sQA = await SS(`04-qa-r${round}`)
      if (sQA) screenshots.push(sQA)
      L(`QA reply (last 100): ${chatText.slice(-100)}`)
    }

    events.push({ phase: 'qa_done', ts: Date.now() })

    L('Sending design trigger...')
    await sendMsg(page, designTrigger)
    const s5a = await SS('05-design-trigger')
    if (s5a) screenshots.push(s5a)
    events.push({ phase: 'design_triggered', ts: Date.now() })

    L('Waiting for canvas nodes...')
    const canvasStart = Date.now()
    while (Date.now() - canvasStart < 200000) {
      await page.waitForTimeout(4000)
      nodeCount = await getNodeCount(page)
      const spinners = await getSpinnerCount(page)
      L(`Canvas: ${nodeCount} nodes, spinners: ${spinners}`)

      if (nodeCount >= 3) break

      if (spinners === 0 && Date.now() - canvasStart > 30000) {
        chatText = await getChatText(page)
        const lastBit = chatText.slice(-300)
        L(`Stable but no canvas: ${lastBit.slice(-100)}`)

        if (lastBit.includes('?') || lastBit.includes('？') || lastBit.includes('请问')) {
          L('AI still asking - sending generic OK')
          await sendMsg(page, '确认，请直接生成架构图')
          await page.waitForTimeout(2000)
        } else if (Date.now() - canvasStart > 80000) {
          break
        }
      }
    }

    const s5 = await SS('05-canvas')
    if (s5) screenshots.push(s5)
    events.push({ phase: 'canvas_done', nodeCount, ts: Date.now() })
    L(`Canvas final: ${nodeCount} nodes`)

    const preAdjustNodeCount = nodeCount
    if (nodeCount >= 1) {
      // Wait for ALL spinners to clear — canvas must be fully rendered before adjustment
      L('Waiting for canvas stream to fully complete...')
      const spinWait = Date.now() + 90000
      while (Date.now() < spinWait) {
        const sp = await getSpinnerCount(page)
        if (sp === 0) break
        await page.waitForTimeout(2000)
      }

      L('Sending adjustment...')
      await sendMsg(page, adjustPrompt)
      await waitForAI(page, 90000)
      const newCount = await getNodeCount(page)
      const s6 = await SS('06-adjusted')
      if (s6) screenshots.push(s6)

      const effectiveCount = Math.max(preAdjustNodeCount, newCount)
      events.push({ phase: 'adjusted', nodesBefore: preAdjustNodeCount, nodesAfter: newCount, effectiveCount, ts: Date.now() })
      nodeCount = effectiveCount
      L(`After adjustment: ${newCount} (effective: ${nodeCount} nodes)`)
    }

    L('Attempting Build All...')
    const buildBtnDisabled = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '全部构建')
      return btn?.disabled ?? true
    })

    if (!buildBtnDisabled) {
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '全部构建')
        btn?.click()
      })
      await page.waitForTimeout(2000)
      const s7 = await SS('07-build-dialog')
      if (s7) screenshots.push(s7)
      events.push({ phase: 'build_dialog_opened', ts: Date.now() })

      const cancelled = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')]
        const cancel = btns.find(b => b.textContent?.includes('取消') || b.textContent?.includes('Cancel'))
        if (cancel) { cancel.click(); return true }
        return false
      })
      if (!cancelled) await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
      L('Build All dialog opened and closed')
    } else {
      L('Build All is disabled (no canvas nodes)')
      events.push({ phase: 'build_all_skipped', ts: Date.now() })
    }

    const result = nodeCount >= 5 ? 'PASS' : nodeCount >= 2 ? 'PARTIAL' : 'FAIL'
    events.push({ phase: 'complete', result, nodeCount, ts: Date.now() })

    await fs.writeFile(
      path.join(LOGS_DIR, `session-${id}-${name}-r2.json`),
      JSON.stringify({ id, name, result, nodeCount, screenshots, events }, null, 2)
    )
    L(`RESULT: ${result} | nodes=${nodeCount}`)
    return { id, name, result, nodeCount, screenshots, error: null }

  } catch (err) {
    L(`FAILED: ${err.message}`)
    const sErr = await SS('99-error')
    if (sErr) screenshots.push(sErr)

    await fs.writeFile(
      path.join(LOGS_DIR, `session-${id}-${name}-r2.json`),
      JSON.stringify({ id, name, result: 'FAIL', nodeCount, screenshots, events, error: err.message }, null, 2)
    )
    return { id, name, result: 'FAIL', nodeCount, screenshots, error: err.message }
  }
}

async function main() {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true })
  await fs.mkdir(LOGS_DIR, { recursive: true })

  console.log('=== ArchViber Demo Re-run (S1 + S5) ===')
  console.log(`Start: ${ts()}`)

  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1600,960', '--start-maximized']
  })
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } })
  const page = await ctx.newPage()

  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[PAGE:ERR] ${msg.text().slice(0, 100)}`)
  })

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)

  await ensureClaudeCode(page)

  const results = []

  for (const def of SESSIONS) {
    console.log(`\n${'─'.repeat(50)}`)
    console.log(`Session ${def.id}: ${def.name}`)

    if (results.length > 0) await page.waitForTimeout(3000)

    const r = await runSession(page, def)
    results.push(r)

    const icon = r.result === 'PASS' ? '✓' : r.result === 'PARTIAL' ? '~' : '✗'
    console.log(`${icon} S${r.id}: ${r.result} | nodes=${r.nodeCount}${r.error ? ' | ' + r.error.slice(0, 80) : ''}`)
  }

  await browser.close()

  console.log('\n=== FINAL ===')
  results.forEach(r => {
    console.log(`  S${r.id} ${r.name}: ${r.result} (nodes=${r.nodeCount})${r.error ? ' | err: ' + r.error.slice(0, 80) : ''}`)
  })
  const passCount = results.filter(r => r.result !== 'FAIL').length
  console.log(`  Pass: ${passCount}/${results.length}`)
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
