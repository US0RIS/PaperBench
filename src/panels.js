// Right-hand contextual panel: research, Wikipedia, define, evidence, comments, changes, audit, statistics, versions, map, assist, search, recent.
import { S, putItem, removeItem, addSource, takeSnapshot, pushRecent, refreshDerived } from './state.js';
import { h, icon, clear, menu, popover, dialog, toast, bus, confirmDialog, promptDialog, segmented, field, ago, fmtDate, $, $$ } from './ui.js';
import { PROVIDERS, providerById, candidateToSource, checkServer, serverState, loadAbstract, http } from './research.js';
import { KIND_LABEL, KIND_HINT, shortCite, namesDisplay, yearOf, uid, now, REL_TYPES, typeLabel, NOTE_KINDS, dateToString, wordCount } from './model.js';
import { renderSourceDetail, importSourceFile, saveResolved } from './library.js';
import { renderDefine } from './language.js';
import { WikiView, wikiSourceFor } from './wiki.js';
import { runAudit, checkLinks, evidenceFor, ensureClaim, addEvidence, claimAt, globalSearch, computeStats, diffDocs } from './review.js';
import { listSuggestions, resolveSuggestions, claimStatus, activeComment } from './editor.js';
import { schema } from './schema.js';
import { noteCard } from './notes.js';
import { pickSources, editCitationAt } from './editors.js';
import { formatReference, bibInner } from './csl.js';
import { openPassage } from './notes.js';

const M = schema.marks;
const TITLES = { research: 'Research', wiki: 'Wikipedia', define: 'Define', source: 'Source', evidence: 'Evidence', comments: 'Comments', changes: 'Suggested changes', audit: 'Citation audit', stats: 'Statistics', versions: 'Version history', map: 'Source relationships', assist: 'Assist', search: 'Search project', recent: 'Recent' };
const ORDER = ['research', 'wiki', 'define', 'evidence', 'comments', 'changes', 'audit', 'stats', 'versions', 'map', 'assist', 'search', 'recent'];
const ICONS = { research: 'search', wiki: 'globe', define: 'dict', evidence: 'book', comments: 'comment', changes: 'suggest', audit: 'check', stats: 'hash', versions: 'history', map: 'network', assist: 'ai', search: 'search', recent: 'history', source: 'file' };

export const panels = { cur: 'research', arg: null, el: null, body: null, title: null, wikiView: null, wikiHost: null, resState: { q: '', results: {}, sel: JSON.parse(localStorage.getItem('providers') || '["wikipedia","crossref","openalex"]'), saved: new Set() } };
export function mountPanels(host) {
  panels.title = h('button.panel-title', { 'aria-haspopup': 'menu', onclick: () => menu(panels.title, ORDER.map((k) => ({ label: TITLES[k], icon: ICONS[k], checked: panels.cur === k, action: () => show(k) })), { placement: 'bottom-start', label: 'Panels' }) });
  panels.body = h('div.panel-body');
  const quick = h('div.panel-quick', ['research', 'wiki', 'define'].map((k) => h('button.icon-btn', { 'aria-label': TITLES[k], title: TITLES[k], onclick: () => show(k) }, icon(ICONS[k], 16))));
  host.append(h('div.panel-head', panels.title, h('span.grow'), quick), panels.body); panels.el = host; draw();
  ['derived', 'notes', 'sources', 'comments', 'claims', 'evidences', 'snapshots', 'relations', 'highlights'].forEach((ev) => bus.on(ev, () => { if (['evidence', 'comments', 'changes', 'audit', 'stats', 'versions', 'map', 'source', 'recent'].includes(panels.cur)) drawSoon(); }));
  bus.on('selection', () => { if (panels.cur === 'evidence') drawSoon(); });
  bus.on('mode', () => { if (panels.cur === 'changes') drawSoon(); });
}
let t;
const drawSoon = () => { clearTimeout(t); t = setTimeout(draw, 150); };
export function show(name, arg) {
  panels.cur = name; panels.arg = arg; if (!S.ui.rightOpen) bus.emit('open-right'); draw(); const inp = panels.body.querySelector('input[type=search]'); if (inp && ['research', 'search', 'define'].includes(name)) inp.focus();
}
function draw() {
  if (!panels.body) return; const keepScroll = panels.body.scrollTop; clear(panels.body); panels.title.replaceChildren(TITLES[panels.cur], icon('down', 13));
  panels.wikiView && panels.wikiHost?.remove?.();
  try { ({ research, wiki, define, source, evidence, comments, changes, audit, stats, versions, map, assist, search, recent }[panels.cur])(panels.body, panels.arg); } catch (e) { console.error(e); panels.body.append(h('p.err.pad', 'This panel failed to load: ' + e.message)); }
  panels.body.scrollTop = keepScroll;
}
bus.on('open-source-detail', (id) => show('source', id));
bus.on('research-search', (q) => { panels.resState.q = q || ''; show('research'); if (q) runSearch(); });
bus.on('define', (w) => show('define', w));
bus.on('wiki-search', (q) => show('wiki', { search: q }));
bus.on('wiki-open', (t) => show('wiki', { title: t }));
bus.on('open-wiki-tab', (t) => bus.emit('wiki-tab', t));

