// Source reader: PDF (pdf.js), captured web/HTML text, images, video, datasets. Highlights keep provenance.
import { S, putItem, removeItem, pushRecent } from './state.js';
import * as DB from './db.js';
import { h, icon, clear, popover, menu, toast, bus, $, $$, dialog } from './ui.js';
import { uid, now, shortCite, namesDisplay, escapeHtml } from './model.js';
import { loadPdf, TextLayer } from './pdfdoc.js';
import { sanitizeHTML } from './research.js';

export const HL_COLORS = ['yellow', 'green', 'blue', 'pink'];
const norm = (s) => s.replace(/\s+/g, ' ').trim();
export function htmlToPages(html) {
  const d = new DOMParser().parseFromString(html, 'text/html'); const out = []; let cur = '';
  d.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th,figcaption').forEach((e) => { const t = norm(e.textContent); if (!t) return; const pg = e.getAttribute('data-page'); if (pg && cur) { out.push(cur); cur = ''; } cur += (cur ? '\n' : '') + t; if (cur.length > 4000) { out.push(cur); cur = ''; } });
  if (cur) out.push(cur); return out.length ? out : [norm(d.body.textContent)];
}

// ---- selection capture ---------------------------------------------------------
export function createHighlight(src, { page, pageIndex, rects, text, prefix = '', suffix = '', color = 'yellow', kind = 'pdf', para }) {
  const hl = { id: uid('hl'), sourceId: src.id, kind, page: String(page ?? ''), pageIndex, rects, text, prefix, suffix, color, comment: '', created: now(), para };
  putItem('highlight', hl); return hl;
}
export function noteFromHighlight(hl, kind = 'quotation') {
  const n = { id: uid('note'), kind, text: hl.text, attach: { type: 'passage', refId: hl.id }, sourceId: hl.sourceId, page: hl.page, highlightId: hl.id, para: hl.para, tags: [], created: now(), updated: now() };
  putItem('note', n); hl.noteId = n.id; putItem('highlight', hl); pushRecent('notes', { id: n.id, label: n.text.slice(0, 50) }); return n;
}
export function setCapture(sourceId, text, extra = {}) { S.lastCapture = { text, sourceId, t: now(), ...extra }; }

function selectionBar(host, { getSel, onHighlight, onCite, onNote, onCopy, extra = [] }) {
  let bar = null;
  const hide = () => { bar?.remove(); bar = null; };
  const show = () => {
    const info = getSel(); if (!info) return hide();
    hide(); const r = info.range.getBoundingClientRect(); if (!r.width && !r.height) return;
    const btn = (ic, label, fn) => h('button.tb', { 'aria-label': label, title: label, onmousedown: (e) => e.preventDefault(), onclick: () => { fn(info); hide(); window.getSelection()?.removeAllRanges(); } }, typeof ic === 'string' ? icon(ic, 15) : ic);
    bar = h('div.bubble.reader-bar', { role: 'toolbar', 'aria-label': 'Selection actions' }, ...HL_COLORS.map((c) => h('button.tb.hl-pick', { 'aria-label': 'Highlight ' + c, title: 'Highlight (' + c + ')', onmousedown: (e) => e.preventDefault(), onclick: () => { onHighlight(info, c); hide(); window.getSelection()?.removeAllRanges(); } }, h('span.hl-sw.c-' + c))), h('span.tb-sep'), btn('book', 'Cite this passage', onCite), btn('note', 'Add note', onNote), btn('copy', 'Copy as quotation', onCopy), ...extra.map((x) => btn(x.icon, x.label, x.run)));
    document.body.append(bar); const w = bar.offsetWidth; bar.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px'; bar.style.top = Math.max(8, r.top - bar.offsetHeight - 8) + 'px';
  };
  host.addEventListener('mouseup', () => setTimeout(show, 10)); host.addEventListener('keyup', (e) => { if (e.shiftKey || e.key.startsWith('Arrow')) setTimeout(show, 10); });
  host.addEventListener('mousedown', hide); host.addEventListener('scroll', hide, true);
  return { hide };
}

