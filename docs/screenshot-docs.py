"""Capture architecture diagram HTML files as PNG screenshots using Playwright."""
from pathlib import Path
from playwright.sync_api import sync_playwright

DOCS = Path(__file__).parent
FILES = [
    ("arch-system.html", "arch-system.png"),
    ("arch-context.html", "arch-context.png"),
    ("arch-build-flow.html", "arch-build-flow.png"),
    ("arch-canvas-model.html", "arch-canvas-model.png"),
]

def capture_all():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for html_name, png_name in FILES:
            html_path = DOCS / html_name
            png_path = DOCS / png_name
            if not html_path.exists():
                print(f"SKIP {html_name} (not found)")
                continue

            page = browser.new_page(viewport={"width": 960, "height": 800})
            page.goto(html_path.as_uri())
            # Wait for rendering
            page.wait_for_timeout(500)

            # Hide scrollbar
            page.evaluate("""
                document.documentElement.style.overflow = 'hidden';
                document.body.style.overflow = 'hidden';
                // Also hide any scrollbar on inner elements
                const style = document.createElement('style');
                style.textContent = '::-webkit-scrollbar { display: none !important; } * { scrollbar-width: none !important; }';
                document.head.appendChild(style);
            """)
            page.wait_for_timeout(200)

            # Get full page content height
            dimensions = page.evaluate("""() => {
                const body = document.body;
                const html = document.documentElement;
                const height = Math.max(
                    body.scrollHeight, body.offsetHeight,
                    html.clientHeight, html.scrollHeight, html.offsetHeight
                );
                const width = Math.max(body.scrollWidth, html.scrollWidth, 960);
                return { width, height };
            }""")

            # Resize viewport to full content size (no scroll needed)
            page.set_viewport_size({
                "width": dimensions["width"],
                "height": dimensions["height"]
            })
            page.wait_for_timeout(300)

            page.screenshot(path=str(png_path), full_page=True)
            print(f"OK {png_name} ({dimensions['width']}x{dimensions['height']})")
            page.close()

        browser.close()

if __name__ == "__main__":
    capture_all()