// ---- research ------------------------------------------------------------------
let ctl = null;
async function runSearch() {
  const R = panels.resState; const q = R.q.trim(); if (!q) return; ctl?.abort(); ctl = new AbortController(); pushRecent('searches', { id: 'q:' + q, label: q, kind: 'research' });
  R.results = {}; const provs = PROVIDERS.filter((p) => R.sel.includes(p.id)); provs.forEach((p) => { R.results[p.id] = { status: 'loading', items: [] }; }); if (panels.cur === 'research') draw();
  const { detectIdentifier, resolveIdentifier } = await import('./library.js'); const id = detectIdentifier(q);
  if (id && id.kind !== 'query') { R.results.identifier = { status: 'loading', items: [], name: 'Identifier lookup' }; draw(); resolveIdentifier(id, { signal: ctl.signal }).then((r) => { R.results.identifier = { status: 'ok', items: r?.candidate ? [r.candidate] : [], name: 'Identifier lookup', note: r?.limited }; if (panels.cur === 'research') draw(); }).catch((e) => { R.results.identifier = { status: 'error', error: e.message, items: [], name: 'Identifier lookup' }; if (panels.cur === 'research') draw(); }); }
  provs.forEach((p) => p.search(q, { signal: ctl.signal }, (S.settings.language || 'en').slice(0, 2)).then((items) => { R.results[p.id] = { status: 'ok', items }; }).catch((e) => { R.results[p.id] = { status: 'error', error: e.message, items: [] }; }).finally(() => { if (panels.cur === 'research') draw(); }));
}
function research(el) {
  const R = panels.resState; const input = h('input.input', { type: 'search', placeholder: 'Search the literature, or paste a DOI, ISBN or URL', 'aria-label': 'Search research', value: R.q, onkeydown: (e) => { if (e.key === 'Enter') { R.q = e.target.value; runSearch(); } }, oninput: (e) => { R.q = e.target.value; } });
  const sel = h('button.btn.sm.ghost', { 'aria-haspopup': 'menu', onclick: () => menu(sel, PROVIDERS.map((p) => ({ label: p.name, sub: p.kinds, checked: R.sel.includes(p.id), action: () => { R.sel = R.sel.includes(p.id) ? R.sel.filter((x) => x !== p.id) : [...R.sel, p.id]; localStorage.setItem('providers', JSON.stringify(R.sel)); draw(); } })), { label: 'Sources to search' }) }, icon('filter', 13), `${R.sel.length} source${R.sel.length === 1 ? '' : 's'}`, icon('down', 12));
  el.append(h('div.panel-search',
    input,
    h('div.row', sel, h('span.grow'), h('button.btn.btn-primary.sm', { onclick: () => { R.q = input.value; runSearch(); } }, 'Search')),
    h('button.btn.sm.ghost.research-open', { onclick: () => bus.emit('open-research-view', input.value.trim()) }, icon('maximize', 13), 'Open full research')
  ));
  const entries = Object.entries(R.results);
  if (!entries.length) { const rs = S.recents.searches.filter((x) => x.kind === 'research').slice(0, 6); el.append(h('div.pad.muted', 'Results show where each record comes from. Scholarly records can be saved with one click; text is only available when an open-access link exists.'), rs.length ? h('div.pad', h('div.sd-h', 'Recent searches'), rs.map((s) => h('button.link-btn.block', { onclick: () => { R.q = s.label; runSearch(); } }, s.label))) : null); return; }
  entries.forEach(([pid, r]) => {
    const p = providerById(pid); const name = r.name || p.name; const sec = h('section.res-sec', h('div.res-h', h('span', name), h('span.muted', r.status === 'loading' ? 'Searching…' : r.status === 'error' ? '' : `${r.items.length} result${r.items.length === 1 ? '' : 's'}`)));
    if (r.status === 'error') sec.append(h('div.res-err', r.error, h('button.link-btn', { onclick: () => { if (p) { R.results[pid] = { status: 'loading', items: [] }; draw(); p.search(R.q, {}).then((items) => { R.results[pid] = { status: 'ok', items }; }).catch((e) => { R.results[pid] = { status: 'error', error: e.message, items: [] }; }).finally(draw); } else runSearch(); } }, 'Retry')));
    r.note && sec.append(h('div.muted.pad-s', r.note));
    r.items.forEach((c) => sec.append(resultRow(c))); if (r.status === 'ok' && !r.items.length) sec.append(h('div.muted.pad-s', 'Nothing found.')); el.append(sec);
  });
}
function resultRow(c) {
  const s = c.src; const R = panels.resState; const exists = [...S.sources.values()].find((x) => (s.DOI && x.DOI && x.DOI.toLowerCase() === s.DOI.toLowerCase()) || (s.ISBN && x.ISBN === s.ISBN) || (x._wikiTitle && x._wikiTitle === c.wikiTitle && c.provider === 'wikipedia'));
  const row = h('div.res-row', h('div.res-k', KIND_LABEL[c.kind] || 'Source', c.oaUrl ? ' · open access' : '', c.cites != null ? ` · ${c.cites.toLocaleString()} citations` : ''), h('button.res-t', { title: KIND_HINT[c.kind], onclick: () => toggle() }, s.title), h('div.res-m', [namesDisplay(s.author).slice(0, 80), yearOf(s), s['container-title']].filter(Boolean).join(' · ')));
  const ab = h('div.res-ab', { hidden: true }); const toggle = async () => { ab.hidden = !ab.hidden; if (!ab.hidden && !ab.dataset.l) { ab.dataset.l = 1; ab.textContent = c.abstract || (c.provider === 'pubmed' ? 'Loading abstract…' : 'No abstract available. Metadata only.'); if (c.provider === 'pubmed' && !c.abstract) { try { c.abstract = await loadAbstract(c); ab.textContent = c.abstract || 'No abstract available.'; } catch (e) { ab.textContent = e.message; } } } };
  row.append(ab);
  if (c.provider === 'wikipedia') row.append(h('div.row', h('button.btn.sm', { onclick: () => show('wiki', { title: c.wikiTitle }) }, 'Read'), h('button.btn.sm.ghost', { onclick: () => { const a = { title: c.wikiTitle }; const src = addSource(candidateToSource(c), { quiet: true, allowDuplicate: false }); toast(src.duplicate ? 'Already saved' : 'Saved as a source'); } }, 'Save as source')));
  else row.append(h('div.row', exists ? h('span.muted', icon('check', 13), ' In library') : h('button.btn.sm', { onclick: async (e) => { const b = e.currentTarget; b.disabled = true; const r = addSource(candidateToSource(c), { quiet: true }); b.replaceWith(h('span.muted', icon('check', 13), r.duplicate ? ' Already in library' : ' Saved')); if (!r.duplicate) toast('Saved to library', { action: 'Details', onAction: () => bus.emit('open-source-detail', r.source.id) }); } }, 'Save'), h('button.btn.sm', { onclick: () => { const r = exists ? { source: exists } : addSource(candidateToSource(c), { quiet: true }); bus.emit('cite-source', r.source.id); } }, 'Cite'),
    c.oaUrl ? h('button.btn.sm.ghost', { onclick: async () => { if (!(await checkServer()).ok) { window.open(c.oaUrl, '_blank', 'noopener'); return; } const r = exists ? { source: exists } : addSource(candidateToSource(c), { quiet: true }); try { toast('Fetching open-access PDF…'); const resp = await fetch('/api/fetch?url=' + encodeURIComponent(c.oaUrl) + '&raw=1'); const blob = await resp.blob(); if (!/pdf/i.test(blob.type)) throw new Error('The link did not return a PDF'); await importSourceFile(new File([blob], (s.title || 'document').slice(0, 60) + '.pdf', { type: 'application/pdf' }), { attachTo: r.source.id }); bus.emit('open-reader', r.source.id); } catch (er) { toast(er.message + ' Opening the link instead.', { kind: 'err' }); window.open(c.oaUrl, '_blank', 'noopener'); } } }, 'Open full text') : h('span.muted.sm', 'Metadata and abstract only')));
  return row;
}

