from lib import *
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1440, 'height': 900}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto('http://127.0.0.1:5173/'); pg.wait_for_selector('.dash .d-data', timeout=15000); pg.wait_for_timeout(500); pg.screenshot(path='shots/dash.png')
    pg.click('.continue'); pg.wait_for_selector('.ProseMirror', state='visible'); pg.wait_for_timeout(700); pg.screenshot(path='shots/paper2.png')
    pg.click('.vs-b:has-text("Notes")'); pg.wait_for_selector('.nb-mount .ProseMirror', state='visible'); pg.wait_for_timeout(500); pg.screenshot(path='shots/notes.png')
    print('errors', errs[:5]); b.close()
