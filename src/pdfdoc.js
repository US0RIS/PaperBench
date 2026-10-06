import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';
let ready = false;
function setup() {
  if (ready) return; ready = true;
  if (typeof __WORKER_INLINE__ !== 'undefined' && __WORKER_INLINE__) pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([document.getElementById('pdf-worker-src').textContent], { type: 'text/javascript' }));
  else pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', document.baseURI).href;
}
export async function loadPdf(buf) { setup(); return pdfjs.getDocument({ data: new Uint8Array(buf.slice ? buf.slice(0) : buf), isEvalSupported: false }).promise; }
export const TextLayer = pdfjs.TextLayer;
export async function pageText(page) {
  const c = await page.getTextContent(); let s = '';
  for (const it of c.items) { s += it.str; s += it.hasEOL ? '\n' : (it.str && !/\s$/.test(it.str) ? ' ' : ''); }
  return s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
}
export async function extractAll(pdf, onProgress) {
  const out = []; for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); out.push(await pageText(p)); p.cleanup(); onProgress?.(i, pdf.numPages); }
  return out;
}
export async function pdfMeta(pdf) {
  let info = {}; try { info = (await pdf.getMetadata()).info || {}; } catch { /* */ }
  let labels = null; try { labels = await pdf.getPageLabels(); } catch { /* */ }
  return { info, labels };
}
