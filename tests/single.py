from lib import *
import os
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1440, 'height': 900}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto('file://' + os.path.abspath('../dist-single/paper.html')); pg.wait_for_selector('.ProseMirror', timeout=15000); pg.wait_for_timeout(1500)
    print('single-file loads, headings:', pg.evaluate("window.__E.analysis().headings.length"))
    pg.click('.side-tabs .seg-b:has-text("Sources")')
    with pg.expect_file_chooser() as fc: pg.click('button[aria-label^="Import files"]')
    fc.value.set_files(os.path.abspath('fixture.pdf')); pg.wait_for_function("[...window.__S.sources.values()].some(s=>s._pdf && window.__S.texts.has(s.id))", timeout=20000)
    sid = pg.evaluate("[...window.__S.sources.values()].find(s=>s._pdf).id"); pg.dblclick(f'.src-row[data-id="{sid}"]'); pg.wait_for_selector('.textLayer span', timeout=15000)
    print('single-file PDF reader OK, pages:', pg.locator('.pdf-page').count()); print('errors:', [e for e in errs if 'favicon' not in e][:3]); b.close()
