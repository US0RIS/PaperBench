// Research library: sidebar list, add/edit source dialogs, file import, source detail.
import { S, addSource, updateSource, deleteSource, putItem, removeItem, mergeSources, pushRecent, refreshDerivedSoon } from './state.js';
import * as DB from './db.js';
import { h, icon, clear, dialog, confirmDialog, menu, popover, toast, field, segmented, fileDialog, bus, $, ago, promptDialog } from './ui.js';
import { SOURCE_TYPES, typeLabel, KIND_LABEL, KIND_HINT, kindOf, namesToString, namesDisplay, parseNames, parseDate, dateToString, yearOf, shortCite, checkMetadata, duplicateOf, findDuplicateGroups, uid, now, todayDate, newSource, normDOI, NOTE_KINDS, escapeHtml } from './model.js';
import { formatReference, bibInner } from './csl.js';
import { lookupDOI, lookupISBN, captureURL, candidateToSource, ApiError, readableHTML, http } from './research.js';

const FILTERS = { all: 'All sources', fav: 'Favorites', cited: 'Cited in paper', uncited: 'Not yet cited', issues: 'Needs attention' };
export const libState = { q: '', filter: 'all', sort: 'recent' };

export function citeCounts() { const m = new Map(); (S.derived?.A.citations || []).forEach((c) => c.items.forEach((i) => m.set(i.sourceId, (m.get(i.sourceId) || 0) + 1))); return m; }

export function renderLibrary(root) {
  clear(root);
  const counts = citeCounts();
  const cols = [...S.P.collections.values()];
  const q = h('input.input.search', { type: 'search', placeholder: 'Filter sources', 'aria-label': 'Filter sources', value: libState.q, oninput: (e) => { libState.q = e.target.value; renderList(); } });
  const label = () => (libState.filter.startsWith('col:') ? S.P.collections.get(libState.filter.slice(4))?.name : libState.filter.startsWith('tag:') ? '#' + libState.filter.slice(4) : FILTERS[libState.filter]) || 'All sources';
  const fbtn = h('button.btn.sm.ghost', { 'aria-haspopup': 'menu', onclick: () => {
    const tags = [...new Set([...S.sources.values()].flatMap((s) => s._tags || []))].sort();
    menu(fbtn, [...Object.entries(FILTERS).map(([k, l]) => ({ label: l, checked: libState.filter === k, action: () => { libState.filter = k; renderLibrary(root); } })), { divider: true }, { heading: 'Collections' },
      ...cols.map((c) => ({ label: c.name, icon: 'folder', checked: libState.filter === 'col:' + c.id, action: () => { libState.filter = 'col:' + c.id; renderLibrary(root); } })),
      { label: 'New collection…', icon: 'plus', action: async () => { const n = await promptDialog('New collection', 'Name'); if (n?.trim()) { const c = putItem('collection', { id: uid('col'), name: n.trim() }); libState.filter = 'col:' + c.id; renderLibrary(root); } } },
      tags.length && { divider: true }, tags.length && { heading: 'Tags' }, ...tags.map((t) => ({ label: '#' + t, checked: libState.filter === 'tag:' + t, action: () => { libState.filter = 'tag:' + t; renderLibrary(root); } })),
      { divider: true }, { label: 'Find duplicates', icon: 'copy', action: () => showDuplicates() }]);
  } }, icon('filter', 13), label(), icon('down', 12));
  const list = h('div.src-list', { role: 'list' });
  const head = h('div.side-tools', q, h('div.row', fbtn, h('span.grow'), h('button.icon-btn', { 'aria-label': 'Add source', title: 'Add source', onclick: () => addSourceDialog() }, icon('plus')), h('button.icon-btn', { 'aria-label': 'Import files, BibTeX, RIS', title: 'Import files', onclick: () => importFlow() }, icon('fileUp'))));
  root.append(head, list);
  function renderList() {
    clear(list); const words = libState.q.toLowerCase().split(/\s+/).filter(Boolean); const f = libState.filter;
    let arr = [...S.sources.values()].filter((s) => {
      if (f === 'fav' && !s._fav) return false; if (f === 'cited' && !counts.has(s.id)) return false; if (f === 'uncited' && counts.has(s.id)) return false;
      if (f === 'issues' && !checkMetadata(s).some((x) => x.sev === 'error')) return false;
      if (f.startsWith('col:') && !(s._collections || []).includes(f.slice(4))) return false; if (f.startsWith('tag:') && !(s._tags || []).includes(f.slice(4))) return false;
      const hay = `${s.title} ${namesDisplay(s.author)} ${yearOf(s)} ${(s._tags || []).join(' ')} ${s['container-title'] || ''} ${s.DOI || ''}`.toLowerCase(); return words.every((w) => hay.includes(w));
    }).sort((a, b) => b._fav - a._fav || b._added - a._added);
    if (!arr.length) list.append(h('div.empty-s', S.sources.size ? 'No sources match.' : h('span', 'No sources yet.', h('br'), 'Add a DOI, ISBN, URL or file, or search the literature in the research panel.'), !S.sources.size && h('div', h('button.btn.sm', { onclick: () => addSourceDialog() }, 'Add a source'))));
    arr.forEach((s) => {
      const issues = checkMetadata(s).filter((x) => x.sev === 'error'); const n = counts.get(s.id);
      const row = h('div.src-row', { role: 'listitem', draggable: 'true', tabindex: '0', 'data-id': s.id, ondragstart: (e) => { e.dataTransfer.setData('application/x-source', s.id); e.dataTransfer.setData('text/plain', shortCite(s)); }, onclick: () => bus.emit('open-source-detail', s.id), ondblclick: () => bus.emit('open-reader', s.id), onkeydown: (e) => { if (e.key === 'Enter') bus.emit('open-source-detail', s.id); if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); sourceMenu(row, s); } }, oncontextmenu: (e) => { e.preventDefault(); sourceMenu({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }, s); } },
        h('div.sr-main', h('div.sr-t', s.title || 'Untitled'), h('div.sr-m', [shortCite(s), kindOf(s) !== 'journal' ? KIND_LABEL[kindOf(s)] : null, n ? `cited ${n}×` : null].filter(Boolean).join(' · '))),
        h('div.sr-side', issues.length ? h('span.dot.warn', { title: issues.map((i) => i.msg).join('; ') }) : null, h('button.icon-btn.sm.star' + (s._fav ? '.on' : ''), { 'aria-label': s._fav ? 'Remove from favorites' : 'Add to favorites', 'aria-pressed': String(!!s._fav), onclick: (e) => { e.stopPropagation(); updateSource(s.id, { _fav: !s._fav }); } }, icon('star', 14))));
      list.append(row);
    });
  }
  renderList();
}

