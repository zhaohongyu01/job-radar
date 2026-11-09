"""Generate OG share card and PWA/Apple icons into public/ using Playwright."""
from __future__ import annotations

from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"

RADAR_SVG_GREEN = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="{size}" height="{size}">
  <rect width="32" height="32" rx="8" fill="#1f4d3a"/>
  <g fill="none" stroke="white" stroke-width="1.8">
    <circle cx="16" cy="16" r="10"/>
    <circle cx="16" cy="16" r="5"/>
    <path d="M16 16 24 8"/>
  </g>
  <circle cx="16" cy="16" r="1.8" fill="white"/>
</svg>
"""

OG_HTML = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    width: 1200px;
    height: 630px;
    background: #f6f4ee;
    color: #1c1b18;
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
    display: flex;
    align-items: center;
    padding: 0 96px;
    position: relative;
    overflow: hidden;
  }}
  .card {{
    display: flex;
    align-items: center;
    gap: 56px;
    width: 100%;
    padding: 64px 72px;
    background: #ffffff;
    border: 2px solid #e4dfd3;
    border-radius: 28px;
    box-shadow: 0 20px 50px rgba(28, 27, 24, 0.06);
  }}
  .icon-wrap {{
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .text {{
    display: flex;
    flex-direction: column;
    gap: 18px;
  }}
  .eyebrow {{
    display: inline-flex;
    align-self: flex-start;
    padding: 6px 16px;
    border-radius: 999px;
    background: #e8f1ec;
    color: #1f4d3a;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }}
  h1 {{
    font-size: 76px;
    font-weight: 800;
    color: #1c1b18;
    letter-spacing: 0.02em;
    line-height: 1.1;
  }}
  p {{
    font-size: 32px;
    font-weight: 500;
    color: #545046;
    letter-spacing: 0.02em;
  }}
</style>
</head>
<body>
  <div class="card">
    <div class="icon-wrap">
      {RADAR_SVG_GREEN.format(size=168)}
    </div>
    <div class="text">
      <span class="eyebrow">官方信源直达 · 零广告纯本地隐私</span>
      <h1>职讯雷达</h1>
      <p>山东校招 · 社招 · 考公考编 一站追踪</p>
    </div>
  </div>
</body>
</html>
"""


def icon_html(size: int) -> str:
    pad = int(round(size * 0.08))
    inner = size - pad * 2
    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    width: {size}px;
    height: {size}px;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
</style>
</head>
<body>
  {RADAR_SVG_GREEN.format(size=inner)}
</body>
</html>
"""


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="msedge")
        except Exception:
            browser = p.chromium.launch()

        page = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
        page.set_content(OG_HTML)
        page.screenshot(path=str(PUBLIC / "og.png"))
        page.close()

        for filename, size in (
            ("apple-touch-icon.png", 180),
            ("icon-192.png", 192),
            ("icon-512.png", 512),
        ):
            icon_page = browser.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
            icon_page.set_content(icon_html(size))
            icon_page.screenshot(path=str(PUBLIC / filename))
            icon_page.close()

        browser.close()
    print("Generated og.png, apple-touch-icon.png, icon-192.png, icon-512.png")


if __name__ == "__main__":
    main()
