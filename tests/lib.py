import json, re, sys, traceback
from playwright.sync_api import sync_playwright, expect
RESULTS = []
def step(name):
    def deco(fn):
        def run(*a, **k):
            try: fn(*a, **k); RESULTS.append((name, 'PASS', '')); print('PASS', name)
            except Exception as e:
                RESULTS.append((name, 'FAIL', str(e)[:300])); print('FAIL', name, '->', str(e)[:400].replace('\n', ' '))
        return run
    return deco
CROSSREF = {"message": {"items": [{"DOI": "10.1000/test.2021.045", "title": ["Redundancy and noise in biological signalling"], "author": [{"family": "Doe", "given": "Jane"}, {"family": "Roe", "given": "Richard"}], "issued": {"date-parts": [[2021, 5]]}, "container-title": ["Journal of Fixture Studies"], "volume": "12", "issue": "3", "page": "45-67", "publisher": "Fixture Press", "type": "journal-article", "abstract": "<jats:p>This record is a test fixture.</jats:p>", "is-referenced-by-count": 12}]}}
def new_page(p, **kw):
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True, **kw); pg = ctx.new_page()
    logs = []; pg.on('console', lambda m: logs.append((m.type, m.text)) if m.type == 'error' else None); pg.on('pageerror', lambda e: logs.append(('pageerror', str(e))))
    return b, ctx, pg, logs
def load(pg):
    pg.goto('http://127.0.0.1:5173/'); pg.wait_for_selector('.dash .d-data', timeout=15000); pg.click('.continue'); pg.wait_for_selector('.ProseMirror', state='visible'); pg.wait_for_timeout(900)
def cursor_end_of(pg, contains):
    ok = pg.evaluate("""(t) => { const E = window.__E; let pos = null; E.view.state.doc.descendants((n, p) => { if (pos == null && n.isTextblock && n.textContent.includes(t)) pos = p + n.nodeSize - 1; return pos == null; }); if (pos == null) return false; E.view.dispatch(E.view.state.tr.setSelection(E.view.state.selection.constructor.near(E.view.state.doc.resolve(pos), -1))); E.view.focus(); return true; }""", contains)
    assert ok, 'paragraph not found: ' + contains