export function sourceMenu(anchor, s) {
  menu(anchor, [
    { label: 'Open reader', icon: 'book', action: () => bus.emit('open-reader', s.id) }, { label: 'Cite in paper', icon: 'link', action: () => bus.emit('cite-source', s.id) }, { label: 'Details', icon: 'info', action: () => bus.emit('open-source-detail', s.id) }, { divider: true },
    { label: 'Edit metadata…', icon: 'pencil', action: () => editSourceDialog(s.id) }, { label: s._fav ? 'Remove favorite' : 'Favorite', icon: 'star', action: () => updateSource(s.id, { _fav: !s._fav }) },
    { label: 'Include in bibliography even if uncited', checked: !!s._forceBib, action: () => updateSource(s.id, { _forceBib: !s._forceBib }) }, { divider: true },
    { label: 'Delete source…', icon: 'trash', action: () => deleteSourceFlow(s.id) }]);
}
export async function deleteSourceFlow(id) {
  const s = S.sources.get(id); const n = citeCounts().get(id) || 0;
  const ok = await confirmDialog('Delete this source?', `“${s.title}” will be removed from the library along with its highlights${n ? `. It is cited ${n} time${n > 1 ? 's' : ''} in the paper; those citations will be flagged as missing` : ''}. Notes you wrote stay in your notes. This cannot be undone.`, { ok: 'Delete source', danger: true });
  if (ok) { await deleteSource(id); toast('Source deleted'); }
}
function showDuplicates() {
  const groups = findDuplicateGroups(S.sources);
  const body = h('div.dups', !groups.length ? h('p', 'No likely duplicates found.') : groups.map((g) => h('div.dup-g', g.map((s) => h('div.dup-r', h('div', h('b', shortCite(s)), ' ', s.title, h('div.muted', [s.DOI, s.ISBN, s.URL].filter(Boolean).join(' · ')), h('div.muted', `${citeCounts().get(s.id) || 0} citations`)), h('button.btn.sm', { onclick: async () => { const keep = g.find((x) => x.id !== s.id); if (await confirmDialog('Merge sources?', `Keep “${keep.title}”, fold “${s.title}” into it (citations and notes are repointed).`, { ok: 'Merge' })) { mergeSources(keep.id, s.id); dlg.close(); toast('Merged'); } } }, 'Merge into other'))))));
  const dlg = dialog({ title: 'Possible duplicates', body, width: 560 });
}