// ---- wikipedia -----------------------------------------------------------------
function wiki(el, arg) {
  const input = h('input.input', { type: 'search', placeholder: 'Search Wikipedia', 'aria-label': 'Search Wikipedia', value: arg?.search || '', onkeydown: (e) => { if (e.key === 'Enter') doSearch(e.target.value); } });
  const out = h('div.wiki-out'); el.append(h('div.panel-search', input), out);
  async function doSearch(q) { if (!q.trim()) return; clear(out).append(h('p.muted.pad', 'Searching…')); try { const { searchWikipedia } = await import('./wiki.js'); const r = await searchWikipedia(q); clear(out); if (!r.length) out.append(h('p.muted.pad', 'No articles found.')); r.forEach((c) => out.append(h('button.wiki-hit', { onclick: () => open(c.wikiTitle) }, h('b', c.wikiTitle), h('span.muted', c.abstract)))); } catch (e) { clear(out).append(h('p.err.pad', e.message)); } }
  function open(title) { panels.lastWiki = title; clear(out); const host = h('div.wiki-host'); out.append(host); const v = new WikiView(host, {}); panels.wikiView = v; v.load(title); }
  if (arg?.title) open(arg.title); else if (arg?.search) doSearch(arg.search); else if (panels.lastWiki) open(panels.lastWiki); else out.append(h('p.muted.pad', 'Search for a topic to read it here. Selecting text lets you copy it, make a note, save the page as a source, follow its references or insert a link.'));
  if (arg?.title) panels.lastWiki = arg.title;
}

// ---- define / source -------------------------------------------------------------
function define(el, w) { const root = h('div'); el.append(root); renderDefine(root, w); }
function source(el, id) { const root = h('div.pad'); el.append(root); renderSourceDetail(root, id); }

// ---- evidence ------------------------------------------------------------------
export function showEvidenceForCitation(pos) { show('evidence', { citPos: pos }); }
function evidence(el, arg) {
  const E = S.editor; const sel = E.view.state.selection; const node = sel.node; const root = h('div.pad');
  el.append(h('div.row.pad-s', h('label.check', h('input', { type: 'checkbox', checked: S.settings.evidenceMode, onchange: (e) => { import('./state.js').then((m) => { m.saveSettings({ evidenceMode: e.target.checked }); E.reanalyze(); }); } }), 'Evidence mode'), h('span.muted', 'Mark claims and see their support')), root);
  const citPos = arg?.citPos ?? (node?.type.name === 'citation' ? sel.from : null);
  if (citPos != null && E.view.state.doc.nodeAt(citPos)?.type.name === 'citation') { citationInspector(root, citPos); return; }
  const c = claimAt(E);
  if (c) { claimPanel(root, c.claimId); return; }
  root.append(h('p.muted', 'Click a citation to see what it rests on, or place the cursor in a sentence and mark it as a claim.'), h('button.btn.sm', { onclick: () => { const id = ensureClaim(E); if (id) { E.reanalyze(); show('evidence'); } } }, 'Mark sentence as claim'));
  const claims = [...S.P.claims.values()];
  if (S.settings.evidenceMode || claims.length) { root.append(h('div.sd-h', `Claims (${claims.length})`)); const hasCite = new Map(); E.view.state.doc.descendants((n) => { if (n.isTextblock) { let f = false; n.descendants((x) => { if (x.type.name === 'citation') f = true; }); n.forEach((ch) => ch.marks?.forEach((m) => { if (m.type === M.claim) hasCite.set(m.attrs.claimId, f); })); return false; } }); claims.forEach((cl) => { const st = claimStatus(cl.id, hasCite.get(cl.id)); root.append(h('button.claim-row.s-' + st, { onclick: () => { const r = [...findClaim(cl.id)][0]; if (r != null) E.scrollTo(r); } }, h('span.claim-t', cl.text), h('span.muted', st.replace('-', ' ')))); }); }
}
function* findClaim(id) { let found = null; S.editor.view.state.doc.descendants((n, p) => { if (found == null && n.isText && n.marks.some((m) => m.type === M.claim && m.attrs.claimId === id)) { found = p; } }); if (found != null) yield found; }
function citationInspector(root, pos) {
  const node = S.editor.view.state.doc.nodeAt(pos); const D = S.derived;
  root.append(h('div.sd-kind', 'Citation'), h('div.cite-big', { html: D.cites.get(node.attrs.id) || '' }), h('div.row', h('button.btn.sm', { onclick: () => editCitationAt(pos) }, 'Edit citation')));
  node.attrs.items.forEach((it) => {
    const s = S.sources.get(it.sourceId); if (!s) { root.append(h('p.err', 'Source missing from library.')); return; }
    const fmt = formatReference(S.settings.citationStyle, s); const notes = [...S.notes.values()].filter((n) => n.id === it.noteId || (n.sourceId === s.id && (!it.locator || n.page === it.locator))); const hl = [...S.P.highlights.values()].filter((x) => x.id === it.highlightId || (x.sourceId === s.id && it.locator && x.page === String(it.locator)));
    root.append(h('div.insp', h('h3.sd-title', s.title), h('div.sd-ref', { html: bibInner(fmt.bib) }), h('dl.sd-meta', h('dt', 'Type'), h('dd', `${KIND_LABEL[s._kind || 'other'] || typeLabel(s.type)}`), it.locator && [h('dt', 'Locator'), h('dd', `${it.label || 'page'} ${it.locator}`)], s.DOI && [h('dt', 'DOI'), h('dd', s.DOI)]),
      h('div.sd-h', 'Saved passages and notes'), ...[...hl.map((x) => h('div.insp-q', h('p', '“' + x.text + '”'), h('div.muted', `p. ${x.page}`), h('button.btn.sm', { onclick: () => bus.emit('open-reader', s.id, { highlight: x.id }) }, 'Open the exact passage'))), ...notes.filter((n) => !hl.some((x) => x.id === n.highlightId)).map((n) => h('div.insp-q', noteCard(n, { compact: true }), (n.sourceId && (n.highlightId || n.page)) && h('button.btn.sm', { onclick: () => openPassage(n) }, 'Open source location')))], !hl.length && !notes.length && h('p.muted', 'No saved passage or note is linked to this citation. Open the source and highlight the passage to keep the evidence.'),
      h('div.row', h('button.btn.sm', { onclick: () => bus.emit('open-reader', s.id, it.locator && /^\d+$/.test(it.locator) ? { page: +it.locator } : {}) }, 'Open source'), h('button.btn.sm', { onclick: () => bus.emit('open-source-detail', s.id) }, 'Details'))));
  });
}
function claimPanel(root, claimId) {
  const rec = S.P.claims.get(claimId); const ev = evidenceFor(claimId); const E = S.editor;
  root.append(h('div.sd-kind', 'Claim'), h('p.claim-quote', '“' + (rec?.text || '') + '”'), h('label.check', h('input', { type: 'checkbox', checked: rec?.flag === 'verify', onchange: (e) => { putItem('claim', { ...rec, flag: e.target.checked ? 'verify' : null }); E.reanalyze(); } }), 'Needs verification'), h('div.sd-h', `Linked evidence (${ev.length})`));
  ev.forEach((e) => { const label = e.type === 'source' ? (S.sources.get(e.refId) ? shortCite(S.sources.get(e.refId)) + ': ' + S.sources.get(e.refId).title : 'Missing source') : e.type === 'note' ? (S.notes.get(e.refId)?.text || 'Missing note') : (S.P.highlights.get(e.refId)?.text || 'Missing highlight'); root.append(h('div.ev-row', h('button.ev-t', { onclick: () => { if (e.type === 'source') bus.emit('open-source-detail', e.refId); else if (e.type === 'note') bus.emit('open-note', e.refId); else bus.emit('open-reader', S.P.highlights.get(e.refId)?.sourceId, { highlight: e.refId }); } }, h('span.muted', e.type + ' '), label.slice(0, 140)), h('button.icon-btn.sm', { 'aria-label': 'Unlink', onclick: () => removeItem('evidence', e.id) }, icon('x', 13)))); });
  root.append(h('div.row', h('button.btn.sm', { onclick: async () => { const r = await pickSources({ title: 'Link a source as evidence', multi: true, locators: false, confirm: 'Link' }); r?.items.forEach((i) => addEvidence(claimId, 'source', i.sourceId)); } }, 'Link source'), h('button.btn.sm', { onclick: (e) => menu(e.currentTarget, [...S.notes.values()].filter((n) => n.sourceId).slice(0, 20).map((n) => ({ label: `${NOTE_KINDS[n.kind]}: ${n.text.slice(0, 50)}`, action: () => addEvidence(claimId, 'note', n.id) })).concat([...S.P.highlights.values()].slice(0, 20).map((x) => ({ label: `Highlight: ${x.text.slice(0, 50)}`, action: () => addEvidence(claimId, 'highlight', x.id) }))), { label: 'Link a note or passage' }) }, 'Link note or passage'), h('button.btn.sm.ghost', { onclick: () => { E.cmd.citation([]); } , hidden: true }), h('button.btn.sm', { onclick: async () => { const r = await pickSources({ title: 'Cite for this claim', multi: true }); if (r) { /* place citation after claim */ let pos = null; E.view.state.doc.descendants((n, p) => { if (pos == null && n.isText && n.marks.some((m) => m.type === M.claim && m.attrs.claimId === claimId)) pos = p + n.nodeSize; }); if (pos != null) { E.view.dispatch(E.view.state.tr.insert(pos, schema.nodes.citation.create({ id: uid('cit'), items: r.items, mode: 'parenthetical' }))); } } } }, 'Insert citation here')));
  root.append(h('button.link-btn', { onclick: () => { removeItem('claim', claimId); const E2 = S.editor; const tr = E2.view.state.tr; E2.view.state.doc.descendants((n, p) => { if (n.isText) n.marks.forEach((m) => { if (m.type === M.claim && m.attrs.claimId === claimId) tr.removeMark(p, p + n.nodeSize, m); }); }); E2.view.dispatch(tr.setMeta('noSuggest', true)); evidenceFor(claimId).forEach((e) => removeItem('evidence', e.id)); } }, 'Remove claim mark'));
}
bus.on('claims', () => {}); 