// shared actions for cite / note from a captured passage
export async function citePassage(src, hl, form) {
  const note = hl.noteId ? S.notes.get(hl.noteId) : noteFromHighlight(hl);
  const { insertNoteIntoDraft } = await import('./notes.js'); bus.emit('focus-paper'); setTimeout(() => insertNoteIntoDraft(note.id, { form }), 60);
}
function chooseCiteForm(anchor, src, hl) {
  menu(anchor, [{ heading: 'Insert into paper' }, { label: 'Quotation in text, with citation', icon: 'quote', action: () => citePassage(src, hl, 'inline') }, { label: 'Block quotation, with citation', icon: 'quote', action: () => citePassage(src, hl, 'block') }, { label: 'Citation only (keeps the passage as evidence)', icon: 'book', action: () => citePassage(src, hl, 'cite') }]);
}

// ---- reader entry --------------------------------------------------------------
export async function openReaderView(host, src, opts = {}) {
  clear(host); host.classList.add('reader');
  const files = src._files || []; const f0 = files[0];
  host.dataset.source = src.id; pushRecent('sources', { id: src.id, label: shortCite(src) + ' · ' + src.title });
  if (!f0) {
    if (src.URL) return webLinkOnly(host, src);
    host.append(h('div.reader-empty', h('h2', src.title), h('p', 'This source has no file attached.'), h('p.muted', 'Metadata and notes are available in the source details. Add a PDF or a captured copy to read and highlight it here.'), h('button.btn', { onclick: async () => { const { fileDialog } = await import('./ui.js'); const [f] = await fileDialog({ accept: '.pdf,.html,.txt,.md,.docx' }); if (f) { const { importSourceFile } = await import('./library.js'); await importSourceFile(f, { attachTo: src.id }); bus.emit('open-reader', src.id); } } }, 'Attach a file')));
    return { destroy() {} };
  }
  if (f0.type === 'application/pdf') return pdfReader(host, src, f0, opts);
  if (f0.type === 'text/html') return htmlReader(host, src, f0, opts);
  const blob = await DB.getBlob(S.id, f0.id); const url = blob ? URL.createObjectURL(blob) : '';
  if (f0.type.startsWith('image/')) host.append(h('div.reader-media', h('img', { src: url, alt: src.title })));
  else if (f0.type.startsWith('video/')) host.append(h('div.reader-media', h('video', { src: url, controls: true })));
  else if (S.texts.get(src.id)) { const rows = S.texts.get(src.id)[0].split('\n').slice(0, 201).map((l) => l.split(/,|\t/)); host.append(h('div.reader-media.table-prev', h('p.muted', 'Preview of the first rows'), h('table', rows.map((r, i) => h('tr', r.map((c) => h(i ? 'td' : 'th', c))))))); }
  else host.append(h('div.reader-empty', h('p', 'This file type cannot be previewed here.'), h('a.btn', { href: url, download: f0.name }, 'Download ' + f0.name)));
  return { destroy() { if (url) URL.revokeObjectURL(url); } };
}
function webLinkOnly(host, src) {
  host.append(h('div.reader-empty', h('h2', src.title), h('p', 'No captured copy of this page is stored.'), h('p.muted', 'Web pages can be read inside the app when captured through the local server. You can still open the original.'), h('a.btn', { href: src.URL, target: '_blank', rel: 'noopener noreferrer' }, 'Open original page'))); return { destroy() {} };
}

