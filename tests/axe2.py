from lib import *
axe = open('../node_modules/axe-core/axe.min.js').read()
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1440, 'height': 900}); pg = ctx.new_page()
    pg.goto('http://127.0.0.1:5173/'); pg.wait_for_selector('.dash .d-data'); pg.wait_for_timeout(400)
    def scan(name):
        pg.evaluate(axe); r = pg.evaluate("axe.run(document,{resultTypes:['violations']}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,ex:v.nodes[0].html.slice(0,100)})))"); print(name, 'violations:', r or 'none')
    pg.screenshot(path='shots/dash3.png'); scan('dashboard')
    pg.click('.continue'); pg.wait_for_selector('.paper-mount', state='visible'); pg.wait_for_timeout(500); scan('paper')
    pg.click('.vs-b:has-text("Notes")'); pg.wait_for_timeout(500); scan('notes')
    m = b.new_context(viewport={'width': 390, 'height': 800}).new_page(); m.goto('http://127.0.0.1:5173/'); m.wait_for_selector('.dash .d-data'); m.wait_for_timeout(400); m.screenshot(path='shots/dash-phone.png'); m.click('.continue'); m.wait_for_timeout(500); m.click('.vs-b:has-text("Notes")'); m.wait_for_timeout(400); m.screenshot(path='shots/notes-phone.png')
    b.close()
