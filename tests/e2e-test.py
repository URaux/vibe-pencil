"""
Vibe Pencil E2E Test — 5-round conversation flow with browser rendering verification
"""
import time
import json
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:3000"
SCREENSHOTS_DIR = "tests/screenshots"

import os
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def test_vibe_pencil():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1400, "height": 900})

        results = []

        # ====== SETUP: Navigate and clear state ======
        log("Navigating to app...")
        page.goto(BASE_URL)
        page.wait_for_timeout(2000)

        # Clear localStorage to start fresh
        page.evaluate("window.localStorage.clear()")
        page.reload()
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{SCREENSHOTS_DIR}/00-initial.png")
        log("Initial page loaded")

        # ====== TEST 1: New conversation + send message ======
        log("TEST 1: New conversation + architecture generation")
        try:
            # Click new chat button
            new_chat_btn = page.locator("text=+ 新对话").or_(page.locator("text=+ New Chat"))
            if new_chat_btn.count() > 0:
                new_chat_btn.first.click()
                page.wait_for_timeout(500)

            # Open chat panel if collapsed
            chat_toggle = page.locator("text=AI 对话").or_(page.locator("text=AI Chat"))
            if chat_toggle.count() > 0:
                chat_toggle.first.click()
                page.wait_for_timeout(500)

            # Type message
            input_box = page.locator("input[placeholder*='消息'], input[placeholder*='message'], textarea")
            if input_box.count() > 0:
                input_box.first.fill("帮我设计一个简单的待办清单应用，要有用户登录和数据存储")
                page.wait_for_timeout(300)

                # Click send button
                send_btn = page.locator("button:has-text('发送')").or_(page.locator("button:has-text('Send')"))
                if send_btn.count() > 0:
                    send_btn.first.click()
                    log("Message sent, waiting for AI response...")

                    # Wait for AI response (up to 120s)
                    page.wait_for_timeout(3000)  # Initial wait

                    # Check for spinner (AI thinking)
                    spinner = page.locator(".vp-spinner")
                    has_spinner = spinner.count() > 0
                    log(f"  Spinner visible: {has_spinner}")

                    # Wait for response to complete
                    for i in range(24):  # 24 * 5s = 120s max
                        page.wait_for_timeout(5000)
                        # Check if AI response appeared
                        ai_messages = page.locator("text=AI").all()
                        nodes = page.locator(".react-flow__node")
                        node_count = nodes.count()
                        log(f"  Waiting... ({(i+1)*5}s) — nodes on canvas: {node_count}")
                        if node_count > 0:
                            break

                    page.screenshot(path=f"{SCREENSHOTS_DIR}/01-after-first-message.png")

                    # Verify canvas has nodes
                    final_nodes = page.locator(".react-flow__node").count()
                    final_edges = page.locator(".react-flow__edge").count()
                    results.append({
                        "test": "1. Architecture generation",
                        "pass": final_nodes > 0,
                        "details": f"Nodes: {final_nodes}, Edges: {final_edges}"
                    })
                else:
                    results.append({"test": "1. Architecture generation", "pass": False, "details": "Send button not found"})
            else:
                results.append({"test": "1. Architecture generation", "pass": False, "details": "Input box not found"})
        except Exception as e:
            results.append({"test": "1. Architecture generation", "pass": False, "details": str(e)})

        # ====== TEST 2: Session title auto-generation ======
        log("TEST 2: Session title auto-generation")
        try:
            page.wait_for_timeout(5000)  # Wait for title-gen
            sidebar_items = page.locator(".truncate").all()
            titles = [el.text_content() for el in sidebar_items if el.text_content()]
            has_meaningful_title = any(t and t != "未命名" and t != "Untitled" and len(t) > 2 for t in titles)
            results.append({
                "test": "2. Session title auto-gen",
                "pass": has_meaningful_title,
                "details": f"Titles found: {titles[:3]}"
            })
            page.screenshot(path=f"{SCREENSHOTS_DIR}/02-title-check.png")
        except Exception as e:
            results.append({"test": "2. Session title auto-gen", "pass": False, "details": str(e)})

        # ====== TEST 3: Canvas quality ======
        log("TEST 3: Canvas quality check")
        try:
            containers = page.locator(".react-flow__node[data-type='container'], .react-flow__node-container").count()
            blocks = page.locator(".react-flow__node[data-type='block'], .react-flow__node-block").count()
            edges = page.locator(".react-flow__edge").count()
            results.append({
                "test": "3. Canvas quality",
                "pass": containers > 0 or blocks > 0,
                "details": f"Containers: {containers}, Blocks: {blocks}, Edges: {edges}"
            })
        except Exception as e:
            results.append({"test": "3. Canvas quality", "pass": False, "details": str(e)})

        # ====== TEST 4: Export menu ======
        log("TEST 4: Export menu")
        try:
            export_btn = page.locator("button:has-text('导出')").or_(page.locator("button:has-text('Export')"))
            if export_btn.count() > 0:
                export_btn.first.click()
                page.wait_for_timeout(500)
                page.screenshot(path=f"{SCREENSHOTS_DIR}/04-export-menu.png")

                # Check menu items visible
                menu_items = page.locator("text=YAML").count() + page.locator("text=PNG").count()
                results.append({
                    "test": "4. Export menu",
                    "pass": menu_items > 0,
                    "details": f"Menu items found: {menu_items}"
                })
                # Close menu
                page.keyboard.press("Escape")
            else:
                results.append({"test": "4. Export menu", "pass": False, "details": "Export button not found"})
        except Exception as e:
            results.append({"test": "4. Export menu", "pass": False, "details": str(e)})

        # ====== TEST 5: Progress widget ======
        log("TEST 5: Progress widget")
        try:
            progress = page.locator("text=0%").or_(page.locator("text=/\\d+%/"))
            has_progress = progress.count() > 0
            results.append({
                "test": "5. Progress widget",
                "pass": has_progress,
                "details": f"Progress indicators found: {progress.count()}"
            })
        except Exception as e:
            results.append({"test": "5. Progress widget", "pass": False, "details": str(e)})

        # ====== TEST 6: Project scan (import skeleton) ======
        log("TEST 6: Project scan API")
        try:
            response = page.evaluate("""async () => {
                const res = await fetch('/api/project/scan', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({dir: 'E:\\\\claude-workspace\\\\agentrag'})
                });
                const data = await res.json();
                return { ok: res.ok, nodeCount: data.nodes?.length || 0, edgeCount: data.edges?.length || 0, hasScan: !!data.scan };
            }""")
            results.append({
                "test": "6. Project scan (skeleton)",
                "pass": response["ok"] and response["nodeCount"] > 0,
                "details": f"OK: {response['ok']}, Nodes: {response['nodeCount']}, Edges: {response['edgeCount']}, Scan: {response['hasScan']}"
            })
        except Exception as e:
            results.append({"test": "6. Project scan", "pass": False, "details": str(e)})

        # ====== TEST 7: Title gen API ======
        log("TEST 7: Title generation API")
        try:
            response = page.evaluate("""async () => {
                const res = await fetch('/api/chat/title', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        userMessage: '设计一个博客系统',
                        assistantMessage: '好的，我来设计博客系统架构',
                        locale: 'zh',
                        backend: 'claude-code'
                    })
                });
                const data = await res.json();
                return { ok: res.ok, title: data.title || '' };
            }""")
            results.append({
                "test": "7. Title generation",
                "pass": response["ok"] and len(response["title"]) > 0,
                "details": f"Title: {response['title']}"
            })
        except Exception as e:
            results.append({"test": "7. Title generation", "pass": False, "details": str(e)})

        # ====== FINAL: Screenshot and report ======
        page.screenshot(path=f"{SCREENSHOTS_DIR}/99-final.png", full_page=True)

        browser.close()

        # Print results
        print("\n" + "="*60)
        print("VIBE PENCIL E2E TEST RESULTS")
        print("="*60)
        passed = 0
        failed = 0
        for r in results:
            status = "PASS" if r["pass"] else "FAIL"
            icon = "✅" if r["pass"] else "❌"
            print(f"{icon} {r['test']}: {status}")
            print(f"   {r['details']}")
            if r["pass"]:
                passed += 1
            else:
                failed += 1
        print(f"\n{passed}/{passed+failed} tests passed")
        print(f"Screenshots saved to {SCREENSHOTS_DIR}/")
        return results

if __name__ == "__main__":
    test_vibe_pencil()