// ---- comments ------------------------------------------------------------------
export function addComment(text) {
  const E = S.editor; const { from, to, empty } = E.view.state.selection; if (empty) { toast('Select some text to comment on'); return; }
  const id = uid('cm'); const quote = E.view.state.doc.textBetween(from, to).slice(0, 120);
  E.view.dispatch(E.view.state.tr.addMark(from, to, M.comment.create({ commentId: id })).setMeta('noSuggest', true));
  putItem('comment', { id, text: text || '', author: E.author, created: now(), resolved: false, replies: [], quote }); show('comments', { focus: id });
}
function comments(el, arg) {
  const E = S.editor; const present = new Map(); E.view.state.doc.descendants((n, p) => { if (n.isText) n.marks.forEach((m) => { if (m.type === M.comment && !present.has(m.attrs.commentId)) present.set(m.attrs.commentId, p); }); });
  const list = [...S.P.comments.values()].sort((a, b) => (present.get(a.id) ?? 1e9) - (present.get(b.id) ?? 1e9));
  el.append(h('div.pad-s.row', h('button.btn.sm', { onclick: () => addComment() }, icon('commentAdd', 14), 'Comment on selection'), h('span.grow'), h('label.check', h('input', { type: 'checkbox', checked: !!panels.showResolved, onchange: (e) => { panels.showResolved = e.target.checked; draw(); } }), 'Resolved')));
  const root = h('div.pad'); el.append(root); const shown = list.filter((c) => panels.showResolved || !c.resolved);
  if (!shown.length) root.append(h('p.muted', 'No comments. Select text in the paper and press the comment button.'));
  shown.forEach((c) => {
    const pos = present.get(c.id); const ta = h('textarea.input', { rows: 2, placeholder: 'Write a comment', value: c.text, 'aria-label': 'Comment', onchange: (e) => { c.text = e.target.value; putItem('comment', c); } }); const rep = h('input.input.sm', { placeholder: 'Reply', 'aria-label': 'Reply', onkeydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { c.replies.push({ id: uid('r'), text: e.target.value.trim(), author: E.author, created: now() }); putItem('comment', c); } } });
    const card = h('div.cm' + (c.resolved ? '.resolved' : ''), { onmouseenter: () => { activeComment.id = c.id; E.reanalyze(); }, onmouseleave: () => { activeComment.id = null; E.reanalyze(); } }, h('button.cm-q', { onclick: () => pos != null && E.scrollTo(pos) }, pos == null ? '(text removed)' : '“' + c.quote + '”'), h('div.muted', `${c.author} · ${ago(c.created)}`), ta, c.replies.map((r) => h('div.cm-r', h('b', r.author), ' ', r.text)), rep, h('div.row', h('button.link-btn', { onclick: () => { c.resolved = !c.resolved; putItem('comment', c); } }, c.resolved ? 'Reopen' : 'Resolve'), h('button.link-btn', { onclick: () => { removeItem('comment', c.id); const tr = E.view.state.tr; E.view.state.doc.descendants((n, p) => { if (n.isText) n.marks.forEach((m) => { if (m.type === M.comment && m.attrs.commentId === c.id) tr.removeMark(p, p + n.nodeSize, m); }); }); E.view.dispatch(tr.setMeta('noSuggest', true)); } }, 'Delete'))); root.append(card); if (arg?.focus === c.id) { setTimeout(() => ta.focus(), 50); }
  });
}

