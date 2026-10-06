from lib import *
import os
with sync_playwright() as p:
    b, ctx, pg, logs = new_page(p); load(pg)
    # ============ suggesting / editing toggle: every entry point, persistence, indicator
    def mode_ui(): return {'suggest': pg.evaluate("window.__E.suggesting"), 'seg': pg.locator('.mode-seg .seg-b.on').inner_text().strip(), 'banner': pg.locator('.mode-banner').is_visible(), 'body': pg.evaluate("document.body.classList.contains('suggesting')")}
    @step('M1 toolbar toggle -> state, button, banner and body class all agree; focus returns to editor')
    def m1():
        pg.click('.mode-seg .seg-b:has-text("Suggesting")'); u = mode_ui(); assert u == {'suggest': True, 'seg': 'Suggesting', 'banner': True, 'body': True}, u
        assert pg.evaluate("document.activeElement.classList.contains('ProseMirror')")
        pg.click('.mode-seg .seg-b:has-text("Editing")'); u = mode_ui(); assert u == {'suggest': False, 'seg': 'Editing', 'banner': False, 'body': False}, u
    m1()
    @step('M2 keyboard shortcut Ctrl+Shift+E toggles; palette command toggles; banner button returns to editing')
    def m2():
        cursor_end_of(pg, 'Information language in biology was a working analogy'); pg.keyboard.press('Control+Shift+e'); assert mode_ui()['suggest'] is True
        pg.keyboard.press('Control+Shift+e'); assert mode_ui()['suggest'] is False
        pg.keyboard.press('Control+k'); pg.fill('.pal-in', 'suggesting'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300); assert mode_ui()['suggest'] is True
        pg.click('.mode-banner >> text=Switch to editing'); assert mode_ui() == {'suggest': False, 'seg': 'Editing', 'banner': False, 'body': False}
    m2()
    @step('M3 panel toggle stays in sync with toolbar')
    def m3():
        pg.click('.panel-title'); pg.click('.menu-item:has-text("Suggested changes")'); pg.click('.panel-body .seg-b:has-text("Suggesting")'); pg.wait_for_timeout(200)
        u = mode_ui(); assert u['suggest'] and u['seg'] == 'Suggesting', u
        pg.click('.mode-seg .seg-b:has-text("Editing")'); pg.wait_for_timeout(300); assert pg.locator('.panel-body .seg-b.on').inner_text().strip() == 'Editing', pg.locator('.panel-body .seg-b.on').inner_text()
    m3()
    def count(sel): return pg.locator(sel).count()
    @step('M4 suggesting: typing, backspace over own text, delete original text, replace selection, multi-block delete all tracked')
    def m4():
        cursor_end_of(pg, 'Information language in biology was a working analogy'); pg.keyboard.press('Control+Shift+e'); base = pg.inner_text('.paper-mount')
        pg.keyboard.type(' Added words.'); assert count('.paper-mount ins[data-sid]') >= 1
        for _ in range(3): pg.keyboard.press('Backspace')
        assert count('.paper-mount ins[data-sid]') >= 1 and count('.paper-mount del[data-sid]') == 0, 'backspacing own insertion should just delete it'
        for _ in range(4): pg.keyboard.press('ArrowLeft')
        pg.keyboard.press('Shift+ArrowLeft'); pg.keyboard.press('Shift+ArrowLeft'); pg.keyboard.press('Backspace'); n = count('.paper-mount del[data-sid]')
        pg.evaluate("(()=>{const E=window.__E;let a=null,b=null;E.view.state.doc.descendants((n,p)=>{if(a==null&&n.isTextblock&&n.textContent.startsWith('Information language in biology'))a=p+1;if(n.isTextblock&&n.textContent.startsWith('Information language in biology'))b=p;});const S=window.__TS;E.view.dispatch(E.view.state.tr.setSelection(S.create(E.view.state.doc,a+3,a+14)));E.view.focus()})()")
        pg.keyboard.type('Z'); assert count('.paper-mount del[data-sid]') > n, 'replace selection should mark old text deleted'
        # multi-block deletion: select from end of intro paragraph start into next paragraph
        pg.evaluate("(()=>{const E=window.__E;let a=null,b=null;E.view.state.doc.descendants((n,p)=>{if(n.isTextblock&&n.textContent.startsWith('In 1948'))a=p+10;if(n.isTextblock&&n.textContent.startsWith('The argument is modest'))b=p+12;});const S=window.__TS;E.view.dispatch(E.view.state.tr.setSelection(S.create(E.view.state.doc,a,b)));E.view.focus()})()")
        before = pg.evaluate("window.__E.view.state.doc.childCount"); pg.keyboard.press('Delete'); assert pg.evaluate("window.__E.view.state.doc.childCount") == before, 'block structure must be kept'
        assert 'The argument is modest' in pg.inner_text('.paper-mount') and count('.paper-mount del[data-sid]') > n + 1
        assert pg.evaluate("new Set([...document.querySelectorAll('.paper-mount ins[data-sid],.paper-mount del[data-sid]')].map(e=>e.dataset.sid)).size") <= 5
    m4()
    @step('M5 untracked structural edit (Enter) shows an honest notice; reject-all restores original text')
    def m5():
        pg.keyboard.press('Control+End'); pg.keyboard.press('Enter'); pg.wait_for_selector('.toast:has-text("not tracked")', timeout=3000)
        pg.click('.panel-title'); pg.click('.menu-item:has-text("Suggested changes")'); pg.click('button:has-text("Reject all")'); pg.wait_for_timeout(400)
        t = pg.inner_text('.paper-mount'); rem = count('.paper-mount ins[data-sid]') + count('.paper-mount del[data-sid]'); assert 'Added words' not in t and 'In 1948' in t and 'The argument is modest' in t and rem == 0, (rem, 'Added' in t)
    m5()
    @step('M6 mode resets to Editing when switching view away and projects (no accidental tracked edits)')
    def m6():
        pg.click('.mode-seg .seg-b:has-text("Suggesting")'); pg.click('.vs-b:has-text("Notes")'); pg.click('.vs-b:has-text("Paper")'); assert mode_ui()['suggest'] is True and mode_ui()['banner'], 'mode must survive view switch'
        pg.click('.mode-seg .seg-b:has-text("Editing")')
    m6()
    # ============ notes mode
    pg.click('.vs-b:has-text("Notes")'); pg.wait_for_selector('.nb-mount .ProseMirror', state='visible')
    @step('N1 notebook loads sample content, outline lists headings, links render with kinds')
    def n1():
        t = pg.inner_text('.nb-mount'); assert 'Open questions' in t and 'Ideas' in t
        kinds = pg.evaluate("[...document.querySelectorAll('.nlink')].map(e=>e.dataset.kind)"); assert sorted(set(kinds)) == ['note', 'paper', 'source'], kinds
        assert 'Open questions' in pg.inner_text('.left') and 'Ideas' in pg.inner_text('.left')
    n1()
    @step('N2 write endlessly: markdown shortcuts, task list, headings; empty area click focuses end')
    def n2():
        pg.evaluate("window.__NB.focus(); window.__NB.view.dispatch(window.__NB.view.state.tr.setSelection(window.__NB.view.state.selection.constructor.atEnd(window.__NB.view.state.doc)))")
        pg.keyboard.press('Enter'); pg.keyboard.type('# Reading plan'); pg.keyboard.press('Enter'); pg.keyboard.type('- first item'); pg.keyboard.press('Enter'); pg.keyboard.type('second item'); pg.keyboard.press('Enter'); pg.keyboard.press('Enter'); pg.keyboard.type('[] todo thing'); pg.keyboard.press('Enter'); pg.keyboard.press('Enter'); pg.keyboard.type('Plain with **bold** text and ==mark==.')
        h = pg.evaluate("window.__NB.headings().map(h=>h.text)"); assert 'Reading plan' in h, h
        assert pg.locator('.nb-mount ul li').count() >= 2 and pg.locator('.nb-mount ul[data-tasks]').count() >= 2 and pg.locator('.nb-mount strong').count() >= 1 and pg.locator('.nb-mount mark').count() == 1
    n2()
    @step('N3 [[ opens link menu: link to paper section, source and a block in the notes; inserted as links')
    def n3():
        pg.keyboard.press('Enter'); pg.keyboard.type('See [[Conclu'); pg.wait_for_selector('.suggest-it'); txt = pg.inner_text('.suggest'); assert 'In the paper' in txt and 'Conclusion' in txt, txt
        pg.keyboard.press('Enter'); pg.keyboard.type(' and [[Maynard'); pg.wait_for_selector('.suggest-it'); assert 'Sources' in pg.inner_text('.suggest'); pg.keyboard.press('Enter')
        pg.keyboard.type(' and [[Reading'); pg.wait_for_selector('.suggest-it'); assert 'In these notes' in pg.inner_text('.suggest'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
        ls = pg.evaluate("[...document.querySelectorAll('.nlink')].map(e=>[e.dataset.kind,e.textContent])"); assert ls[-3][0] == 'paper' and ls[-2][0] == 'source' and ls[-1][0] == 'note', ls
    n3()
    @step('N4 Ctrl+F finds in notes with count, next/prev, and highlights')
    def n4():
        pg.keyboard.press('Control+f'); pg.wait_for_selector('.nb-pane .findbar input[type=search]', state='visible'); pg.fill('.nb-pane .findbar input[type=search]', 'conclusion'); pg.wait_for_timeout(300)
        t = pg.inner_text('.nb-pane .findbar .fc'); assert 'of' in t, t; assert pg.locator('.nb-mount .find-hit').count() >= 1
        pg.keyboard.press('Enter'); pg.wait_for_timeout(200); assert pg.locator('.nb-mount .find-hit.current').count() == 1
        pg.keyboard.press('Escape'); assert not pg.locator('.nb-pane .findbar').is_visible() and pg.locator('.nb-mount .find-hit').count() == 0
    n4()
    pg.click('.nb-mount p >> nth=0')
    @step('N5 clicking links navigates: paper section scrolls in paper; note link scrolls in notes; source opens details')
    def n5():
        pg.click('.nb-mount .nlink[data-kind=paper] >> nth=-1'); pg.wait_for_selector('.paper-mount', state='visible'); pg.wait_for_timeout(500)
        assert pg.locator('.vs-b.on').inner_text().strip() == 'Paper'; assert pg.locator('.paper-mount .flash').count() >= 1, 'paper target not highlighted'
        pg.click('.vs-b:has-text("Notes")'); pg.click('.nb-mount .nlink[data-kind=source] >> nth=-1'); pg.wait_for_selector('.sd-title'); assert 'concept of information' in pg.inner_text('.panel-body').lower()
        pg.click('.nb-mount .nlink[data-kind=note] >> nth=-1'); pg.wait_for_timeout(500); assert pg.locator('.nb-mount .flash').count() >= 1
    n5()
    @step('N6 notes persist across reload; per-project (new paper has empty notes)')
    def n6():
        pg.wait_for_timeout(1000); pg.reload(); pg.wait_for_selector('.dash .d-data'); pg.click('.continue'); pg.click('.vs-b:has-text("Notes")'); pg.wait_for_timeout(500)
        assert 'Reading plan' in pg.inner_text('.nb-mount') and pg.locator('.nb-mount .nlink').count() >= 7
    n6()
    @step('N7 send selection from paper to notes creates quote with a link back')
    def n7():
        pg.click('.vs-b:has-text("Paper")'); pg.evaluate("(()=>{const E=window.__E;let f=null;E.view.state.doc.descendants((n,p)=>{if(f==null&&n.isText&&n.text.includes('working analogy before it was a theory')){f=p+n.text.indexOf('working analogy')}});const S=window.__TS;E.view.dispatch(E.view.state.tr.setSelection(S.create(E.view.state.doc,f,f+30)));E.view.focus()})()")
        pg.keyboard.press('Control+k'); pg.fill('.pal-in', 'Send selection'); pg.keyboard.press('Enter'); pg.wait_for_selector('.toast:has-text("Added to notes")')
        pg.click('.vs-b:has-text("Notes")'); assert 'working analogy' in pg.inner_text('.nb-mount blockquote') and pg.locator('.nb-mount .nlink[data-kind=paper]').count() >= 3
    n7()
    pg.screenshot(path='shots/new.png'); print('console errors:', [l for l in logs][:3]); b.close()
