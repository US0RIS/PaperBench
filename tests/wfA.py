from lib import *
with sync_playwright() as p:
    b, ctx, pg, logs = new_page(p)
    ctx.route('**/api.crossref.org/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(CROSSREF)))
    ctx.route('**/api.openalex.org/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"results":[]}'))
    ctx.route('**/en.wikipedia.org/**', lambda r: r.fulfill(status=200, content_type='application/json', body='{"query":{"search":[]}}'))
    load(pg)
    @step('A1 search research returns a Crossref record (fixture)')
    def a1():
        pg.fill('.panel-search input[type=search]', 'redundancy noise biological'); pg.keyboard.press('Enter'); pg.wait_for_selector('.res-row', timeout=8000)
        assert 'Redundancy and noise' in pg.inner_text('.res-row')
    a1()
    @step('A2 one-click save adds to library')
    def a2():
        n0 = pg.evaluate('window.__S.sources.size'); pg.click('.res-row button:has-text("Save")'); pg.wait_for_timeout(300)
        assert pg.evaluate('window.__S.sources.size') == n0 + 1
        s = pg.evaluate("[...window.__S.sources.values()].find(s=>s.DOI==='10.1000/test.2021.045')"); assert s and s['volume'] == '12' and s['author'][0]['family'] == 'Doe'
    a2()
    @step('A3 @ menu inserts citation, Tab opens locator editor, page shows in text')
    def a3():
        cursor_end_of(pg, 'Information language in biology was a working analogy')
        pg.keyboard.type(' See @doe'); pg.wait_for_selector('.suggest-it'); pg.keyboard.press('Tab'); pg.wait_for_selector('.cite-ed')
        pg.fill('.cite-ed input[placeholder^="Page"]', '51'); pg.wait_for_timeout(500)
        t = pg.inner_text('.cite-prev'); assert 'p. 51' in t and 'Doe' in t, t
        pg.click('.cite-ed button:has-text("Done")'); pg.wait_for_timeout(500)
        assert 'Doe' in pg.inner_text('.paper-mount') and '51' in pg.inner_text('.paper-mount')
    a3()
    @step('A4 bibliography includes cited source only and updates')
    def a4():
        bib = pg.inner_text('.paper-bib'); assert 'Redundancy and noise in biological signalling' in bib, bib
        assert 'Crick, F. H. C. (1958)' not in bib
        assert 'Shannon' in bib
    a4()
    @step('A5 clicking the citation opens evidence inspector with metadata')
    def a5():
        pg.click('.paper-mount .cite >> nth=-1'); pg.wait_for_timeout(500)
        t = pg.inner_text('.panel-body'); assert 'Redundancy and noise' in t and 'page 51' in t, t[:300]
    a5()
    pg.screenshot(path='shots/A.png')
    print([l for l in logs][:5])
    b.close()
for r in RESULTS: pass
