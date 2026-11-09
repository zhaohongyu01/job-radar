"""Local smoke check: start dev server, open key pages, report console errors and save screenshots.
Usage: python tests/smoke_pages.py [--port 5199]   (not part of CI)"""
import argparse, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'work' / 'smoke'
PAGES = [('jobs', '/'), ('exams', '/?workspace=exams')]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--port', type=int, default=5199); a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    base = f'http://127.0.0.1:{a.port}'
    proc = None
    try:
        urllib.request.urlopen(base + '/favicon.svg', timeout=1)
    except Exception:
        proc = subprocess.Popen(['npx.cmd', 'vinext', 'dev', '--port', str(a.port), '--hostname', '127.0.0.1'],
                                cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if proc is not None:
            for _ in range(60):
                try: urllib.request.urlopen(base + '/favicon.svg', timeout=5); break
                except Exception: time.sleep(0.5)
        failures = 0
        with sync_playwright() as p:
            b = p.chromium.launch(channel='msedge')
            for vp_name, vp in (('desktop', {'width': 1440, 'height': 900}), ('mobile', {'width': 390, 'height': 844})):
                for name, path in PAGES:
                    page = b.new_page(viewport=vp)
                    errors = []
                    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                    page.on('pageerror', lambda e: errors.append(str(e)))
                    page.goto(base + path, wait_until='networkidle', timeout=60000)
                    page.wait_for_timeout(2500)
                    page.screenshot(path=str(OUT / f'{name}-{vp_name}.png'))
                    wide = page.evaluate('document.documentElement.scrollWidth > window.innerWidth')
                    print(f'{name}/{vp_name}: errors={len(errors)} hscroll={wide}')
                    for e in errors[:5]: print('   ', e[:200])
                    failures += len(errors) + int(wide)
                    page.close()
            b.close()
        sys.exit(1 if failures else 0)
    finally:
        if proc is not None:
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

if __name__ == '__main__':
    main()