// ---- source form --------------------------------------------------------------
const FIELD_SETS = {
  'article-journal': ['container-title:Journal', 'volume', 'issue', 'page:Pages', 'DOI', 'URL'], article: ['container-title:Repository or series', 'number:Identifier', 'DOI', 'URL'], book: ['publisher', 'publisher-place:Place', 'edition', 'ISBN', 'number-of-pages:Pages', 'DOI', 'URL'],
  chapter: ['container-title:Book title', 'editor:Editors', 'publisher', 'publisher-place:Place', 'edition', 'page:Pages', 'ISBN', 'DOI', 'URL'], 'paper-conference': ['container-title:Proceedings', 'publisher', 'page:Pages', 'DOI', 'URL'], thesis: ['publisher:University', 'genre:Thesis type', 'URL'], report: ['publisher:Institution', 'number:Report number', 'URL', 'DOI'],
  webpage: ['container-title:Website', 'publisher', 'URL'], 'entry-encyclopedia': ['container-title:Encyclopedia', 'publisher', 'edition', 'URL'], 'article-newspaper': ['container-title:Newspaper', 'page:Pages', 'URL'], 'article-magazine': ['container-title:Magazine', 'volume', 'issue', 'page:Pages', 'URL'],
  dataset: ['publisher:Repository / publisher', 'version', 'DOI', 'URL'], graphic: ['publisher', 'medium', 'URL'], motion_picture: ['publisher:Platform / studio', 'medium:Format', 'URL'], document: ['publisher', 'URL'], 'post-weblog': ['container-title:Blog', 'URL'],
};
const cap = (k) => ({ DOI: 'DOI', URL: 'URL', ISBN: 'ISBN', 'container-title': 'Container title', 'publisher-place': 'Place', page: 'Pages' }[k] || k.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
export function sourceForm(src, { onChange } = {}) {
  const root = h('div.src-form'); const draft = JSON.parse(JSON.stringify(src));
  const render = () => {
    clear(root); const inputs = {};
    const set = (k, v) => { if (v === '' || v == null) delete draft[k]; else draft[k] = v; onChange?.(draft); };
    const typeSel = h('select.input', { 'aria-label': 'Source type', onchange: (e) => { draft.type = e.target.value; render(); onChange?.(draft); } }, SOURCE_TYPES.map(([v, l]) => h('option', { value: v, selected: draft.type === v }, l)));
    root.append(field('Type', typeSel), field('Title', h('input.input', { value: draft.title || '', oninput: (e) => set('title', e.target.value), autofocus: !draft.title })),
      field('Authors', h('textarea.input', { rows: 2, value: namesToString(draft.author), placeholder: 'Family, Given; Family, Given', oninput: (e) => { draft.author = parseNames(e.target.value); onChange?.(draft); } }), 'Separate authors with semicolons. For an organization, enter its name alone.'),
      h('div.f2', field('Date', h('input.input', { value: dateToString(draft.issued), placeholder: 'YYYY or YYYY-MM-DD', oninput: (e) => { const d = parseDate(e.target.value); if (d) draft.issued = d; else delete draft.issued; onChange?.(draft); } })), field('Accessed', h('input.input', { value: dateToString(draft.accessed), placeholder: 'YYYY-MM-DD', oninput: (e) => { const d = parseDate(e.target.value); if (d) draft.accessed = d; else delete draft.accessed; onChange?.(draft); } }))));
    const fs = (FIELD_SETS[draft.type] || FIELD_SETS.document).map((f) => f.split(':'));
    const grid = h('div.f2');
    fs.forEach(([k, l]) => {
      if (k === 'editor') { grid.append(field(l || 'Editors', h('input.input', { value: namesToString(draft.editor), oninput: (e) => { draft.editor = parseNames(e.target.value); if (!draft.editor.length) delete draft.editor; onChange?.(draft); } }))); return; }
      const inp = h('input.input', { value: draft[k] || '', oninput: (e) => set(k, e.target.value.trim()) }); inputs[k] = inp;
      let extra = null;
      if (k === 'DOI') extra = h('button.btn.sm', { type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const c = await lookupDOI(inp.value); fillEmpty(draft, c.src); render(); onChange?.(draft); toast('Filled empty fields from Crossref'); } catch (er) { toast(er.message, { kind: 'err' }); } b.disabled = false; } }, 'Look up');
      if (k === 'ISBN') extra = h('button.btn.sm', { type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const c = await lookupISBN(inp.value); fillEmpty(draft, c.src); render(); onChange?.(draft); toast('Filled empty fields from book metadata'); } catch (er) { toast(er.message, { kind: 'err' }); } b.disabled = false; } }, 'Look up');
      grid.append(field(l || cap(k), extra ? h('div.inp-btn', inp, extra) : inp));
    });
    root.append(grid, field('Abstract', h('textarea.input', { rows: 4, value: draft.abstract || '', oninput: (e) => set('abstract', e.target.value) })),
      h('div.f2', field('Role', h('select.input', { onchange: (e) => { draft._role = e.target.value; onChange?.(draft); } }, [['', 'Not set'], ['primary', 'Primary source'], ['secondary', 'Secondary source'], ['background', 'Background']].map(([v, l]) => h('option', { value: v, selected: (draft._role || '') === v }, l)))), field('Tags', h('input.input', { value: (draft._tags || []).join(', '), placeholder: 'comma, separated', oninput: (e) => { draft._tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean); onChange?.(draft); } }))));
  };
  render(); root.value = () => draft; return root;
}
function fillEmpty(draft, from) { for (const k in from) if (k[0] !== '_' && (draft[k] == null || draft[k] === '' || (Array.isArray(draft[k]) && !draft[k].length))) draft[k] = from[k]; }

