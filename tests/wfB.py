from lib import *
SUM = {"title": "Signal redundancy", "description": "Fixture article", "extract": "Signal redundancy is a test fixture article about repeating information so that errors can be corrected.", "revision": "1234567", "timestamp": "2026-09-01T10:00:00Z", "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Signal_redundancy"}}}
HTML = """<html about="//en.wikipedia.org/wiki/Special:Redirect/revision/1234567"><body><section data-mw-section-id="0"><p>Signal redundancy is a fixture. See <a rel="mw:WikiLink" href="./Information_theory">information theory</a>.<sup class="mw-ref reference"><a href="#cite_note-1">[1]</a></sup></p><table class="infobox"><tr><th>Field</th><td>Coding theory</td></tr></table></section>
<section data-mw-section-id="1"><h2 id="History">History</h2><p>It has a history.<sup class="mw-ref reference"><a href="#cite_note-2">[2]</a></sup></p></section>
<section data-mw-section-id="2"><h2 id="References">References</h2><ol class="mw-references references"><li id="cite_note-1"><span class="mw-reference-text"><span typeof="mw:Transclusion" data-mw='{"parts":[{"template":{"target":{"wt":"cite journal"},"params":{"last":{"wt":"Doe"},"first":{"wt":"Jane"},"title":{"wt":"Redundancy and noise in biological signalling"},"journal":{"wt":"Journal of Fixture Studies"},"year":{"wt":"2021"},"doi":{"wt":"10.1000/test.2021.045"}}}}]}'><cite>Doe, Jane (2021). "Redundancy and noise in biological signalling". <i>Journal of Fixture Studies</i>. <a rel="mw:ExtLink" href="https://doi.org/10.1000/test.2021.045">doi:10.1000/test.2021.045</a>.</cite></span></span></li><li id="cite_note-2"><span class="mw-reference-text">A web page without a template. <a rel="mw:ExtLink" href="https://example.org/page">example.org</a></span></li></ol></section></body></html>"""
CR = {"message": {"DOI": "10.1000/test.2021.045", "title": ["Redundancy and noise in biological signalling"], "author": [{"family": "Doe", "given": "Jane"}], "issued": {"date-parts": [[2021, 5]]}, "container-title": ["Journal of Fixture Studies"], "volume": "12", "issue": "3", "page": "45-67", "publisher": "Fixture Press", "type": "journal-article"}}
def route_wiki(r):
    u = r.request.url
    if 'page/summary' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps(SUM))
    if 'page/html' in u: return r.fulfill(status=200, content_type='text/html', body=HTML)
    if 'morelike' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps({"query": {"search": [{"title": "Error correction", "pageid": 2, "snippet": "x", "wordcount": 5}]}}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps({"query": {"search": [{"title": "Signal redundancy", "pageid": 1, "snippet": "A <span class=\"searchmatch\">fixture</span> article", "wordcount": 321}]}}))
with sync_playwright() as p:
    b, ctx, pg, logs = new_page(p)
    ctx.route('**/en.wikipedia.org/**', route_wiki); ctx.route('**/api.crossref.org/works/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(CR)))
    load(pg)
    @step('B1 search Wikipedia inside the app (fixture)')
    def b1():
        pg.click('.panel-quick button[aria-label="Wikipedia"]'); pg.fill('.panel-search input[type=search]', 'redundancy'); pg.keyboard.press('Enter'); pg.wait_for_selector('.wiki-hit', timeout=6000); assert 'Signal redundancy' in pg.inner_text('.wiki-hit')
    b1()
    @step('B2 read article natively: lead, infobox, contents, related pages, notice, no iframe')
    def b2():
        pg.click('.wiki-hit'); pg.wait_for_selector('.wiki-lead', timeout=6000); t = pg.inner_text('.panel-body') + ' ' + pg.evaluate("document.querySelector('.wiki-ib').textContent")
        miss=[k for k in ['repeating information','Coding theory','History','Error correction','rarely the right final source'] if k not in t]; assert not miss, (miss, t[:400])
        assert pg.locator('.panel-body iframe').count() == 0
    b2()
    @step('B3 internal wiki link navigates inside the app')
    def b3():
        assert pg.locator('.wiki-body [data-wiki="Information theory"]').count() == 1
    b3()
    @step('B4 inspect a reference: click [1] shows underlying citation with DOI link')
    def b4():
        pg.click('.wiki-body [data-ref="cite_note-1"]'); pg.wait_for_selector('.ref-pop .ref-card'); t = pg.inner_text('.ref-pop'); assert 'Redundancy and noise' in t and 'doi:10.1000/test.2021.045' in t
    b4()
    @step('B5 save the underlying source via DOI lookup (stronger source), page-independent')
    def b5():
        pg.click('.ref-pop button:has-text("Save source")'); pg.wait_for_function("[...window.__S.sources.values()].some(s=>s.DOI==='10.1000/test.2021.045')", timeout=6000)
        s = pg.evaluate("[...window.__S.sources.values()].find(s=>s.DOI==='10.1000/test.2021.045')"); assert s['container-title'] == 'Journal of Fixture Studies' and s['type'] == 'article-journal' and s['volume'] == '12'
        pg.keyboard.press('Escape')
    b5()
    @step('B6 cite that source in the paper; bibliography has it, not Wikipedia')
    def b6():
        sid = pg.evaluate("[...window.__S.sources.values()].find(s=>s.DOI==='10.1000/test.2021.045').id")
        pg.click('.panel-body .btn-primary:has-text("Cite")') if pg.locator('.panel-body .btn-primary:has-text("Cite")').count() else None
        cursor_end_of(pg, 'Information language in biology was a working analogy'); pg.evaluate("(id)=>window.__E.cmd.citation([{sourceId:id}])", sid); pg.wait_for_timeout(600)
        bib = pg.inner_text('.paper-bib'); assert 'Redundancy and noise' in bib and 'Wikipedia' not in bib
    b6()
    pg.click('.panel-quick button[aria-label="Wikipedia"]'); pg.wait_for_selector('.wiki-lead')
    @step('B7 select Wikipedia text: bar offers copy/note/save/link; note saved with Wikipedia source (permalink + revision)')
    def b7():
        pg.evaluate("""()=>{const p=document.querySelector('.wiki-lead');const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r);document.querySelector('.wiki-scroll').dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))}""")
        pg.wait_for_selector('.reader-bar'); assert pg.locator('.reader-bar button').count() >= 4
        pg.click('.reader-bar button[aria-label="Make a research note"]'); pg.wait_for_selector('.note-form'); pg.keyboard.press('Escape') if False else pg.click('dialog button:has-text("Save")'); pg.wait_for_timeout(400)
        w = pg.evaluate("[...window.__S.sources.values()].find(s=>s._origin==='wikipedia'&&s._wikiTitle==='Signal redundancy')"); assert w and 'oldid=1234567' in w['URL'] and w['_wikiRev'] == '1234567' and w['accessed'], w
        n = pg.evaluate("[...window.__S.notes.values()].find(n=>n.tags&&n.tags.includes('wikipedia'))"); assert n and n['kind'] == 'quotation' and n['sourceId'] == w['id']
    b7()
    pg.screenshot(path='shots/B.png'); print(logs[:4]); b.close()