// ---- PDF reader ----------------------------------------------------------------
const zoomMemo = new Map();
async function pdfReader(host, src, f0, opts) {
  const blob = await DB.getBlob(S.id, f0.id); if (!blob) { host.append(h('div.reader-empty', h('p', 'The stored file could not be found.'))); return { destroy() {} }; }
  const pdf = await loadPdf(await blob.arrayBuffer()); const N = pdf.numPages; let labels = null; try { labels = await pdf.getPageLabels(); } catch { /* */ }
  const offset = Number(src._pageOffset || 0); const labelOf = (i) => (labels ? labels[i - 1] : String(i + offset));
  let scale = zoomMemo.get(src.id) || 0; let cur = 1, destroyed = false;
  const scroll = h('div.pdf-scroll', { tabindex: '0', 'aria-label': 'Document pages' }); const thumbs = h('div.pdf-thumbs', { role: 'navigation', 'aria-label': 'Page thumbnails', hidden: true });
  const pageIn = h('input.input.sm.pg-in', { type: 'text', value: '1', 'aria-label': 'Page number', onkeydown: (e) => { if (e.key === 'Enter') goPage(parseInt(pageIn.value, 10) || 1); } });
  const q = h('input.input.sm', { type: 'search', placeholder: 'Search in document', 'aria-label': 'Search in document', onkeydown: (e) => { if (e.key === 'Enter') doSearch(e.shiftKey ? -1 : 1); } });
  const hits = h('span.muted.srch-c'); let color = 'yellow';
  const bar = h('div.reader-bar-top', h('button.icon-btn', { 'aria-label': 'Toggle thumbnails', title: 'Thumbnails', onclick: () => { thumbs.hidden = !thumbs.hidden; if (!thumbs.hidden) renderThumbs(); } }, icon('panelL', 16)), h('div.rb-title', { title: src.title }, shortCite(src)), h('span.grow'),
    h('button.icon-btn', { 'aria-label': 'Previous page', onclick: () => goPage(cur - 1) }, icon('up', 15)), pageIn, h('span.muted', ' / ' + N), h('button.icon-btn', { 'aria-label': 'Next page', onclick: () => goPage(cur + 1) }, icon('down', 15)), h('span.tb-sep'),
    h('button.icon-btn', { 'aria-label': 'Zoom out', onclick: () => setScale(scale / 1.15) }, icon('zoomOut', 15)), h('button.icon-btn', { 'aria-label': 'Zoom in', onclick: () => setScale(scale * 1.15) }, icon('zoomIn', 15)), h('button.btn.sm.ghost', { onclick: fit }, 'Fit width'), h('span.tb-sep'), q, hits,
    h('button.icon-btn', { 'aria-label': 'Next match', onclick: () => doSearch(1) }, icon('down', 14)));
  host.append(bar, h('div.pdf-body', thumbs, scroll));
  const pages = []; const first = await pdf.getPage(1); const v1 = first.getViewport({ scale: 1 });
  function fit() { setScale(Math.max(0.5, (scroll.clientWidth - 48) / v1.width)); }
  if (!scale) scale = Math.min(1.6, Math.max(0.6, (scroll.clientWidth || 700) / v1.width * 0.9)) || 1.1;
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) renderPage(+e.target.dataset.i); }), { root: scroll, rootMargin: '600px 0px' });
  function build() {
    clear(scroll); pages.length = 0;
    for (let i = 1; i <= N; i++) { const el = h('div.pdf-page', { 'data-i': i, style: { width: v1.width * scale + 'px', height: v1.height * scale + 'px' }, 'aria-label': 'Page ' + labelOf(i) }); pages.push({ el, rendered: false, scale: 0 }); scroll.append(el); io.observe(el); }
  }
  async function renderPage(i) {
    const P = pages[i - 1]; if (!P || destroyed || (P.rendered && P.scale === scale)) return; P.rendered = true; P.scale = scale; const page = await pdf.getPage(i); const vp = page.getViewport({ scale }); const el = P.el;
    el.style.width = vp.width + 'px'; el.style.height = vp.height + 'px'; el.style.setProperty('--scale-factor', scale); el.style.setProperty('--total-scale-factor', scale);
    clear(el); const dpr = window.devicePixelRatio || 1; const cv = h('canvas'); cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr); cv.style.width = vp.width + 'px'; cv.style.height = vp.height + 'px';
    const tl = h('div.textLayer'); const hlLayer = h('div.hl-layer'); el.append(cv, hlLayer, tl);
    try { await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') console.warn(e); }
    try { const t = new TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp }); await t.render(); } catch (e) { console.warn('textlayer', e); }
    drawHighlights(i); if (searchQ) markSearch(i);
  }
  function drawHighlights(i) {
    const P = pages[i - 1]; const layer = P?.el.querySelector('.hl-layer'); if (!layer) return; clear(layer);
    [...S.P.highlights.values()].filter((x) => x.sourceId === src.id && x.pageIndex === i).forEach((hl) => (hl.rects || []).forEach((r, k) => layer.append(h('div.hl.c-' + hl.color + (hl.id === flashId ? '.flash' : ''), { 'data-hl': hl.id, title: hl.comment || '', style: { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' }, onclick: (e) => { e.stopPropagation(); hlPopover(hl, e.currentTarget); } }))));
  }
  let flashId = null;
  function hlPopover(hl, anchor) {
    const ta = h('textarea.input', { rows: 3, placeholder: 'Annotation', value: hl.comment || '', 'aria-label': 'Annotation', oninput: (e) => { hl.comment = e.target.value; putItem('highlight', hl); } });
    const cols = h('div.row', HL_COLORS.map((c) => h('button.hl-pick', { 'aria-label': c, onclick: () => { hl.color = c; putItem('highlight', hl); drawHighlights(hl.pageIndex); } }, h('span.hl-sw.c-' + c))));
    const pop = popover(anchor, h('div.hl-pop', h('p.hl-q', '“' + hl.text.slice(0, 220) + (hl.text.length > 220 ? '…' : '') + '”'), h('div.muted', `${shortCite(src)} · p. ${hl.page}`), ta, cols, h('div.pop-actions', h('button.btn.sm', { onclick: () => { pop.close(); chooseCiteForm(anchor, src, hl); } }, 'Cite'), h('button.btn.sm', { onclick: () => { pop.close(); if (!hl.noteId) noteFromHighlight(hl); bus.emit('open-note', hl.noteId); } }, hl.noteId ? 'Open note' : 'Make note'), h('span.grow'), h('button.btn.sm', { onclick: () => { pop.close(); removeItem('highlight', hl.id); drawHighlights(hl.pageIndex); } }, 'Delete'))), { className: 'wide', label: 'Highlight' });
  }
  function getSel() {
    const s = window.getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return null; const range = s.getRangeAt(0); const pg = (range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer)?.closest?.('.pdf-page'); if (!pg || !scroll.contains(pg)) return null;
    const text = norm(s.toString()); if (text.length < 2) return null; return { range, pg, text };
  }
  const infoOf = (sel) => {
    const i = +sel.pg.dataset.i; const pr = sel.pg.getBoundingClientRect(); const rects = [...sel.range.getClientRects()].filter((r) => r.width > 1 && r.height > 1).map((r) => ({ x: (r.left - pr.left) / pr.width, y: (r.top - pr.top) / pr.height, w: r.width / pr.width, h: r.height / pr.height }));
    const merged = []; rects.forEach((r) => { const l = merged[merged.length - 1]; if (l && Math.abs(l.y - r.y) < 0.004 && Math.abs(l.h - r.h) < 0.01 && r.x <= l.x + l.w + 0.01) { l.w = Math.max(l.x + l.w, r.x + r.w) - l.x; } else merged.push({ ...r }); });
    const full = S.texts.get(src.id)?.[i - 1] || ''; const flat = norm(full); const at = flat.indexOf(sel.text); const prefix = at >= 0 ? flat.slice(Math.max(0, at - 120), at) : ''; const suffix = at >= 0 ? flat.slice(at + sel.text.length, at + sel.text.length + 120) : '';
    return { page: labelOf(i), pageIndex: i, rects: merged.map((r) => ({ ...r, h: r.h })).map(({ x, y, w, h: hh }) => ({ x, y, w, h: hh })), text: sel.text, prefix, suffix };
  };
  const mkHL = (sel, c) => createHighlight(src, { ...infoOf(sel), color: c, kind: 'pdf' });
  selectionBar(scroll, {
    getSel,
    onHighlight: (sel, c) => { const hl = mkHL(sel, c); drawHighlights(hl.pageIndex); },
    onCite: (sel) => { const hl = mkHL(sel, 'yellow'); drawHighlights(hl.pageIndex); chooseCiteForm(sel.range.getBoundingClientRect(), src, hl); },
    onNote: (sel) => { const hl = mkHL(sel, 'yellow'); drawHighlights(hl.pageIndex); const n = noteFromHighlight(hl); bus.emit('open-note', n.id); },
    onCopy: (sel) => { const i = infoOf(sel); navigator.clipboard?.writeText(i.text).catch(() => {}); setCapture(src.id, i.text, { page: i.page }); toast('Copied with its source. Pasting into the paper will ask how to use it.'); },
    extra: [{ icon: 'dict', label: 'Define', run: (sel) => bus.emit('define', sel.text) }, { icon: 'globe', label: 'Search Wikipedia', run: (sel) => bus.emit('wiki-search', sel.text) }],
  });
  scroll.addEventListener('copy', () => { const sel = getSel(); if (sel) setCapture(src.id, sel.text, { page: labelOf(+sel.pg.dataset.i) }); });
  // page tracking
  let tick; scroll.addEventListener('scroll', () => { cancelAnimationFrame(tick); tick = requestAnimationFrame(() => { const mid = scroll.scrollTop + scroll.clientHeight / 3; let best = 1; for (let i = 0; i < pages.length; i++) { if (pages[i].el.offsetTop <= mid) best = i + 1; else break; } if (best !== cur) { cur = best; pageIn.value = labelOf(cur); updateThumbSel(); } }); });
  function goPage(n, y) { n = Math.max(1, Math.min(N, n)); const el = pages[n - 1].el; scroll.scrollTo({ top: el.offsetTop - 8 + (y ? y * el.offsetHeight - 80 : 0), behavior: 'auto' }); cur = n; pageIn.value = labelOf(n); renderPage(n); updateThumbSel(); }
  function setScale(s) { s = Math.max(0.4, Math.min(4, s)); const frac = scroll.scrollTop / (scroll.scrollHeight || 1); scale = s; zoomMemo.set(src.id, s); build(); scroll.scrollTop = frac * scroll.scrollHeight; }
  // thumbnails
  let thumbIO; function renderThumbs() {
    if (thumbs.childElementCount) return; thumbIO = new IntersectionObserver(async (es) => { for (const e of es) if (e.isIntersecting && !e.target.dataset.done) { e.target.dataset.done = 1; const i = +e.target.dataset.i; const pg = await pdf.getPage(i); const vp = pg.getViewport({ scale: 110 / v1.width }); const cv = e.target.querySelector('canvas'); cv.width = vp.width; cv.height = vp.height; await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise; } }, { root: thumbs, rootMargin: '300px' });
    for (let i = 1; i <= N; i++) { const t = h('button.thumb', { 'data-i': i, 'aria-label': 'Go to page ' + labelOf(i), onclick: () => goPage(i) }, h('canvas', { width: 110, height: Math.round(110 * v1.height / v1.width) }), h('span', labelOf(i))); thumbs.append(t); thumbIO.observe(t); } updateThumbSel();
  }
  const updateThumbSel = () => $$('.thumb', thumbs).forEach((t) => t.classList.toggle('on', +t.dataset.i === cur));
  // search
  let searchQ = '', matches = [], mi = -1;
  async function ensureText() { let t = S.texts.get(src.id); if (!t) { const { extractAll } = await import('./pdfdoc.js'); t = await extractAll(pdf); S.texts.set(src.id, t); DB.saveText(S.id, src.id, t); } return t; }
  async function doSearch(dir) {
    const query = q.value.trim(); if (!query) { searchQ = ''; matches = []; hits.textContent = ''; $$('.srch-hit', scroll).forEach((e) => e.remove()); return; }
    if (query !== searchQ) { searchQ = query; matches = []; mi = -1; const T = await ensureText(); const nq = norm(query).toLowerCase(); T.forEach((t, i) => { const low = norm(t).toLowerCase(); let k = 0; while ((k = low.indexOf(nq, k)) >= 0) { matches.push({ page: i + 1, k }); k += nq.length; } }); $$('.srch-hit', scroll).forEach((e) => e.remove()); pages.forEach((p, i) => p.rendered && markSearch(i + 1)); }
    if (!matches.length) { hits.textContent = 'No matches'; return; } mi = (mi + dir + matches.length) % matches.length; hits.textContent = `${mi + 1} of ${matches.length}`;
    const m = matches[mi]; goPage(m.page); await renderPage(m.page); markSearch(m.page, true);
  }
  function markSearch(i, focus) {
    const P = pages[i - 1]; const tl = P?.el.querySelector('.textLayer'); const layer = P?.el.querySelector('.hl-layer'); if (!tl || !layer || !searchQ) return; $$('.srch-hit', layer).forEach((e) => e.remove());
    const nodes = []; const chars = []; const w = document.createTreeWalker(tl, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { for (let k = 0; k < n.data.length; k++) if (!/\s/.test(n.data[k])) { chars.push(n.data[k].toLowerCase()); nodes.push([n, k]); } }
    const needle = searchQ.toLowerCase().replace(/\s+/g, ''); const hay = chars.join(''); const pr = P.el.getBoundingClientRect(); let k = 0, count = 0; const occ = pages.slice(0, i - 1).reduce((a) => a, 0);
    while ((k = hay.indexOf(needle, k)) >= 0 && count < 200) { const a = nodes[k], b = nodes[k + needle.length - 1]; const r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(b[0], b[1] + 1); [...r.getClientRects()].forEach((cr) => layer.append(h('div.srch-hit' + (focus && count === 0 ? '.cur' : ''), { style: { left: (cr.left - pr.left) / pr.width * 100 + '%', top: (cr.top - pr.top) / pr.height * 100 + '%', width: cr.width / pr.width * 100 + '%', height: cr.height / pr.height * 100 + '%' } }))); k += needle.length; count++; }
  }
  build(); await renderPage(1);
  if (opts.page) goPage(opts.page);
  const api = {
    destroy() { destroyed = true; io.disconnect(); thumbIO?.disconnect(); pdf.destroy(); },
    goToHighlight(id) { const hl = S.P.highlights.get(id); if (!hl) return; flashId = id; goPage(hl.pageIndex, hl.rects?.[0]?.y); renderPage(hl.pageIndex).then(() => { drawHighlights(hl.pageIndex); setTimeout(() => { flashId = null; drawHighlights(hl.pageIndex); }, 2000); }); },
    goToPage: (n) => goPage(n), search(t) { q.value = t; doSearch(1); },
  };
  if (opts.highlight) setTimeout(() => api.goToHighlight(opts.highlight), 200);
  bus.on('highlights', () => pages.forEach((p, i) => p.rendered && drawHighlights(i + 1)));
  return api;
}

// ---- HTML (captured web page / text) reader ------------------------------------
function textIndex(root) {
  const chars = [], map = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n, prevSpace = true;
  while ((n = w.nextNode())) { for (let k = 0; k < n.data.length; k++) { const c = n.data[k]; if (/\s/.test(c)) { if (prevSpace) continue; chars.push(' '); prevSpace = true; } else { chars.push(c); prevSpace = false; } map.push([n, k]); } }
  return { text: chars.join(''), map };
}
function wrapRange(range, hl) {
  const nodes = []; const w = document.createTreeWalker(range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) if (range.intersectsNode(n)) nodes.push(n);
  nodes.forEach((t) => { let a = 0, b = t.data.length; if (t === range.startContainer) a = range.startOffset; if (t === range.endContainer) b = range.endOffset; if (b <= a || !t.data.slice(a, b).trim()) return; const mid = t.splitText(a); mid.splitText(b - a); const m = h('mark.hl.c-' + hl.color, { 'data-hl': hl.id, title: hl.comment || '' }); mid.parentNode.replaceChild(m, mid); m.append(mid); });
}
async function htmlReader(host, src, f0, opts) {
  const blob = await DB.getBlob(S.id, f0.id); const html = blob ? await blob.text() : '<p>Missing file.</p>';
  const body = h('div.web-body', { html: sanitizeHTML(html, src.URL || location.href) });
  const q = h('input.input.sm', { type: 'search', placeholder: 'Search in page', 'aria-label': 'Search in page', onkeydown: (e) => { if (e.key === 'Enter') find(e.shiftKey ? -1 : 1); } });
  const scroll = h('div.web-scroll', { tabindex: '0' }, body);
  const bar = h('div.reader-bar-top', h('div.rb-title', { title: src.title }, shortCite(src) + ' · captured copy'), h('span.grow'), q, h('button.icon-btn', { 'aria-label': 'Next match', onclick: () => find(1) }, icon('down', 14)), src.URL && h('a.btn.sm.ghost', { href: src.URL, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 13), 'Original'));
  host.append(bar, scroll);
  function paintAll() {
    $$('mark.hl', body).forEach((m) => { const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); p.normalize(); });
    const idx = textIndex(body);
    [...S.P.highlights.values()].filter((x) => x.sourceId === src.id && x.kind === 'web').sort((a, b) => 0).forEach((hl) => {
      const t = norm(hl.text); let at = -1, k = -1; const cands = []; while ((k = idx.text.indexOf(t, k + 1)) >= 0) cands.push(k);
      if (!cands.length) return; at = cands[0]; if (cands.length > 1 && hl.prefix) { const p = norm(hl.prefix).slice(-30); const best = cands.find((c) => idx.text.slice(Math.max(0, c - p.length), c) === p); if (best != null) at = best; }
      const a = idx.map[at], b = idx.map[at + t.length - 1]; if (!a || !b) return; const r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(b[0], b[1] + 1); wrapRange(r, hl);
    });
  }
  const blockOf = (node) => (node.nodeType === 3 ? node.parentElement : node).closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,figcaption');
  function getSel() { const s = window.getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return null; const range = s.getRangeAt(0); if (!body.contains(range.commonAncestorContainer)) return null; const text = norm(s.toString()); if (text.length < 2) return null; return { range, text }; }
  const infoOf = (sel) => {
    const blk = blockOf(sel.range.startContainer); const blocks = $$('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,figcaption', body); const para = blk ? blocks.indexOf(blk) + 1 : undefined; const idx = textIndex(body); const at = idx.text.indexOf(sel.text);
    let page = ''; let e = blk; while (e && e !== body) { if (e.getAttribute?.('data-page')) { page = e.getAttribute('data-page'); break; } e = e.parentElement; } if (!page) { const prev = blocks.slice(0, Math.max(0, para)).reverse().find((x) => x.getAttribute('data-page')); page = prev?.getAttribute('data-page') || ''; }
    return { page, text: sel.text, prefix: at > 0 ? idx.text.slice(Math.max(0, at - 80), at) : '', suffix: at >= 0 ? idx.text.slice(at + sel.text.length, at + sel.text.length + 80) : '', para, kind: 'web', color: 'yellow' };
  };
  const mk = (sel, c) => { const hl = createHighlight(src, { ...infoOf(sel), color: c, kind: 'web' }); paintAll(); return hl; };
  selectionBar(scroll, {
    getSel, onHighlight: (sel, c) => mk(sel, c), onCite: (sel) => { const hl = mk(sel, 'yellow'); chooseCiteForm(sel.range.getBoundingClientRect(), src, hl); },
    onNote: (sel) => { const hl = mk(sel, 'yellow'); const n = noteFromHighlight(hl); bus.emit('open-note', n.id); },
    onCopy: (sel) => { const i = infoOf(sel); navigator.clipboard?.writeText(i.text).catch(() => {}); setCapture(src.id, i.text, { page: i.page, para: i.para }); toast('Copied with its source. Pasting into the paper will ask how to use it.'); },
    extra: [{ icon: 'dict', label: 'Define', run: (sel) => bus.emit('define', sel.text) }, { icon: 'globe', label: 'Search Wikipedia', run: (sel) => bus.emit('wiki-search', sel.text) }],
  });
  scroll.addEventListener('copy', () => { const sel = getSel(); if (sel) { const i = infoOf(sel); setCapture(src.id, sel.text, { page: i.page, para: i.para }); } });
  body.addEventListener('click', (e) => { const m = e.target.closest?.('mark.hl'); if (!m) return; const hl = S.P.highlights.get(m.dataset.hl); if (!hl) return; const ta = h('textarea.input', { rows: 3, placeholder: 'Annotation', value: hl.comment || '', oninput: (ev) => { hl.comment = ev.target.value; putItem('highlight', hl); } }); const pop = popover(m, h('div.hl-pop', h('p.hl-q', '“' + hl.text.slice(0, 220) + '”'), h('div.muted', `${shortCite(src)}${hl.page ? ' · p. ' + hl.page : hl.para ? ' · ¶ ' + hl.para : ''}`), ta, h('div.row', HL_COLORS.map((c) => h('button.hl-pick', { 'aria-label': c, onclick: () => { hl.color = c; putItem('highlight', hl); paintAll(); } }, h('span.hl-sw.c-' + c)))), h('div.pop-actions', h('button.btn.sm', { onclick: () => { pop.close(); chooseCiteForm(m, src, hl); } }, 'Cite'), h('button.btn.sm', { onclick: () => { pop.close(); if (!hl.noteId) noteFromHighlight(hl); bus.emit('open-note', hl.noteId); } }, hl.noteId ? 'Open note' : 'Make note'), h('span.grow'), h('button.btn.sm', { onclick: () => { pop.close(); removeItem('highlight', hl.id); paintAll(); } }, 'Delete'))), { className: 'wide' }); });
  let fi = -1, fq = '';
  function find(dir) { const t = q.value.trim(); if (!t) return; const idx = textIndex(body); const low = idx.text.toLowerCase(), nq = norm(t).toLowerCase(); const all = []; let k = -1; while ((k = low.indexOf(nq, k + 1)) >= 0) all.push(k); if (!all.length) { toast('No matches'); return; } if (t !== fq) { fq = t; fi = -1; } fi = (fi + dir + all.length) % all.length; const a = idx.map[all[fi]], b = idx.map[all[fi] + nq.length - 1]; const r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(b[0], b[1] + 1); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); (a[0].parentElement).scrollIntoView({ block: 'center' }); }
  paintAll();
  const api = { destroy() {}, goToHighlight(id) { const m = $(`mark[data-hl="${id}"]`, body); if (m) { m.scrollIntoView({ block: 'center' }); m.classList.add('flash'); setTimeout(() => m.classList.remove('flash'), 1800); } }, search(t) { q.value = t; find(1); } };
  bus.on('highlights', paintAll);
  if (opts.highlight) setTimeout(() => api.goToHighlight(opts.highlight), 100);
  return api;
}
