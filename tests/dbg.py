from lib import *
with sync_playwright() as p:
    b, ctx, pg, logs = new_page(p); load(pg)
    pid = pg.evaluate("window.__S.id"); doc = pg.evaluate("window.__E.getJSON()")
    s = json.dumps(doc).replace('Introduction', 'RECOVERED-HEADING')
    pg.evaluate("([k,v])=>localStorage.setItem(k,v)", ['recover:' + pid, json.dumps({'t': 9999999999999, 'json': json.loads(s)})])
    print('stored', pg.evaluate("localStorage.getItem('recover:'+window.__S.id)")[:60])
    pg.reload(); pg.wait_for_selector('.ProseMirror'); pg.wait_for_timeout(1500)
    print('after reload ls:', (pg.evaluate("localStorage.getItem('recover:'+window.__S.id)") or 'NONE')[:60])
    print('has marker:', 'RECOVERED-HEADING' in pg.inner_text('.paper-mount'), 'toast:', pg.locator('.toast').all_inner_texts())
    print(logs[:3]); b.close()
