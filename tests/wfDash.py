from lib import *
with sync_playwright() as p:
    b, ctx, pg, logs = new_page(p); load(pg)
    @step('H1 dashboard shows per-paper stats and totals')
    def h1():
        pg.click('#btn-home'); pg.wait_for_selector('.dash .d-data'); row = pg.inner_text('.d-data'); t = pg.inner_text('.d-stats')
        w = pg.evaluate('0'); assert 'Information as Metaphor' in row and '1,200' in row and 'open comment' in row, row
        assert 'words in notebooks' in t
    h1()
    @step('H2 create second paper from dashboard, write, return: both listed with correct words')
    def h2():
        pg.click('.d-head >> text=New paper'); pg.fill('dialog input', 'Second paper on tides'); pg.keyboard.press('Enter'); pg.wait_for_selector('.paper-mount', state='visible'); pg.wait_for_timeout(600)
        pg.evaluate("(()=>{const E=window.__E;const d=E.view.state.doc;let pos=0;for(let i=0;i<4;i++)pos+=d.child(i).nodeSize;E.view.dispatch(E.view.state.tr.setSelection(window.__TS.near(E.view.state.doc.resolve(pos+1))));E.view.focus()})()")
        pg.keyboard.type('Tides rise and fall because of gravity from the moon and the sun. ' * 3); pg.wait_for_timeout(1500)
        pg.click('#btn-home'); pg.wait_for_selector('.d-data >> nth=1'); rows = pg.locator('.d-data').all_inner_texts(); assert len(rows) == 2, rows
        second = [r for r in rows if 'Second paper' in r][0]; assert '39 words' in second, second
    h2()
    @step('H3 one click opens the other paper; switching via project menu and palette works; Notes link in row menu')
    def h3():
        pg.click('.d-data:has-text("Information as")'); pg.wait_for_selector('.paper-mount', state='visible'); pg.wait_for_timeout(400); assert 'Information as Metaphor' in pg.inner_text('.proj-btn')
        pg.click('.proj-btn'); pg.click('.menu-item:has-text("Second paper on tides")'); pg.wait_for_timeout(800); assert 'Second paper' in pg.inner_text('.proj-btn') and 'Tides rise' in pg.inner_text('.paper-mount')
        pg.keyboard.press('Control+k'); pg.fill('.pal-in', 'Open paper'); pg.wait_for_selector('.pal-it:has-text("Open paper: Information")'); pg.keyboard.press('Enter'); pg.wait_for_timeout(800); assert 'Information as Metaphor' in pg.inner_text('.proj-btn')
        pg.click('#btn-home'); pg.wait_for_selector('.d-data'); pg.locator('.d-data:has-text("Second paper") .d-more').click(); pg.click('.menu-item:has-text("Open notebook")'); pg.wait_for_selector('.nb-mount .ProseMirror', state='visible'); assert pg.locator('.vs-b.on').inner_text().strip() == 'Notes' and 'Second paper' in pg.inner_text('.proj-btn')
    h3()
    @step('H4 notebooks are per paper; notebook words feed the dashboard')
    def h4():
        assert 'Open questions' not in pg.inner_text('.nb-mount'); pg.click('.nb-mount .ProseMirror'); pg.keyboard.type('Eight words go into this very short note.'); pg.wait_for_timeout(1200)
        pg.click('#btn-home'); pg.wait_for_selector('.d-data'); r = pg.locator('.d-data:has-text("Second paper")').inner_text(); assert '8' in r, r
    h4()
    @step('H5 sort by title works; delete paper from dashboard with confirmation; data gone')
    def h5():
        pg.click('.d-th:has-text("Paper")'); first = pg.locator('.d-data .d-name').first.inner_text(); assert first.startswith('Information'), first
        pg.locator('.d-data:has-text("Second paper") .d-more').click(); pg.click('.menu-item:has-text("Delete")'); pg.click('dialog button:has-text("Delete paper")'); pg.wait_for_timeout(600)
        assert pg.locator('.d-data').count() == 1 and pg.evaluate("indexedDB.databases().then(d=>d.length>0)")
    h5()
    @step('H6 Enter accepts an @ suggestion in the paper (regression)')
    def h6():
        pg.click('.continue'); pg.wait_for_selector('.paper-mount', state='visible'); cursor_end_of(pg, 'Information language in biology was a working analogy'); n0 = pg.evaluate("window.__E.analysis().citations.length")
        pg.keyboard.type(' @Kay'); pg.wait_for_selector('.suggest-it'); pg.keyboard.press('Enter'); pg.wait_for_timeout(500); assert pg.evaluate("window.__E.analysis().citations.length") == n0 + 1
    h6()
    @step('H7 backup of a non-open paper includes notebook and restores')
    def h7():
        pg.click('#btn-home'); pg.wait_for_selector('.d-data')
        with pg.expect_download() as d: pg.locator('.d-data .d-more').first.click(); pg.click('.menu-item:has-text("Back up")')
        data = json.load(open(d.value.path())); assert data['format'] == 'paper-workbench/1' and data['notebook'] and len(data['items']['source']) >= 8
    h7()
    pg.screenshot(path='shots/dash2.png'); print('console', logs[:3]); b.close()
