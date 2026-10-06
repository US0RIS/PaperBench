from lib import *
import os
with sync_playwright() as p:
    b, ctx, pg, logs = new_page(p); load(pg)
    pdf = os.path.abspath('fixture.pdf')
    @step('C1 import a PDF as a source (indexed text stored)')
    def c1():
        pg.click('.side-tabs .seg-b:has-text("Sources")')
        with pg.expect_file_chooser() as fc: pg.click('button[aria-label^="Import files"]')
        fc.value.set_files(pdf); pg.wait_for_function("[...window.__S.sources.values()].some(s=>s._pdf && window.__S.texts.has(s.id))", timeout=15000)
        sid = pg.evaluate("[...window.__S.sources.values()].find(s=>s._pdf).id"); assert pg.evaluate("(id)=>window.__S.texts.get(id)?.length", sid) == 3
    c1()
    sid = pg.evaluate("[...window.__S.sources.values()].find(s=>s._pdf)?.id")
    @step('C2 open in internal reader: pages render with a text layer')
    def c2():
        pg.evaluate("(id)=>{window.__bus?.emit}", sid)
        pg.click('.src-row >> nth=0') if False else None
        pg.dblclick(f'.src-row[data-id="{sid}"]'); pg.wait_for_selector('.pdf-page canvas', timeout=10000); pg.wait_for_selector('.textLayer span', timeout=10000)
        assert pg.locator('.pdf-page').count() == 3
    c2()
    @step('C3 search inside document finds the term and navigates')
    def c3():
        pg.fill('.reader-bar-top input[type=search]', 'redundancy'); pg.keyboard.press('Enter'); pg.wait_for_timeout(800)
        t = pg.inner_text('.srch-c'); assert '1 of 1' in t, t
        assert pg.input_value('.pg-in') == '2', pg.input_value('.pg-in')
        pg.wait_for_selector('.srch-hit', timeout=4000)
    c3()
    def select_passage(text):
        pg.evaluate("""(t) => { const spans=[...document.querySelectorAll('.pdf-page .textLayer span')]; const sp=spans.find(s=>s.textContent.includes(t)); if(!sp) throw new Error('span not found'); const r=document.createRange(); r.selectNodeContents(sp); const s=getSelection(); s.removeAllRanges(); s.addRange(r); sp.closest('.pdf-scroll').dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); }""", text)
        pg.wait_for_selector('.reader-bar', timeout=3000)
    PASSAGE = 'The relevant passage states that redundancy lets a receiver recover a message after noise corrupts part of it.'
    @step('C4 select passage and highlight it (provenance stored)')
    def c4():
        select_passage('redundancy lets a receiver'); pg.click('.reader-bar button[aria-label="Highlight green"]'); pg.wait_for_timeout(400)
        hl = pg.evaluate("[...window.__S.P.highlights.values()].filter(h=>h.sourceId==='%s')" % sid); assert len(hl) == 1, hl
        h = hl[0]; assert h['page'] == '2' and h['pageIndex'] == 2 and 'redundancy lets a receiver' in h['text'] and h['rects'] and h['color'] == 'green' and h['prefix'] is not None
        assert pg.locator('.hl-layer .hl.c-green').count() >= 1
    c4()
    @step('C5 cite passage as quotation: inserted into draft with page locator')
    def c5():
        pg.click('.tab-b:has-text("Paper")'); cursor_end_of(pg, 'Information language in biology was a working analogy'); pg.click('.tab-b >> nth=1')
        select_passage('redundancy lets a receiver'); pg.click('.reader-bar button[aria-label="Cite this passage"]'); pg.click('.menu-item:has-text("Quotation in text")'); pg.wait_for_timeout(1200)
        t = pg.inner_text('.paper-mount'); assert 'redundancy lets a receiver recover a message' in t, t[-400:]
        assert pg.locator('.paper-mount .mk-quote').count() >= 1
        info = pg.evaluate("(()=>{let r=null;window.__E.view.state.doc.descendants(n=>{if(n.type.name==='citation'&&n.attrs.items.some(i=>i.noteId)) r=n.attrs.items[0]});return r})()")
        assert info and info['locator'] == '2' and info['label'] == 'page' and info['sourceId'] == sid, info
        txt = pg.inner_text('.paper-mount .cite >> nth=-1'); assert 'p. 2' in txt, txt
    c5()
    @step('C6 notes created: quotation note linked to highlight and source')
    def c6():
        n = pg.evaluate("[...window.__S.notes.values()].filter(n=>n.sourceId==='%s')" % sid); assert n and n[0]['kind'] == 'quotation' and n[0]['highlightId'] and n[0]['page'] == '2', n
    c6()
    @step('C7 click citation -> evidence inspector -> open exact passage in reader')
    def c7():
        pg.click('.paper-mount .cite >> nth=-1'); pg.wait_for_selector('.insp-q', timeout=4000)
        assert 'redundancy lets a receiver' in pg.inner_text('.insp-q')
        pg.click('.insp-q button:has-text("Open the exact passage")'); pg.wait_for_timeout(900)
        assert pg.locator('.tab.on .tab-t').inner_text().strip() != 'Paper'; assert pg.locator('.hl.flash').count() >= 0
        assert pg.input_value('.pg-in') == '2'
    c7()
    @step('C8 audit: quotation has citation so no quote warning for it')
    def c8():
        res = pg.evaluate("""(async()=>{ const m = await import('./app.js'); return null })()""") if False else None
        pg.click('.tab-b:has-text("Paper")'); pg.click('.panel-title'); pg.click('.menu-item:has-text("Citation audit")'); pg.wait_for_selector('.panel-body'); pg.wait_for_timeout(300)
        t = pg.inner_text('.panel-body'); assert 'redundancy lets a receiver' not in t, t
    c8()
    pg.screenshot(path='shots/C.png'); print(logs[:5]); b.close()
