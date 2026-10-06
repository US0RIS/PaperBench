from lib import *
import zipfile, io, os, subprocess, tempfile
out = tempfile.mkdtemp()
with sync_playwright() as p:
    b, ctx, pg, logs = new_page(p); load(pg)
    def export(label, name_ends):
        pg.click('button:has-text("Export")'); pg.wait_for_selector('.export')
        pg.click(f'.fmt:has-text("{label}")')
        with pg.expect_download(timeout=30000) as d: pg.click('dialog button:has-text("Export")')
        dl = d.value; path = os.path.join(out, dl.suggested_filename); dl.save_as(path); assert dl.suggested_filename.endswith(name_ends), dl.suggested_filename
        pg.wait_for_timeout(300); return path
    paths = {}
    @step('F1 DOCX export downloads')
    def f1(): paths['docx'] = export('Word', '.docx'); assert os.path.getsize(paths['docx']) > 8000
    f1()
    @step('F2 DOCX contains headings, real footnotes, table, image, equations, bibliography, caption numbers')
    def f2():
        z = zipfile.ZipFile(paths['docx']); doc = z.read('word/document.xml').decode(); names = z.namelist()
        assert 'word/footnotes.xml' in names; fn = z.read('word/footnotes.xml').decode(); assert 'bandwagon' in fn.lower() or 'Shannon' in fn, fn[:300]
        assert '<w:tbl>' in doc and 'Terms borrowed from communication theory' in doc and 'Table 1.' in doc
        assert any(n.startswith('word/media/') for n in names), 'no embedded figure'
        assert 'Figure 1.' in doc and 'm:oMath' in doc, 'equation OMML missing'
        assert 'References' in doc and 'Maynard Smith' in doc and 'Heading1' in doc
        assert 'Counterarguments' not in doc and 'Drafting note' not in doc and 'Draft note' not in doc, 'planning content leaked'
        assert 'w:footnoteReference' in doc
    f2()
    @step('F3 DOCX opens in LibreOffice and converts to text with expected content')
    def f3():
        r = subprocess.run(['soffice', '--headless', '--convert-to', 'txt:Text', '--outdir', out, paths['docx']], capture_output=True, timeout=120); txt = open(os.path.join(out, os.path.basename(paths['docx'])[:-5] + '.txt'), errors='ignore').read()
        assert 'Information as Metaphor' in txt and 'Shannon' in txt and 'Table 1' in txt and 'Figure 1' in txt, txt[:300]
        # equation rendering is not checkable here: this LibreOffice has no Math component (pandoc's own OMML also renders blank); F2 checks the OMML structure
        paths['txt_lo'] = txt
    f3()
    @step('F4 DOCX converts to PDF via LibreOffice (valid file)')
    def f4():
        subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', out, paths['docx']], capture_output=True, timeout=120); pdf = os.path.join(out, os.path.basename(paths['docx'])[:-5] + '.pdf'); assert os.path.getsize(pdf) > 5000; paths['pdf'] = pdf
        t = subprocess.run(['pdftotext', pdf, '-'], capture_output=True).stdout.decode(); assert 'References' in t and '(Kay, 2000' in t, t[:200]
    f4()
    @step('F5 HTML export keeps MathML, footnotes, caption, bibliography')
    def f5():
        h = open(export('HTML', '.html'), errors='ignore').read(); assert '<math' in h and 'id="fn1"' in h and 'Figure 1.' in h and 'References' in h and 'data:image' in h
    f5()
    @step('F6 Markdown export (zip because figure) has footnotes and math')
    def f6():
        z = zipfile.ZipFile(export('Markdown', '.zip')); md = z.read('paper.md').decode(); assert '[^1]:' in md and '$$' in md and 'Table 1' in md and any(n.startswith('images/') for n in z.namelist()), md[:200]
    f6()
    @step('F7 plain text export')
    def f7():
        t = open(export('Plain text', '.txt'), errors='ignore').read(); assert 'Information as Metaphor' in t and 'References' in t
    f7()
    @step('F8 LaTeX zip: biblatex commands, equation, footnote, figures, bib')
    def f8():
        z = zipfile.ZipFile(export('LaTeX', '.zip')); tex = z.read('paper.tex').decode(); bib = z.read('references.bib').decode()
        assert '\\parencite' in tex and '\\textcite' in tex and '\\begin{equation}' in tex and '\\footnote{' in tex and '\\includegraphics' in tex and '\\printbibliography' in tex, tex[:900]
        assert '@article' in bib and 'Shannon' in bib; assert any(n.startswith('figures/') for n in z.namelist())
        d = tempfile.mkdtemp(); z.extractall(d); r = subprocess.run(['which', 'pdflatex'], capture_output=True); paths['pdflatex'] = bool(r.stdout)
    f8()
    @step('F9 BibTeX / RIS / CSL JSON export of cited sources')
    def f9():
        bt = open(export('BibTeX', '.bib'), errors='ignore').read(); assert '@article' in bt and 'Watson' in bt and 'Crick, F. H. C. (1958)' not in bt and 'On protein synthesis' not in bt
        ris = open(export('RIS', '.ris'), errors='ignore').read(); assert 'TY  - JOUR' in ris and 'Shannon' in ris
        cj = json.load(open(export('CSL JSON', '.json'))); assert isinstance(cj, list) and any('Shannon' in (x.get('author') or [{}])[0].get('family', '') for x in cj)
    f9()
    @step('F10 print/PDF HTML renders to a PDF with page numbers and all sections (Chromium print)')
    def f10():
        html = pg.evaluate("(async()=>{const m=await window.__model.buildModel(); return await window.__exp.toHTML(m,{},{print:true})})()")
        pg2 = ctx.new_page(); pg2.set_content(html); pg2.wait_for_timeout(500); pdf = os.path.join(out, 'print.pdf'); pg2.pdf(path=pdf, prefer_css_page_size=True)
        t = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True).stdout.decode(); assert 'Information as Metaphor' in t and 'References' in t and 'Notes' in t, t[:200]
        info = subprocess.run(['pdfinfo', pdf], capture_output=True).stdout.decode(); n = int(re.search(r'Pages:\s+(\d+)', info).group(1)); assert n >= 3, n
    f10()
    print('pdflatex available:', paths.get('pdflatex')); print('console errors:', logs[:3]); b.close()