// ---- suggested changes ---------------------------------------------------------
function changes(el) {
  const E = S.editor; const list = listSuggestions(E.view.state.doc); const root = h('div.pad');
  el.append(h('div.pad-s', segmented([['edit', 'Editing'], ['suggest', 'Suggesting']], S.suggest ? 'suggest' : 'edit', (v) => bus.emit('set-suggesting', v === 'suggest'), 'Editing mode'), h('p.muted', 'In Suggesting mode, typing and deleting inside paragraphs is tracked. Structural edits are not tracked.')), root);
  if (!list.length) { root.append(h('p.muted', 'No pending suggestions.')); return; }
  root.append(h('div.row', h('button.btn.sm', { onclick: () => resolveSuggestions(E.view, () => true, true) }, 'Accept all'), h('button.btn.sm', { onclick: () => resolveSuggestions(E.view, () => true, false) }, 'Reject all')));
  list.forEach((s) => root.append(h('div.sg', h('div.muted', `${s.author} · ${ago(s.time)}`), h('button.sg-t', { onclick: () => E.scrollTo(s.pos) }, s.del && h('del', s.del.slice(0, 120)), s.del && s.ins && ' ', s.ins && h('ins', s.ins.slice(0, 120))), h('div.row', h('button.link-btn', { onclick: () => resolveSuggestions(E.view, (m) => m.attrs.sid === s.sid, true) }, 'Accept'), h('button.link-btn', { onclick: () => resolveSuggestions(E.view, (m) => m.attrs.sid === s.sid, false) }, 'Reject')))));
}

// ---- audit ---------------------------------------------------------------------
function audit(el) {
  const E = S.editor; refreshDerived(); const items = runAudit(E.view.state.doc, E.analysis(), S.derived); const root = h('div.pad'); el.append(root);
  const sev = { error: 0, warn: 1, info: 2 }; items.sort((a, b) => sev[a.sev] - sev[b.sev]);
  root.append(h('p.muted', items.length ? `${items.filter((i) => i.sev !== 'info').length} to review, ${items.filter((i) => i.sev === 'info').length} notes.` : 'No problems found.'));
  items.forEach((i) => root.append(h('button.au.s-' + i.sev, { onclick: () => { if (i.pos != null) E.scrollTo(i.pos); else if (i.sourceId) bus.emit('open-source-detail', i.sourceId); } }, icon(i.sev === 'info' ? 'info' : 'alert', 14), h('span', i.msg))));
  const out = h('div'); root.append(h('div.sd-h', 'Links'), h('button.btn.sm', { onclick: async (e) => { e.currentTarget.disabled = true; clear(out).append(h('p.muted', 'Checking…')); const r = await checkLinks((i, n) => { out.firstChild.textContent = `Checking ${i} of ${n}…`; }); clear(out); if (r.unavailable) { out.append(h('p.muted', 'Link checking needs the local server (node server.js); browsers cannot read the status of other sites.')); return; } const bad = r.results.filter((x) => !x.ok); out.append(h('p.muted', bad.length ? `${bad.length} of ${r.results.length} links did not respond cleanly.` : `All ${r.results.length} links responded.`), ...bad.map((x) => h('button.au.s-warn', { onclick: () => bus.emit('open-source-detail', x.source.id) }, icon('alert', 14), h('span', `${shortCite(x.source)}: ${x.status || x.error}`)))); e.currentTarget.disabled = false; } }, 'Check source links'), out);
}

// ---- statistics ----------------------------------------------------------------
function stats(el) {
  const E = S.editor; refreshDerived(); const st = computeStats(E.view.state.doc, E.analysis(), S.derived); const root = h('div.pad'); el.append(root);
  const tgt = S.settings.targetWords; const row = (k, v) => [h('dt', k), h('dd', String(v))];
  const target = h('input.input.sm', { type: 'number', min: 0, value: tgt || '', placeholder: 'None', 'aria-label': 'Target word count', onchange: (e) => import('./state.js').then((m) => { m.saveSettings({ targetWords: +e.target.value || 0 }); draw(); }) });
  root.append(h('div.stat-big', h('span.stat-n', st.words.toLocaleString()), ' words'), tgt ? h('div.prog', { role: 'progressbar', 'aria-valuenow': st.words, 'aria-valuemax': tgt, 'aria-label': 'Progress toward target' }, h('div.prog-b', { style: { width: Math.min(100, st.words / tgt * 100) + '%' } })) : null, h('div.row', h('span.muted', 'Target'), target, tgt ? h('span.muted', `${Math.round(st.words / tgt * 100)}%`) : null),
    h('dl.sd-meta', ...row('Characters (no spaces)', st.chars.toLocaleString()), ...row('Characters (with spaces)', st.charsSpaces.toLocaleString()), ...row('Pages (≈275 words, double spaced)', st.pages), ...row('Pages (single spaced)', st.pagesSingle), ...row('Reading time', st.minutes + ' min'), ...row('Citations', st.cites), ...row('Unique sources cited', st.uniqueSources), ...row('Footnotes and notes', st.notes), ...row('Figures · tables · equations', `${st.figures} · ${st.tables} · ${st.equations}`), ...row('Words in notes', st.fnWords), ...row('Words in bibliography', st.bibWords)),
    h('div.sd-h', 'Words by section'));
  const max = Math.max(1, ...st.sections.map((x) => x.words));
  st.sections.forEach((x) => { const t = S.settings.sectionTargets[x.id]; root.append(h('div.sec-row', { style: { paddingLeft: (x.level - 1) * 10 + 'px' } }, h('button.link-btn', { onclick: () => E.scrollToId(x.id) }, x.text || 'Untitled'), h('span.grow'), h('span.muted', x.words + (t ? ` / ${t}` : '')), h('input.input.xs', { type: 'number', min: 0, placeholder: 'target', value: t || '', 'aria-label': 'Section target', onchange: (e) => { const v = +e.target.value; const m = { ...S.settings.sectionTargets }; if (v) m[x.id] = v; else delete m[x.id]; import('./state.js').then((s) => { s.saveSettings({ sectionTargets: m }); draw(); }); } })), h('div.bar', h('div.bar-b', { style: { width: (t ? Math.min(100, x.words / t * 100) : x.words / max * 100) + '%' } }))); });
  root.append(h('div.sd-h', 'Sentences and paragraphs'), h('dl.sd-meta', ...row('Average sentence', st.avgSentence + ' words'), ...row('Median sentence', st.medianSentence + ' words'), ...row('Sentences over 40 words', st.longSentences), ...row('Paragraphs', st.paragraphs), ...row('Average paragraph', st.avgPara + ' words'), ...(st.flesch != null ? row('Flesch reading ease', Math.round(st.flesch)) : [])), h('p.muted', 'Readability formulas count sentence and word length only. They do not measure clarity, argument or quality, and academic prose often scores low for good reasons.'));
}

