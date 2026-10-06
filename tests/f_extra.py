from lib import *
import zipfile, os, subprocess, tempfile, shutil
out = tempfile.mkdtemp()
with sync_playwright() as p:
    b, ctx, pg, logs = new_page(p); load(pg)
    def export(label):
        pg.click('button:has-text("Export")'); pg.wait_for_selector('.export'); pg.click(f'.fmt:has-text("{label}")')
        with pg.expect_download(timeout=30000) as d: pg.click('dialog button:has-text("Export")')
        path = os.path.join(out, d.value.suggested_filename); d.value.save_as(path); return path
    dx = export('Word'); tz = export('LaTeX'); b.close()
subprocess.run(['soffice','--headless','--convert-to','pdf','--outdir',out,dx],capture_output=True,timeout=120)
pdf = dx[:-5]+'.pdf'
t = subprocess.run(['pdftotext','-layout',pdf,'-'],capture_output=True).stdout.decode()
i = t.find('measured in bits'); print('--- PDF near equation ---'); print(t[max(0,i-420):i+60])
print('pages:', subprocess.run(['pdfinfo',pdf],capture_output=True).stdout.decode().split('Pages:')[1].split()[0])
z = zipfile.ZipFile(dx); doc = z.read('word/document.xml').decode(); j = doc.find('<m:oMathPara'); print('--- OMML sample ---'); print(doc[j:j+700])
# LaTeX compile
d = tempfile.mkdtemp(); zipfile.ZipFile(tz).extractall(d)
print('biblatex.sty:', subprocess.run(['kpsewhich','biblatex.sty'],capture_output=True).stdout.decode().strip() or 'MISSING', '| biber:', shutil.which('biber'), '| apa.bbx:', subprocess.run(['kpsewhich','apa.bbx'],capture_output=True).stdout.decode().strip() or 'MISSING')
