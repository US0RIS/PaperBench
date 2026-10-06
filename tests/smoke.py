import sys, json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width':1440,'height':900}); pg = ctx.new_page()
    logs=[]
    pg.on('console', lambda m: logs.append((m.type, m.text)) if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: logs.append(('pageerror', str(e))))
    pg.goto('http://127.0.0.1:5173/'); pg.wait_for_timeout(2500)
    pg.screenshot(path='shots/01-initial.png')
    print('title', pg.title()); print('paper text:', pg.inner_text('.ProseMirror')[:200].replace('\n',' | '))
    for t,m in logs[:15]: print(t, m[:300])
    b.close()