// ---- versions ------------------------------------------------------------------
function versions(el) {
  const E = S.editor; const root = h('div.pad'); el.append(root); const sel = new Set();
  root.append(h('div.row', h('button.btn.sm', { onclick: async () => { const n = await promptDialog('Name this snapshot', 'Name', '', { ok: 'Save snapshot' }); if (n !== undefined) { takeSnapshot(n || 'Snapshot'); toast('Snapshot saved'); } } }, icon('save', 14), 'Save named snapshot'), h('button.btn.sm', { id: 'cmp-btn', disabled: true, onclick: () => { const [a, b] = [...sel]; showDiff(S.P.snapshots.get(a), S.P.snapshots.get(b)); } }, icon('compare', 14), 'Compare two')));
  const snaps = [...S.P.snapshots.values()].sort((a, b) => b.createdAt - a.createdAt);
  if (!snaps.length) root.append(h('p.muted', 'No snapshots yet. The app also saves automatic snapshots about every ten minutes of editing.'));
  snaps.forEach((s) => root.append(h('div.snap', h('label.check', h('input', { type: 'checkbox', 'aria-label': 'Select to compare', onchange: (e) => { e.target.checked ? sel.add(s.id) : sel.delete(s.id); if (sel.size > 2) { const f = [...sel][0]; sel.delete(f); $$('.snap input', root).forEach((i) => { i.checked = false; }); $$('.snap input', root).forEach((i, idx) => {}); } $('#cmp-btn', root).disabled = sel.size !== 2; } }), h('span', h('b', s.name || (s.auto ? 'Automatic snapshot' : 'Snapshot')), h('span.muted', ` ${fmtDate(s.createdAt)} · ${s.words} words`))), h('div.row', h('button.link-btn', { onclick: () => showDiff(s, { name: 'Current draft', doc: E.getJSON(), createdAt: now() }) }, 'Compare with current'), h('button.link-btn', { onclick: async () => { if (await confirmDialog('Restore this version?', 'The current draft is saved as a snapshot first, then replaced by this version.', { ok: 'Restore' })) { takeSnapshot('Before restoring ' + (s.name || fmtDate(s.createdAt))); E.replaceDoc(s.doc); toast('Restored'); } } }, 'Restore'), h('button.link-btn', { onclick: async () => { const n = await promptDialog('Rename snapshot', 'Name', s.name); if (n !== undefined) putItem('snapshot', { ...s, name: n }); } }, 'Rename'), h('button.link-btn', { onclick: async () => { if (await confirmDialog('Delete snapshot?', 'This cannot be undone.', { ok: 'Delete' })) removeItem('snapshot', s.id); } }, 'Delete')))));
}
export function showDiff(a, b) {
  const [older, newer] = a.createdAt <= b.createdAt ? [a, b] : [b, a]; const ops = diffDocs(older.doc, newer.doc); let unchanged = 0;
  const body = h('div.diff', h('p.muted', `${older.name || fmtDate(older.createdAt)} → ${newer.name || fmtDate(newer.createdAt)}`), ops.filter((o) => (o.type === 'same' ? (unchanged += o.count, false) : true)).map((o) => h('div.df.' + o.type, h('span.df-k', o.kind), o.type === 'mod' ? h('p', o.parts.map((p) => (p.added ? h('ins', p.value) : p.removed ? h('del', p.value) : p.value))) : h('p', o.type === 'del' ? h('del', o.text) : h('ins', o.text)))), !ops.some((o) => o.type !== 'same') && h('p', 'No differences in text.'), unchanged ? h('p.muted', `${unchanged} unchanged block${unchanged === 1 ? '' : 's'} not shown.`) : null);
  dialog({ title: 'Compare versions', body, width: 720 });
}

// ---- source map ----------------------------------------------------------------
function map(el) {
  const root = h('div.pad'); el.append(root); const srcs = [...S.sources.values()].sort((a, b) => shortCite(a).localeCompare(shortCite(b)));
  const A = h('select.input.sm', { 'aria-label': 'From source' }, srcs.map((s) => h('option', { value: s.id }, shortCite(s)))), T = h('select.input.sm', { 'aria-label': 'Relationship' }, Object.entries(REL_TYPES).map(([k, v]) => h('option', { value: k }, v))), B = h('select.input.sm', { 'aria-label': 'To source' }, srcs.map((s) => h('option', { value: s.id }, shortCite(s))));
  root.append(h('div.sd-h', 'Add relationship'), h('div.rel-form', A, T, B, h('button.btn.sm', { onclick: () => { if (A.value && B.value && A.value !== B.value) putItem('relation', { id: uid('rel'), from: A.value, to: B.value, type: T.value }); } }, 'Add')));
  const rels = [...S.P.relations.values()]; const bySrc = new Map(); rels.forEach((r) => { (bySrc.get(r.from) || bySrc.set(r.from, []).get(r.from)).push(r); });
  root.append(h('div.sd-h', 'Relationships'), !rels.length && h('p.muted', 'None yet.')); bySrc.forEach((list, id) => { const s = S.sources.get(id); if (!s) return; root.append(h('div.rel-g', h('button.link-btn.b', { onclick: () => bus.emit('open-source-detail', id) }, shortCite(s)), list.map((r) => { const t = S.sources.get(r.to); return h('div.rel-r', h('span.muted', REL_TYPES[r.type]), h('button.link-btn', { onclick: () => t && bus.emit('open-source-detail', t.id) }, t ? shortCite(t) : 'missing'), h('button.icon-btn.sm', { 'aria-label': 'Remove relationship', onclick: () => removeItem('relation', r.id) }, icon('x', 12))); }))); });
  const roles = { primary: [], secondary: [], background: [] }; srcs.forEach((s) => s._role && roles[s._role]?.push(s));
  root.append(h('div.sd-h', 'By role'), Object.entries(roles).map(([k, l]) => l.length ? h('div.rel-g', h('div.muted', k), l.map((s) => h('button.link-btn.block', { onclick: () => bus.emit('open-source-detail', s.id) }, shortCite(s)))) : null));
  const au = new Map(); srcs.forEach((s) => (s.author || []).forEach((a) => { const k = a.family || a.literal; if (k) (au.get(k) || au.set(k, []).get(k)).push(s); })); const same = [...au].filter(([, l]) => l.length > 1);
  const tg = new Map(); srcs.forEach((s) => (s._tags || []).forEach((t) => (tg.get(t) || tg.set(t, []).get(t)).push(s))); const topics = [...tg].filter(([, l]) => l.length > 1);
  root.append(same.length ? h('div.sd-h', 'Same author') : null, ...same.map(([k, l]) => h('div.rel-g', h('div.muted', k), l.map((s) => h('button.link-btn.block', { onclick: () => bus.emit('open-source-detail', s.id) }, shortCite(s) + ' ' + s.title.slice(0, 40))))), topics.length ? h('div.sd-h', 'Same topic (shared tag)') : null, ...topics.map(([k, l]) => h('div.rel-g', h('div.muted', '#' + k), l.map((s) => h('button.link-btn.block', { onclick: () => bus.emit('open-source-detail', s.id) }, shortCite(s))))));
}

