from lib import *
import os
axe = open('../node_modules/axe-core/axe.min.js').read()
with sync_playwright() as p:
    b = p.chromium.launch()
    def page(w, h, scheme='light'):
        ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme); pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); load(pg); return pg, errs
    pg, errs = page(1000, 800); pg.screenshot(path='shots/tablet.png'); print('tablet errs', errs)
    pg.click('#btn-left'); pg.wait_for_timeout(300); pg.screenshot(path='shots/tablet-left.png')
    pg2, e2 = page(390, 800); pg2.screenshot(path='shots/phone.png'); pg2.click('.mnav button[data-k="sources"]'); pg2.wait_for_timeout(300); pg2.screenshot(path='shots/phone-sources.png'); print('phone errs', e2)
    pg3, e3 = page(1440, 900, 'dark'); pg3.screenshot(path='shots/dark.png')
    pg4, e4 = page(1440, 900); pg4.keyboard.press('Control+Shift+Enter'); pg4.wait_for_timeout(300); pg4.screenshot(path='shots/focus.png'); print('focus hidden toolbar:', not pg4.locator('.toolbar').is_visible(), not pg4.locator('.left').is_visible())
    pg4.keyboard.press('Escape'); pg4.wait_for_timeout(200); print('exited focus:', pg4.locator('.toolbar').is_visible())
    # axe on desktop
    pg5, e5 = page(1440, 900); pg5.evaluate(axe); res = pg5.evaluate("axe.run(document,{resultTypes:['violations']}).then(r=>r.violations.map(v=>({id:v.id,impact:v.impact,n:v.nodes.length,help:v.help,ex:v.nodes[0].html.slice(0,110)})))")
    print('axe violations:'); [print(' ', v) for v in res]
    b.close()
