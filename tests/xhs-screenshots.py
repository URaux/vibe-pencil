"""
Screenshot Vibe Pencil for Xiaohongshu article — 5 pages
1080px wide, 2x scale for high DPI
"""
import time
import os
from playwright.sync_api import sync_playwright

BASE_URL = "http://localhost:3000"
OUT_DIR = "docs/xhs"
os.makedirs(OUT_DIR, exist_ok=True)

def log(msg):
    try:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}")
    except UnicodeEncodeError:
        print(f"[{time.strftime('%H:%M:%S')}] {msg.encode('ascii','replace').decode()}")

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1080, "height": 810},
            device_scale_factor=2,
        )
        page = context.new_page()

        # Clear state
        page.goto(BASE_URL)
        page.wait_for_timeout(2000)
        page.evaluate("window.localStorage.clear()")
        page.reload()
        page.wait_for_timeout(2000)

        # ====== Page 1: Empty state with chat prompt examples ======
        log("P1: Empty state with chat suggestions")
        page.screenshot(path=f"{OUT_DIR}/p1-empty-state.png")

        # ====== Page 2: Open chat, type a message, show brainstorm ======
        log("P2: Chat brainstorm")
        # Open chat
        chat_btn = page.locator("text=Claude").or_(page.locator("text=AI"))
        if chat_btn.count() > 0:
            chat_btn.first.click()
            page.wait_for_timeout(500)

        # Type message
        input_box = page.locator("input[placeholder*='输入'], input[placeholder*='Type']")
        if input_box.count() > 0 and input_box.first.is_visible():
            input_box.first.fill("帮我做一个跨境电商系统，要有选品、投流、风控和智能客服")
            page.wait_for_timeout(500)
            page.screenshot(path=f"{OUT_DIR}/p2-chat-input.png")

            # Send
            send_btn = page.locator("button:has-text('发送')")
            if send_btn.count() > 0:
                send_btn.first.click()
                log("  Message sent, waiting for response...")

                # Wait for AI response
                for i in range(40):  # 200s max
                    page.wait_for_timeout(5000)
                    nodes = page.locator(".react-flow__node").count()
                    spinners = page.locator(".vp-spinner").count()
                    log(f"  [{(i+1)*5}s] nodes={nodes} spinners={spinners}")
                    if spinners == 0 and i > 2:
                        break

                page.wait_for_timeout(2000)
                page.screenshot(path=f"{OUT_DIR}/p3-brainstorm-response.png")

        # ====== Page 3: Architecture on canvas ======
        log("P3: Check if architecture appeared")
        nodes = page.locator(".react-flow__node").count()
        if nodes > 0:
            # Click fitView button if available
            fit_btn = page.locator("[title*='fit'], button:has(svg)")
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{OUT_DIR}/p4-architecture-canvas.png")
        else:
            log("  No nodes on canvas, taking screenshot anyway")
            page.screenshot(path=f"{OUT_DIR}/p4-architecture-canvas.png")

        # ====== Page 4: Settings with Skills tab ======
        log("P4: Settings → Skills tab")
        settings_btn = page.locator("button:has-text('设置')")
        if settings_btn.count() > 0:
            settings_btn.first.click()
            page.wait_for_timeout(1000)

            # Click Skills tab
            skills_tab = page.locator("button:has-text('技能库')")
            if skills_tab.count() > 0:
                skills_tab.first.click()
                page.wait_for_timeout(2000)
                page.screenshot(path=f"{OUT_DIR}/p5-skills-panel.png")

            # Close settings
            close_btn = page.locator("button:has-text('关闭')")
            if close_btn.count() > 0:
                close_btn.first.click()

        # ====== Page 5: Export menu ======
        log("P5: Export menu")
        export_btn = page.locator("button:has-text('导出')")
        if export_btn.count() > 0:
            export_btn.first.click()
            page.wait_for_timeout(500)
            page.screenshot(path=f"{OUT_DIR}/p6-export-menu.png")

        # ====== Page 6: Build Plan Preview (if nodes exist) ======
        log("P6: Build plan")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        if nodes > 0:
            build_btn = page.locator("button:has-text('全部构建')")
            if build_btn.count() > 0:
                build_btn.first.click()
                page.wait_for_timeout(2000)
                page.screenshot(path=f"{OUT_DIR}/p7-build-plan.png")
                # Close dialog
                cancel_btn = page.locator("button:has-text('取消')")
                if cancel_btn.count() > 0:
                    cancel_btn.first.click()

        log("Done! Screenshots saved.")
        browser.close()

        # Report
        for f in sorted(os.listdir(OUT_DIR)):
            if f.endswith('.png'):
                size = os.path.getsize(os.path.join(OUT_DIR, f))
                print(f"  {f}: {size//1024}KB")

if __name__ == "__main__":
    run()