export function editSourceDialog(id) {
  const s = S.sources.get(id); if (!s) return; const form = sourceForm(s);
  dialog({ title: 'Edit source', body: form, width: 640, actions: [{ label: 'Cancel', value: false }, { label: 'Save', primary: true, onClick: () => { const d = form.value(); const keep = {}; for (const k in s) if (k[0] === '_') keep[k] = s[k]; for (const k in s) if (k[0] !== '_') delete s[k]; Object.assign(s, d); putItem('source', s); refreshDerivedSoon(); bus.emit('open-source-detail', id); } }] });
}

// ---- add source --------------------------------------------------------------
const DOI_RE = /10\.\d{4,9}\/[^\s"<>]+/i, ISBN_RE = /^(?:ISBN[:\s-]*)?((?:97[89][-\s]?)?\d[-\s]?\d{2,5}[-\s]?\d{2,7}[-\s]?\d{1,7}[-\s]?[\dXx])$/, ARXIV_RE = /(?:arxiv[:\s.org/abs]*)?(\d{4}\.\d{4,5})(?:v\d+)?/i;
export function detectIdentifier(t) {
  t = t.trim(); if (!t) return null;
  if (/^https?:\/\//i.test(t)) { const d = t.match(/doi\.org\/(10\.\S+)/i); if (d) return { kind: 'doi', value: decodeURIComponent(d[1]) }; const a = t.match(/arxiv\.org\/(?:abs|pdf)\/([\w./-]+?)(?:v\d+)?(?:\.pdf)?$/i); if (a) return { kind: 'arxiv', value: a[1] }; return { kind: 'url', value: t }; }
  if (DOI_RE.test(t) && /^(doi:?\s*)?10\./i.test(t)) return { kind: 'doi', value: t.replace(/^doi:?\s*/i, '') };
  const isbn = t.match(ISBN_RE); if (isbn && /^(?:ISBN[:\s-]*)?[\d-\sXx]+$/.test(t) && [10, 13].includes(t.replace(/[^0-9Xx]/g, '').length)) return { kind: 'isbn', value: t.replace(/[^0-9Xx]/g, '') };
  const ax = t.match(/^(?:arxiv:?\s*)?(\d{4}\.\d{4,5})(?:v\d+)?$/i); if (ax) return { kind: 'arxiv', value: ax[1] };
  if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return { kind: 'url', value: t };
  return { kind: 'query', value: t };
}
export async function resolveIdentifier(id, o) {
  if (id.kind === 'doi') return { candidate: await lookupDOI(id.value, o) };
  if (id.kind === 'isbn') return { candidate: await lookupISBN(id.value, o) };
  if (id.kind === 'arxiv') { const { PROVIDERS } = await import('./research.js'); const ax = PROVIDERS.find((p) => p.id === 'arxiv'); const r = await ax.search('id:' + id.value, o); const c = r.find((x) => x.src.number === id.value) || r[0]; if (!c) throw new ApiError('arXiv id not found'); return { candidate: c }; }
  if (id.kind === 'url') return captureURL(id.value, o);
  return null;
}
export async function saveResolved(res, { open = false } = {}) {
  const src = candidateToSource(res.candidate); const r = addSource(src, { quiet: true });
  if (r.duplicate) { toast(`Already in your library (${r.reason.toLowerCase()})`, { action: 'Show', onAction: () => bus.emit('open-source-detail', r.source.id) }); return r.source; }
  const s = r.source;
  if (res.html) { const id = uid('file'); await DB.saveBlob(S.id, id, new Blob([res.html], { type: 'text/html' }), 'Reader view'); s._files = [{ id, name: 'Reader view (captured ' + new Date().toLocaleDateString() + ')', type: 'text/html' }]; s._readable = true; putItem('source', s); const { htmlToPages } = await import('./reader.js'); const pages = htmlToPages(res.html); await DB.saveText(S.id, s.id, pages); S.texts.set(s.id, pages); }
  toast('Saved to library', { action: 'Open', onAction: () => bus.emit('open-source-detail', s.id) }); if (open) bus.emit('open-reader', s.id);
  return s;
}
export function addSourceDialog({ initial = '', then } = {}) {
  let result = null, busy = false; const status = h('div.add-status', { 'aria-live': 'polite' }); const out = h('div.add-out');
  const input = h('textarea.input', { rows: 2, placeholder: 'Paste a DOI, ISBN, URL or arXiv id', 'aria-label': 'Identifier or URL', value: initial, autofocus: true });
  const go = async () => {
    if (busy) return; const id = detectIdentifier(input.value.split('\n')[0]); if (!id) return; if (id.kind === 'query') { dlg.close(); bus.emit('research-search', id.value); return; }
    busy = true; clear(out); status.textContent = 'Looking up…';
    try { result = await resolveIdentifier(id); status.textContent = result.limited || ''; showCandidate(); } catch (e) { status.textContent = ''; out.append(h('p.err', e.message)); } busy = false;
  };
  const showCandidate = () => {
    clear(out); const c = result.candidate; const src = candidateToSource(c); const tmp = { ...src, id: 'tmp' }; const fmt = formatReference(S.settings.citationStyle, tmp); const issues = checkMetadata(tmp); const dup = duplicateOf(src, S.sources);
    out.append(h('div.cand', h('div.cand-k', KIND_LABEL[c.kind] || 'Source', c.oaUrl ? ' · open access link' : ''), h('div.cand-t', src.title), h('div.cand-m', namesDisplay(src.author) || 'No author found'), h('div.cand-ref', { html: bibInner(fmt.bib) || escapeHtml(src.title) }), dup && h('p.warn-t', `Possible duplicate: ${shortCite(dup.source)} (${dup.reason.toLowerCase()}).`), issues.length > 0 && h('p.warn-t', 'Check: ' + issues.map((i) => i.msg).join(', ')), h('div.pop-actions', h('button.btn.sm', { onclick: () => { const form = sourceForm(src); const d2 = dialog({ title: 'Edit before saving', body: form, width: 640, actions: [{ label: 'Cancel', value: false }, { label: 'Save to library', primary: true, onClick: async () => { dlg.close(); const s = await saveResolved({ ...result, candidate: { ...c, src: form.value() } }); then?.(s); } }] }); } }, 'Edit first'), h('span.grow'), h('button.btn.btn-primary.sm', { onclick: async () => { dlg.close(); const s = await saveResolved(result); then?.(s); } }, 'Save to library'))));
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
  const body = h('div.add-src', segmented([['id', 'DOI, ISBN or URL'], ['file', 'Upload file'], ['manual', 'Enter manually']], 'id', (v) => { if (v === 'file') { dlg.close(); importFlow(); } else if (v === 'manual') { dlg.close(); manualDialog(then); } }, 'How to add'), field('Identifier or URL', input, 'DOIs and ISBNs fill in automatically from Crossref and book catalogues. For other web pages, run the local server to read the page.'), h('div.row', h('button.btn.btn-primary.sm', { onclick: go }, 'Look up'), h('button.btn.sm', { onclick: () => { dlg.close(); bus.emit('research-search', input.value || ''); } }, 'Search the literature instead')), status, out);
  const dlg = dialog({ title: 'Add a source', body, width: 580 }); if (initial) setTimeout(go, 50); return dlg;
}
export function manualDialog(then) {
  const form = sourceForm(newSource({ type: 'article-journal' }));
  dialog({ title: 'Add source manually', body: form, width: 640, actions: [{ label: 'Cancel', value: false }, { label: 'Save to library', primary: true, onClick: () => { const d = form.value(); if (!d.title) { toast('Enter a title'); return false; } const r = addSource({ ...d, _origin: 'manual' }); then?.(r.source); } }] });
}

// ---- file import ---------------------------------------------------------------
export async function importFlow() {
  const files = await fileDialog({ multiple: true, accept: '.pdf,.txt,.md,.html,.htm,.docx,.bib,.ris,.json,.csv,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm' }); if (files.length) await importFiles(files);
}
export async function importFiles(files) {
  for (const f of files) {
    try {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (['bib', 'ris'].includes(ext) || (ext === 'json' && /csl|bib/i.test(f.name)) || (ext === 'json' && await looksLikeCSL(f))) { const { importBibliography } = await import('./importers.js'); await importBibliography(f); continue; }
      await importSourceFile(f);
    } catch (e) { console.error(e); toast(`Could not import ${f.name}: ${e.message}`, { kind: 'err' }); }
  }
}
async function looksLikeCSL(f) { try { const j = JSON.parse(await f.text()); return Array.isArray(j) && j[0] && (j[0].title || j[0].type); } catch { return false; } }
export async function importSourceFile(f, { attachTo } = {}) {
  const ext = (f.name.split('.').pop() || '').toLowerCase(); const fileId = uid('file'); const t = toast(`Importing ${f.name}…`, { timeout: 60000 }); let src = newSource({ type: 'document', title: f.name.replace(/\.[^.]+$/, ''), _origin: 'upload', accessed: undefined }); let pages = null;
  try {
    if (ext === 'pdf' || f.type === 'application/pdf') {
      const { loadPdf, extractAll, pdfMeta } = await import('./pdfdoc.js'); const buf = await f.arrayBuffer(); const pdf = await loadPdf(buf); const { info } = await pdfMeta(pdf);
      pages = await extractAll(pdf, (i, n) => { t.firstChild.textContent = `Indexing ${f.name}: page ${i} of ${n}`; });
      const first = pages.slice(0, 2).join('\n'); const doi = first.match(/\b10\.\d{4,9}\/[^\s"<>]+/)?.[0]?.replace(/[.,;)\]]+$/, '');
      src = { ...src, type: 'article-journal', title: (info.Title && info.Title.length > 3 ? info.Title : src.title), author: info.Author ? parseNames(info.Author.replace(/,\s*(?=[A-Z])/g, '; ')) : [], issued: (info.CreationDate && /D:(\d{4})/.exec(info.CreationDate)) ? { 'date-parts': [[+/D:(\d{4})/.exec(info.CreationDate)[1]]] } : undefined };
      if (!src.issued) delete src.issued; src.type = 'document'; src['number-of-pages'] = String(pdf.numPages);
      if (doi) { try { const c = await lookupDOI(doi); src = { ...c.src, ...{ _origin: 'upload' } }; toast('Metadata filled from DOI ' + doi); } catch { src.DOI = doi; } }
      await DB.saveBlob(S.id, fileId, f, f.name); src._files = [{ id: fileId, name: f.name, type: 'application/pdf', size: f.size }]; src._pdf = true;
    } else if (['txt', 'md', 'html', 'htm'].includes(ext)) {
      const txt = await f.text(); let html; if (ext === 'html' || ext === 'htm') { const doc = new DOMParser().parseFromString(txt, 'text/html'); html = await readableHTML(doc, location.href) || `<article>${(await import('./research.js')).sanitizeHTML(doc.body.innerHTML, location.href)}</article>`; const { extractPageMetadata } = await import('./research.js'); const md = extractPageMetadata(doc, 'https://example.invalid/'); if (md.title) src.title = md.title; if (md.author) src.author = md.author; } else html = `<article><pre class="plain">${escapeHtml(txt)}</pre></article>`;
      pages = (await import('./reader.js')).htmlToPages(html); await DB.saveBlob(S.id, fileId, new Blob([html], { type: 'text/html' }), f.name); src._files = [{ id: fileId, name: f.name, type: 'text/html' }]; src._readable = true;
    } else if (ext === 'docx') {
      const mammoth = await import('mammoth'); const r = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() }); const { sanitizeHTML } = await import('./research.js'); const html = `<article>${sanitizeHTML(r.value, location.href)}</article>`;
      pages = (await import('./reader.js')).htmlToPages(html); await DB.saveBlob(S.id, fileId, new Blob([html], { type: 'text/html' }), f.name); src._files = [{ id: fileId, name: f.name, type: 'text/html' }]; src._readable = true;
    } else {
      await DB.saveBlob(S.id, fileId, f, f.name); src._files = [{ id: fileId, name: f.name, type: f.type || 'application/octet-stream', size: f.size }];
      src.type = f.type.startsWith('image/') ? 'graphic' : f.type.startsWith('video/') ? 'motion_picture' : ['csv', 'tsv', 'json', 'xlsx', 'xls'].includes(ext) ? 'dataset' : 'document';
      if (src.type === 'dataset' && ['csv', 'tsv'].includes(ext)) { pages = [(await f.text()).slice(0, 2_000_000)]; }
    }
  } finally { t.remove(); }
  if (attachTo) { const s = S.sources.get(attachTo); s._files = [...(s._files || []), ...src._files]; if (pages) { await DB.saveText(S.id, s.id, pages); S.texts.set(s.id, pages); } putItem('source', s); return s; }
  const dup = duplicateOf(src, S.sources); const s = addSource(src, { quiet: true, allowDuplicate: true }).source;
  if (pages) { await DB.saveText(S.id, s.id, pages); S.texts.set(s.id, pages); }
  toast(`Imported ${f.name}`, { action: 'Open', onAction: () => bus.emit('open-reader', s.id) });
  if (dup) toast(`Possible duplicate of “${shortCite(dup.source)}” (${dup.reason.toLowerCase()})`, { action: 'Review', onAction: () => bus.emit('open-source-detail', dup.source.id) });
  bus.emit('open-source-detail', s.id); return s;
}

// ---- source detail panel -------------------------------------------------------
export function renderSourceDetail(root, id) {
  clear(root); const s = S.sources.get(id); if (!s) { root.append(h('p.empty-s', 'This source no longer exists.')); return; }
  const fmt = formatReference(S.settings.citationStyle, s); const issues = checkMetadata(s); const dup = duplicateOf(s, S.sources, s.id); const n = citeCounts().get(s.id) || 0;
  const hl = [...S.P.highlights.values()].filter((x) => x.sourceId === id); const notes = [...S.notes.values()].filter((x) => x.sourceId === id);
  const hasFile = (s._files || []).length > 0; const kind = kindOf(s);
  const rows = [['Type', typeLabel(s.type)], ['Authors', namesDisplay(s.author)], ['Editors', namesDisplay(s.editor)], ['Published', dateToString(s.issued)], ['Container', s['container-title']], ['Publisher', s.publisher], ['Volume', [s.volume, s.issue && `(${s.issue})`].filter(Boolean).join(' ')], ['Pages', s.page], ['DOI', s.DOI && h('a', { href: 'https://doi.org/' + normDOI(s.DOI), target: '_blank', rel: 'noopener noreferrer' }, s.DOI)], ['ISBN', s.ISBN], ['URL', s.URL && h('a', { href: s.URL, target: '_blank', rel: 'noopener noreferrer' }, s.URL.replace(/^https?:\/\//, '').slice(0, 48))], ['Accessed', dateToString(s.accessed)]].filter((r) => r[1]);
  root.append(
    h('div.sd-kind', h('span', { title: KIND_HINT[kind] }, KIND_LABEL[kind] || 'Source'), n ? ` · cited ${n}×` : ' · not cited yet'),
    h('h3.sd-title', s.title || 'Untitled'),
    h('div.sd-actions', h('button.btn.btn-primary.sm', { onclick: () => bus.emit('cite-source', id) }, 'Cite'), h('button.btn.sm', { disabled: !hasFile && !s.URL, onclick: () => bus.emit('open-reader', id) }, icon('book', 14), hasFile ? 'Open' : 'Open page'), h('button.btn.sm', { onclick: () => editSourceDialog(id) }, 'Edit'), h('button.icon-btn', { 'aria-label': 'More', onclick: (e) => sourceMenu(e.currentTarget, s) }, icon('more'))),
    h('div.sd-ref', { html: bibInner(fmt.bib) || '' }),
    issues.length > 0 && h('div.sd-issues', issues.map((i) => h('div.issue' + (i.sev === 'error' ? '.err' : ''), icon('alert', 13), i.msg)), h('button.link-btn', { onclick: () => editSourceDialog(id) }, 'Fix metadata')),
    dup && h('div.sd-issues', h('div.issue', icon('copy', 13), `Possible duplicate of ${shortCite(dup.source)} (${dup.reason.toLowerCase()})`), h('button.link-btn', { onclick: async () => { if (await confirmDialog('Merge these sources?', 'The other record is folded into this one; citations, notes and highlights are repointed.', { ok: 'Merge' })) { mergeSources(id, dup.source.id); toast('Merged'); } } }, 'Merge')),
    h('dl.sd-meta', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)])),
    s.abstract && h('details.sd-abs', h('summary', 'Abstract'), h('p', s.abstract)),
    h('div.sd-sec', h('div.sd-h', 'Organize'), h('div.row', h('button.btn.sm', { onclick: (e) => collectionsMenu(e.currentTarget, s) }, icon('folder', 14), ((s._collections || []).map((c) => S.P.collections.get(c)?.name).filter(Boolean).join(', ')) || 'Collections'), h('button.btn.sm', { onclick: () => { updateSource(id, { _fav: !s._fav }); } }, icon('star', 14), s._fav ? 'Favorited' : 'Favorite')),
      h('div.tag-edit', (s._tags || []).map((t) => h('span.tag', t, h('button.tag-x', { 'aria-label': 'Remove tag ' + t, onclick: () => updateSource(id, { _tags: s._tags.filter((x) => x !== t) }) }, '×'))), h('input.tag-in', { placeholder: 'Add tag', 'aria-label': 'Add tag', onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { updateSource(id, { _tags: [...new Set([...(s._tags || []), e.target.value.trim()])] }); } } })),
      h('label.check', h('input', { type: 'checkbox', checked: !!s._forceBib, onchange: (e) => updateSource(id, { _forceBib: e.target.checked }) }), 'Include in bibliography even if uncited')),
    h('div.sd-sec', h('div.sd-h', `Highlights and notes`, h('span.muted', ` ${hl.length + notes.length}`)), hl.map((x) => h('button.hl-row', { onclick: () => bus.emit('open-reader', id, { highlight: x.id }) }, h('span.hl-sw.c-' + x.color), h('span', h('span.hl-t', '“' + x.text.slice(0, 140) + (x.text.length > 140 ? '…' : '') + '”'), h('span.muted', ` p. ${x.page}`)))), notes.filter((x) => !x.highlightId).map((x) => h('button.hl-row', { onclick: () => bus.emit('open-note', x.id) }, h('span.hl-sw.n-' + x.kind), h('span', h('span.hl-t', x.text.slice(0, 140)), h('span.muted', ` ${NOTE_KINDS[x.kind]}${x.page ? ' · p. ' + x.page : ''}`)))), !hl.length && !notes.length && h('p.muted', 'Open the source and select text to highlight a passage, or add a note.'), h('button.link-btn', { onclick: () => bus.emit('new-note', { sourceId: id }) }, '+ Note on this source')),
    (s._files || []).length > 0 && h('div.sd-sec', h('div.sd-h', 'Files'), s._files.map((f) => h('div.file-row', icon('file', 14), f.name))),
    h('div.sd-sec.muted', `Added ${ago(s._added)}${s._origin ? ' · via ' + s._origin : ''}`));
}
function collectionsMenu(anchor, s) {
  const cols = [...S.P.collections.values()];
  menu(anchor, [...cols.map((c) => ({ label: c.name, checked: (s._collections || []).includes(c.id), action: () => { const set = new Set(s._collections || []); set.has(c.id) ? set.delete(c.id) : set.add(c.id); updateSource(s.id, { _collections: [...set] }); } })), cols.length && { divider: true }, { label: 'New collection…', icon: 'plus', action: async () => { const n = await promptDialog('New collection', 'Name'); if (n?.trim()) { const c = putItem('collection', { id: uid('col'), name: n.trim() }); updateSource(s.id, { _collections: [...(s._collections || []), c.id] }); } } }]);
}