// ---- search / recent -------------------------------------------------------------
export const searchState = { q: '', kinds: null };
function search(el, arg) {
  if (arg?.q != null) searchState.q = arg.q;
  const input = h('input.input', { type: 'search', placeholder: 'Search paper, notes, sources, quotations — "exact phrase"', 'aria-label': 'Search project', value: searchState.q, oninput: (e) => { searchState.q = e.target.value; clearTimeout(input._t); input._t = setTimeout(go, 200); } }); const out = h('div.pad');
  el.append(h('div.panel-search', input), out);
  const go = () => { clear(out); if (!searchState.q.trim()) { out.append(h('p.muted', 'Searches the paper text, notes, source titles, authors and tags, saved quotations, and the full text of indexed sources.')); return; } pushRecentDebounced(searchState.q); const res = globalSearch(searchState.q); if (!res.length) { out.append(h('p.muted', 'No results.')); return; } const groups = { paper: 'Paper', notes: 'Notes', sources: 'Sources', quotes: 'Saved quotations', text: 'Source text' }; Object.entries(groups).forEach(([k, name]) => { const l = res.filter((r) => r.kind === k); if (!l.length) return; out.append(h('div.sd-h', `${name} (${l.length})`), ...l.slice(0, 25).map((r) => h('button.sr', { onclick: () => navTo(r) }, h('span.muted', r.label + (r.src ? ' · ' + r.src : '') + (r.page ? ' · p. ' + r.page : '')), h('span', r.text)))); }); };
  go();
}
let rt; const pushRecentDebounced = (q) => { clearTimeout(rt); rt = setTimeout(() => pushRecent('searches', { id: 'g:' + q, label: q, kind: 'project' }), 1500); };
export function navTo(r) { if (r.kind === 'paper') { bus.emit('focus-paper'); S.editor.scrollTo(r.pos); } else if (r.noteId) bus.emit('open-note', r.noteId); else if (r.kind === 'sources') bus.emit('open-source-detail', r.sourceId); else bus.emit('open-reader', r.sourceId, { highlight: r.hlId, page: r.pageIndex, text: searchState.q.replace(/"/g, '') }); }
function recent(el) {
  const root = h('div.pad'); el.append(root); const R = S.recents; const sec = (t, arr, fn) => arr.length ? [h('div.sd-h', t), ...arr.map(fn)] : [];
  root.append(...sec('Sources', R.sources.filter((x) => S.sources.has(x.id)), (x) => h('button.link-btn.block', { onclick: () => bus.emit('open-reader', x.id) }, x.label.slice(0, 70))), ...sec('Searches', R.searches, (x) => h('button.link-btn.block', { onclick: () => (x.kind === 'wiki' ? show('wiki', { title: x.label }) : x.kind === 'project' ? show('search', { q: x.label }) : bus.emit('research-search', x.label)) }, (x.kind === 'wiki' ? 'Wikipedia: ' : '') + x.label)), ...sec('Sections edited', R.sections, (x) => h('button.link-btn.block', { onclick: () => S.editor.scrollToId(x.id) }, x.label)), ...sec('Notes', R.notes.filter((x) => S.notes.has(x.id)), (x) => h('button.link-btn.block', { onclick: () => bus.emit('open-note', x.id) }, x.label)));
  if (!root.childElementCount) root.append(h('p.muted', 'Nothing yet. Sources you open, searches, sections you edit and notes you create appear here.'));
}

// ---- assist (optional AI) ----------------------------------------------------------
const SYS = 'You assist an academic writer. Rules: never write or rewrite the user\'s paper; give suggestions only. Use ONLY the numbered excerpts for claims about sources; every sentence that states something about a source must cite excerpt numbers. Never invent quotations, citations, authors, or page numbers. Quote only text that appears verbatim in an excerpt. Respond with JSON only: {"parts":[{"text":"...","basis":"library"|"model","excerpts":[1],"quote":"verbatim quote or empty"}]}. Use basis "model" for your own reasoning or general knowledge and keep that clearly separate.';
function renderDesktopAISettings(root, st, configured = false) {
  clear(root);
  const key = h('input.input', { type: 'password', autocomplete: 'off', placeholder: configured ? 'Leave blank to keep the current key' : 'sk-ant-…', 'aria-label': 'Anthropic API key' });
  const model = h('input.input', { value: st.model || 'claude-sonnet-5-5', spellcheck: false, 'aria-label': 'Anthropic model' });
  const status = h('p.muted.sm');
  const save = h('button.btn.btn-primary', { onclick: async () => {
    save.disabled = true; status.textContent = 'Saving securely…';
    try {
      const body = { model: model.value.trim() }; if (key.value.trim()) body.key = key.value.trim();
      const r = await fetch('/api/settings/ai', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not save AI settings');
      await checkServer(true); toast('AI settings saved'); draw();
    } catch (e) { status.textContent = e.message; save.disabled = false; }
  } }, configured ? 'Save settings' : 'Enable AI assistance');
  const buttons = [save];
  if (configured) buttons.push(h('button.btn', { onclick: async () => {
    if (!(await confirmDialog('Remove AI key', 'Remove the saved Anthropic API key from this Mac?', { ok: 'Remove key', danger: true }))) return;
    try { const r = await fetch('/api/settings/ai', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: '', model: model.value.trim() }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); await checkServer(true); toast('AI key removed'); draw(); } catch (e) { status.textContent = e.message; }
  } }, 'Remove key'));
  root.append(
    h('p', configured ? 'AI settings' : 'AI assistance is off.'),
    h('p.muted', 'The Anthropic API key is encrypted with macOS secure storage. It is used only by the local PaperBench backend and is never written to IndexedDB or exposed to paper content.'),
    field('Anthropic API key', key, configured ? 'Leave blank to keep the saved key.' : 'Stored only on this Mac.'),
    field('Model', model, 'Use an Anthropic Messages API model available to your account.'),
    h('div.row', buttons), status
  );
}
function assist(el) {
  const root = h('div.pad'); el.append(root); const E = S.editor;
  checkServer().then((st) => {
    if (!st.ai) {
      if (st.desktop) renderDesktopAISettings(root, st, false);
      else root.append(h('p', 'AI assistance is off.'), h('p.muted', 'Start the local server with the ANTHROPIC_API_KEY environment variable set (node server.js). The key stays on the server and is never sent to the browser.'));
      return;
    }
    const out = h('div'); const status = h('p.muted');
    const run = async (label, prompt, excerpts) => {
      status.textContent = 'Thinking…'; clear(out);
      const ex = excerpts.map((e, i) => `[${i + 1}] (${e.where}) ${e.text}`).join('\n\n');
      try { const r = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system: SYS, prompt: `${prompt}\n\nExcerpts:\n${ex || '(none)'}` }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); status.textContent = ''; render(label, j.text, excerpts); } catch (e) { status.textContent = e.message; }
    };
    const render = (label, text, ex) => {
      let parts; try { parts = JSON.parse(text.replace(/^```json|```$/g, '').trim()).parts; } catch { parts = [{ text, basis: 'model', excerpts: [] }]; }
      const card = h('div.ai-card', h('div.sd-h', label));
      parts.forEach((p) => { let q = p.quote || ''; let note = ''; if (q) { const src = (p.excerpts || []).map((n) => ex[n - 1]?.text || '').join(' '); if (!src.includes(q)) { note = 'A quotation the model offered was removed because it does not appear in the excerpts.'; q = ''; } } const lib = p.basis === 'library' && (p.excerpts || []).length && p.excerpts.every((n) => ex[n - 1]); card.append(h('p.ai-p.' + (lib ? 'lib' : 'mod'), h('span.muted.sm', lib ? 'From your library: ' : 'Model reasoning: '), p.text, lib && h('span.ai-ex', p.excerpts.map((n) => h('button.link-btn', { title: ex[n - 1].text.slice(0, 200), onclick: () => ex[n - 1].open?.() }, `[${ex[n - 1].where}]`))), q && h('blockquote.ai-q', '“' + q + '”'), note && h('span.err', note))); });
      card.append(h('div.row', h('button.btn.sm', { onclick: () => { const n = { id: uid('note'), kind: 'idea', text: parts.map((p) => p.text).join('\n'), attach: { type: 'none' }, tags: ['assistant'], created: now(), updated: now() }; putItem('note', n); toast('Saved as an idea note'); } }, 'Save as note'), h('button.btn.sm', { onclick: () => { navigator.clipboard?.writeText(parts.map((p) => p.text).join('\n')); } }, 'Copy')), h('p.muted.sm', 'Suggestion only. Nothing was changed in your paper.')); out.append(card);
    };
    const selText = () => E.selectionText(); const pageEx = (s, n = 6) => (S.texts.get(s.id) || []).slice(0, n).map((t, i) => ({ where: `${shortCite(s)}${s._pdf ? ' p.' + (i + 1) : ''}`, text: t.slice(0, 1800), open: () => bus.emit('open-reader', s.id, s._pdf ? { page: i + 1 } : {}) }));
    const cmds = [
      ['Explain selection', () => { const t = selText(); if (!t) return toast('Select a passage in the paper'); run('Explanation', `Explain this passage from the writer's paper in plain terms, and say what a reader might find unclear:\n"${t}"`, []); }],
      ['Find unclear sentences', () => { const t = selText() || E.view.state.doc.textContent.slice(0, 6000); run('Possibly unclear sentences', `Point to sentences that may be unclear or repetitive in this text, quoting each from the text (basis "model", quote must come from the text). Do not rewrite them.\n"${t}"`, [{ where: 'paper', text: t }]); }],
      ['Suggest search terms', () => run('Search terms', 'Suggest search terms and related concepts for finding literature on this topic. Mark all as model reasoning.\nTopic: ' + (selText() || S.settings.title || E.view.state.doc.child(0).textContent), [])],
      ['Summarize a source', async () => { const r = await pickSources({ title: 'Summarize which source?', multi: false, locators: false, confirm: 'Summarize' }); if (!r) return; const s = S.sources.get(r.items[0].sourceId); const ex = pageEx(s); if (!ex.length) { if (s.abstract) ex.push({ where: shortCite(s) + ' abstract', text: s.abstract }); else return toast('This source has no indexed text or abstract to summarize.', { kind: 'err' }); } run('Summary of ' + shortCite(s), 'Summarize the source using only the excerpts. Say if the excerpts are partial.', ex); }],
      ['Compare two sources', async () => { const r = await pickSources({ title: 'Choose two sources', multi: true, locators: false, confirm: 'Compare' }); if (!r || r.items.length !== 2) return toast('Choose exactly two sources'); const ex = r.items.flatMap((i) => { const s = S.sources.get(i.sourceId); const e = pageEx(s, 4); return e.length ? e : s.abstract ? [{ where: shortCite(s) + ' abstract', text: s.abstract }] : []; }); run('Comparison', 'Compare the two sources and identify where they agree or disagree, using only the excerpts. If the excerpts are insufficient, say so.', ex); }],
      ['Ask my library', async () => { const q = await promptDialog('Ask your library', 'Question', '', { ok: 'Ask' }); if (!q) return; const res = globalSearch(q.replace(/[?"]/g, ''), ['text', 'quotes', 'notes']).slice(0, 8); const ex = res.map((r) => ({ where: r.src || r.label, text: r.text, open: () => navTo(r) })); run('Answer from your library', `Answer the question using only the excerpts. If they do not answer it, say that. Question: ${q}`, ex); }],
    ];
    const intro = h('div.row', h('p.muted.grow', 'Suggestions only. The assistant never edits your paper. Library claims show their excerpts; model reasoning is labelled.'), st.desktop ? h('button.btn.sm.ghost', { onclick: () => renderDesktopAISettings(root, st, true) }, 'AI settings') : null);
    root.append(intro, h('div.ai-cmds', cmds.map(([l, f]) => h('button.btn.sm', { onclick: f }, l))), status, out);
  });
}
