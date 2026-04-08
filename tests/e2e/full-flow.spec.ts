/**
 * ArchViber E2E Test: Full brainstorm → architecture → schema review → build flow
 *
 * Uses real Codex API (gpt-5.4) — each run costs API credits.
 * Run: npx playwright test tests/e2e/full-flow.spec.ts --headed
 */
import { test, expect, type Page } from '@playwright/test'

const BASE_URL = 'http://localhost:3000'
const AI_TIMEOUT = 120_000 // 2 min per AI response

test.describe('Full brainstorm → build flow', () => {
  test.setTimeout(600_000)

  let page: Page

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    await page.goto(BASE_URL)
    // Don't use networkidle — Next.js HMR keeps websocket open
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(2000)
  })

  test.afterAll(async () => {
    await page.close()
  })

  /** Helper: wait for a new assistant message to appear */
  async function waitForNewAssistantMessage(prevCount: number) {
    await page.waitForFunction(
      (prev) => {
        // Count messages by looking for chat message containers
        const msgs = document.querySelectorAll('[class*="chat-message"], [class*="ChatMessage"], [class*="message-content"]')
        return msgs.length > prev
      },
      prevCount,
      { timeout: AI_TIMEOUT }
    )
  }

  /** Helper: count current assistant messages */
  async function countMessages(): Promise<number> {
    return page.locator('[class*="chat-message"], [class*="ChatMessage"], [class*="message-content"]').count()
  }

  /** Helper: send a chat message */
  async function sendMessage(text: string) {
    const input = page.locator('textbox[name], textarea, [contenteditable="true"]').last()
    await input.click()
    await input.fill(text)
    // Click send button or press Enter
    const sendBtn = page.getByRole('button', { name: '发送' })
    if (await sendBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
      await sendBtn.click()
    } else {
      await input.press('Enter')
    }
  }

  test('Step 1: Verify page loaded and backend is Codex', async () => {
    // From snapshot: status bar shows "Agent 后端 Codex"
    const statusBar = page.locator('text=Agent 后端 Codex, text=Agent Backend Codex')
    await expect(statusBar.first()).toBeVisible({ timeout: 5000 })
    console.log('[Step 1] Backend confirmed: Codex')
  })

  test('Step 2: Start new brainstorm session', async () => {
    // Click "+ 新对话" button
    const newChatBtn = page.getByRole('button', { name: /新对话/ })
    await newChatBtn.click()
    await page.waitForTimeout(1000)

    // Verify brainstorm status appears
    const brainstormLabel = page.locator('text=需求讨论中')
    await expect(brainstormLabel).toBeVisible({ timeout: 5000 })
    console.log('[Step 2] New brainstorm session started')
  })

  test('Step 3: Describe project', async () => {
    const msgCountBefore = await countMessages()
    await sendMessage('我要做一个跨境电商平台，支持多国货币、多语言、多仓库的B2C商城')

    // Wait for AI response
    await waitForNewAssistantMessage(msgCountBefore)
    await page.waitForTimeout(1000)

    // Get last message text
    const messages = page.locator('[class*="message-content"], [class*="ChatMessage"], [class*="markdown"]')
    const lastMsg = messages.last()
    const text = await lastMsg.textContent()
    console.log(`[Step 3 / Round 1] AI: ${text?.slice(0, 200)}`)
    expect(text!.length).toBeGreaterThan(20)
  })

  test('Step 4: Answer brainstorm questions (3 rounds)', async () => {
    const answers = [
      '面向欧美和东南亚消费者，预期日活5万，月GMV 500万美元',
      '核心功能：商品管理、购物车、多币种支付、多仓库库存管理、订单物流追踪',
      '技术栈用 Next.js + Node.js + PostgreSQL，支付对接 Stripe，部署在 AWS',
    ]

    for (let i = 0; i < answers.length; i++) {
      const msgCountBefore = await countMessages()
      await sendMessage(answers[i])

      try {
        await waitForNewAssistantMessage(msgCountBefore)
        await page.waitForTimeout(1000)
      } catch {
        console.log(`[Step 4 / Round ${i + 2}] Timed out waiting for AI`)
        continue
      }

      const messages = page.locator('[class*="message-content"], [class*="ChatMessage"], [class*="markdown"]')
      const text = await messages.last().textContent()
      console.log(`[Step 4 / Round ${i + 2}] AI: ${text?.slice(0, 200)}`)

      // Check progress indicator
      const progress = page.locator('text=/\\d+\\/[68] 维度/')
      if (await progress.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`[Progress] ${await progress.textContent()}`)
      }
    }
  })

  test('Step 5: Confirm design and generate architecture', async () => {
    // Click "确认方案，开始生成架构 →" button
    const confirmBtn = page.getByRole('button', { name: /确认方案/ })
    await expect(confirmBtn).toBeVisible({ timeout: 5000 })
    await confirmBtn.click()
    console.log('[Step 5] Clicked confirm design')

    // Wait for architecture nodes to appear on canvas
    await page.waitForFunction(
      () => document.querySelectorAll('.react-flow__node').length > 0,
      { timeout: AI_TIMEOUT }
    ).catch(() => {
      console.log('[Step 5] Timed out waiting for architecture nodes')
    })

    const nodeCount = await page.locator('.react-flow__node').count()
    console.log(`[Step 5] Architecture generated: ${nodeCount} nodes`)
    expect(nodeCount).toBeGreaterThan(0)

    // Check if auto-followup triggered (missing edges/schema)
    await page.waitForTimeout(5000)
    const edgeCount = await page.locator('.react-flow__edge').count()
    console.log(`[Step 5] Edges: ${edgeCount}`)
  })

  test('Step 6: Verify data layer and schema', async () => {
    // Look for data-related nodes
    const allNodes = page.locator('.react-flow__node')
    const nodeCount = await allNodes.count()
    console.log(`[Step 6] Total nodes: ${nodeCount}`)

    // Try double-clicking a data node to open editor
    for (let i = 0; i < nodeCount; i++) {
      const node = allNodes.nth(i)
      const text = await node.textContent()
      if (/data|数据|database|db|postgresql/i.test(text ?? '')) {
        console.log(`[Step 6] Found data node: ${text?.slice(0, 50)}`)
        await node.dblclick()
        await page.waitForTimeout(1000)

        // Check for schema editor
        const schemaSection = page.locator('text=Database Schema, text=Add Schema')
        if (await schemaSection.isVisible({ timeout: 3000 }).catch(() => false)) {
          const schemaText = await schemaSection.textContent()
          console.log(`[Step 6] Schema section: ${schemaText?.slice(0, 200)}`)
        }

        await page.keyboard.press('Escape')
        break
      }
    }
  })

  test('Step 7: Request schema modification', async () => {
    const msgCountBefore = await countMessages()
    await sendMessage('把订单表的 status 字段改成 enum 类型，值为 pending/paid/shipped/delivered/refunded，另外给 products 表加一个 currency 字段用 varchar(3) 存 ISO 货币代码')

    try {
      await waitForNewAssistantMessage(msgCountBefore)
      await page.waitForTimeout(2000)
    } catch {
      console.log('[Step 7] Timed out waiting for modification response')
    }

    const messages = page.locator('[class*="message-content"], [class*="ChatMessage"], [class*="markdown"]')
    const text = await messages.last().textContent()
    console.log(`[Step 7] Modify response: ${text?.slice(0, 300)}`)
  })

  test('Step 8: Check Build All button', async () => {
    const buildBtn = page.getByRole('button', { name: /全部构建|Build All/i })
    const isVisible = await buildBtn.isVisible({ timeout: 3000 }).catch(() => false)
    const isEnabled = isVisible ? await buildBtn.isEnabled() : false
    console.log(`[Step 8] Build All: visible=${isVisible}, enabled=${isEnabled}`)

    if (isEnabled) {
      // Don't actually build — just verify it's clickable
      console.log('[Step 8] Build All button is ready')
    }
  })

  test('Step 9: Verify session persistence', async () => {
    // Check localStorage
    const lsData = await page.evaluate(() => {
      return window.localStorage.getItem('vp-chat-sessions')
    })
    expect(lsData).toBeTruthy()
    const sessions = JSON.parse(lsData!)
    expect(sessions.length).toBeGreaterThan(0)
    const latest = sessions[sessions.length - 1]
    console.log(`[Step 9] LS session: title="${latest.title}", messages=${latest.messages?.length}, phase=${latest.phase}`)

    // Check IndexedDB
    const idbCount = await page.evaluate(async () => {
      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('archviber-sessions', 1)
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject()
        })
        const tx = db.transaction('chat-sessions', 'readonly')
        const count = await new Promise<number>((resolve) => {
          const req = tx.objectStore('chat-sessions').count()
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => resolve(0)
        })
        db.close()
        return count
      } catch { return -1 }
    })
    console.log(`[Step 9] IndexedDB sessions: ${idbCount}`)
  })
})
