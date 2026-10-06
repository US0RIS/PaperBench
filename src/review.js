// Citation audit, claim/evidence workflow, global search, writing statistics, version diff.
import { S, putItem, removeItem } from './state.js';
import { schema } from './schema.js';
import { checkMetadata, shortCite, wordCount, uid, now, escapeHtml, normDOI, stripTags, namesDisplay, yearOf } from './model.js';
import { claimStatus } from './editor.js';
import { walkJSON } from './analyze.js';
import { http } from './research.js';
import { Node as PMNode } from 'prosemirror-model';
import { diffWords, diffArrays } from 'diff';

const T = schema.nodes, M = schema.marks;
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ---- citation audit ------------------------------------------------------------
export function runAudit(doc, A, derived) {
  const out = []; const add = (kind, sev, msg, o = {}) => out.push({ id: uid('au'), kind, sev, msg, ...o });
  const blockCites = (node) => { let f = false; node.descendants((c) => { if (c.type === T.citation || (c.type === T.footnote && JSON.stringify(c.attrs.content).includes('"citation"'))) f = true; return !f; }); return f; };
  // 1. explicit quotations without citation
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      let qs = null; node.forEach((c, off) => { if (c.isText && c.marks.some((m) => m.type === M.quote)) { if (!qs) qs = { from: pos + 1 + off, text: '' }; qs.text += c.text; } });
      if (qs && !blockCites(node) && node.type !== T.paragraph || (qs && node.type === T.paragraph && !blockCites(node))) { const parent = doc.resolve(pos).parent; if (parent.type === T.blockquote) { /* handled below */ } else add('quote', 'warn', `Quotation without a citation: “${qs.text.slice(0, 70)}${qs.text.length > 70 ? '…' : ''}”`, { pos: qs.from }); }
      return false;
    }
    if (node.type === T.blockquote) {
      const next = doc.resolve(pos + node.nodeSize).nodeAfter; let startsCite = false; if (next?.isTextblock) { let i = 0; next.forEach((c) => { if (i++ < 3 && c.type === T.citation) startsCite = true; }); }
      if (!blockCites(node) && !startsCite) add('quote', 'warn', `Block quotation without a citation: “${node.textContent.slice(0, 70)}…”`, { pos });
    }
    return true;
  });
  // 2. text that matches a captured passage but is not marked or cited
  const caps = [...S.notes.values()].filter((n) => n.kind === 'quotation' && n.text.length > 40);
  if (caps.length) doc.descendants((node, pos) => {
    if (!node.isTextblock) return true; const txt = norm(node.textContent); if (txt.length < 40) return false;
    for (const n of caps) { const words = norm(n.text).split(' '); for (let i = 0; i + 8 <= words.length; i += 3) { const chunk = words.slice(i, i + 8).join(' '); if (txt.includes(chunk)) { let marked = false; node.forEach((c) => { if (c.isText && c.marks.some((m) => m.type === M.quote)) marked = true; }); if (!marked && !blockCites(node)) add('copied', 'warn', `This paragraph repeats text captured from ${shortCite(S.sources.get(n.sourceId) || { title: 'a source' })}${n.page ? ', p. ' + n.page : ''} without a quotation mark or citation.`, { pos }); else if (!marked) add('copied', 'info', `This paragraph repeats captured source text but is not marked as a quotation (${shortCite(S.sources.get(n.sourceId) || { title: 'source' })}).`, { pos }); return false; } } }
    return false;
  });
  // 3. citations: missing sources, incomplete metadata
  const seenMeta = new Set();
  A.citations.forEach((c) => c.items.forEach((it) => {
    const s = S.sources.get(it.sourceId);
    if (!s) { add('missing', 'error', 'A citation points to a source that was deleted from the library.', { pos: c.pos }); return; }
    if (!seenMeta.has(s.id)) { seenMeta.add(s.id); const iss = checkMetadata(s); const errs = iss.filter((x) => x.sev === 'error'); if (errs.length) add('metadata', 'warn', `${shortCite(s)}: ${errs.map((e) => e.msg.toLowerCase()).join(', ')}.`, { sourceId: s.id }); else if (iss.length) add('metadata', 'info', `${shortCite(s)}: ${iss.map((e) => e.msg.toLowerCase()).join(', ')}.`, { sourceId: s.id }); }
  }));
  // 4. cited but absent from bibliography (engine could not render) and forced-but-uncited entries
  const inBib = new Set(derived.bib.entries.map((e) => e.sourceId));
  derived.used.forEach((id) => { if (!inBib.has(id)) add('bib', 'error', `${shortCite(S.sources.get(id))} is cited but did not appear in the bibliography.`, { sourceId: id }); });
  S.sources.forEach((s) => { if ((s._forceBib || S.settings.includeUncited) && !derived.used.includes(s.id) && s._forceBib) add('uncited', 'info', `${shortCite(s)} is set to appear in the bibliography but is not cited in the text.`, { sourceId: s.id }); });
  // 5. claims
  const hasCite = new Map(); doc.descendants((node) => { if (node.isTextblock) { const f = blockCites(node); node.forEach((c) => c.marks?.forEach((m) => { if (m.type === M.claim) hasCite.set(m.attrs.claimId, f); })); return false; } return true; });
  const seenClaim = new Set();
  doc.descendants((node, pos) => { if (node.isText) node.marks.forEach((m) => { if (m.type === M.claim && !seenClaim.has(m.attrs.claimId)) { seenClaim.add(m.attrs.claimId); const st = claimStatus(m.attrs.claimId, hasCite.get(m.attrs.claimId)); const rec = S.P.claims.get(m.attrs.claimId); if (st === 'unsupported') add('claim', 'warn', `Claim has no evidence or citation: “${(node.text || '').slice(0, 80)}”`, { pos, claimId: m.attrs.claimId }); else if (st === 'needs-verification') add('claim', 'warn', `Claim marked “needs verification”: “${(node.text || '').slice(0, 80)}”`, { pos, claimId: m.attrs.claimId }); } }); });
  // 6. cross-reference targets
  A.crossrefs.forEach((x) => { if (!A.labels.has(x.target)) add('xref', 'error', 'A cross-reference points to something that no longer exists.', { pos: x.pos }); });
  // 7. figures without alt text
  doc.descendants((n, pos) => { if (n.type === T.figure && !n.attrs.alt) add('alt', 'warn', 'A figure has no alternative text.', { pos }); });
  return out;
}
export async function checkLinks(onProgress) {
  const { serverState, checkServer } = await import('./research.js'); await checkServer();
  const list = [...S.sources.values()].filter((s) => s.URL || s.DOI); const res = [];
  if (!serverState.ok) return { unavailable: true, results: [] };
  let i = 0; for (const s of list) { i++; onProgress?.(i, list.length); const url = s.URL || 'https://doi.org/' + normDOI(s.DOI); try { const r = await fetch('/api/check?url=' + encodeURIComponent(url)); const j = await r.json(); res.push({ source: s, url, ok: j.ok, status: j.status, error: j.error }); } catch (e) { res.push({ source: s, url, ok: false, error: e.message }); } }
  return { results: res };
}

// ---- evidence ------------------------------------------------------------------
export function evidenceFor(claimId) { return [...S.P.evidences.values()].filter((e) => e.anchorId === claimId); }
export function ensureClaim(E) {
  const { from, to, empty } = E.view.state.selection; const view = E.view;
  let range = { from, to };
  if (empty) { const $f = view.state.doc.resolve(from); const par = $f.parent; if (!par.isTextblock) return null; const text = par.textContent; const off = $f.parentOffset; const start = Math.max(0, text.lastIndexOf('. ', off - 1) + 1 + (text.lastIndexOf('. ', off - 1) >= 0 ? 1 : 0)); let end = text.indexOf('. ', off); end = end < 0 ? text.length : end + 1; const base = $f.start(); range = { from: base + start, to: base + end }; }
  let id = null; view.state.doc.nodesBetween(range.from, range.to, (n) => { if (n.isText) n.marks.forEach((m) => { if (m.type === M.claim && !id) id = m.attrs.claimId; }); });
  if (!id) { id = uid('clm'); putItem('claim', { id, text: view.state.doc.textBetween(range.from, range.to).slice(0, 200), flag: null, created: now() }); view.dispatch(view.state.tr.addMark(range.from, range.to, M.claim.create({ claimId: id })).setMeta('noSuggest', true)); }
  return id;
}
export function addEvidence(anchorId, type, refId) { if ([...S.P.evidences.values()].some((e) => e.anchorId === anchorId && e.type === type && e.refId === refId)) return; putItem('evidence', { id: uid('ev'), anchorId, type, refId, created: now() }); }
export function claimAt(E) {
  const { from } = E.view.state.selection; const doc = E.view.state.doc; let found = null;
  const $f = doc.resolve(from); const par = $f.parent; if (!par.isTextblock) return null; const base = $f.start();
  par.forEach((c, off) => { if (c.isText && base + off <= from && from <= base + off + c.nodeSize) c.marks.forEach((m) => { if (m.type === M.claim) found = { claimId: m.attrs.claimId, text: c.text }; }); }); return found;
}

// ---- search --------------------------------------------------------------------
function parseQuery(q) { const phrases = []; const rest = q.replace(/"([^"]+)"/g, (_, p) => { phrases.push(p.toLowerCase()); return ' '; }); const words = rest.toLowerCase().split(/\s+/).filter(Boolean); return { phrases, words }; }
const matches = (hay, { phrases, words }) => { const h = hay.toLowerCase(); return phrases.every((p) => h.includes(p)) && words.every((w) => h.includes(w)); };
const snippet = (text, { phrases, words }, n = 90) => { const low = text.toLowerCase(); const needle = phrases[0] || words[0] || ''; const at = needle ? low.indexOf(needle) : 0; const a = Math.max(0, at - n / 2); return (a > 0 ? '…' : '') + text.slice(a, a + n * 1.6).replace(/\s+/g, ' ') + (a + n * 1.6 < text.length ? '…' : ''); };
export function globalSearch(q, kinds = null) {
  const Q = parseQuery(q); if (!Q.phrases.length && !Q.words.length) return []; const out = []; const E = S.editor; const want = (k) => !kinds || kinds.includes(k);
  if (want('paper') && E) E.view.state.doc.descendants((n, pos) => { if (n.isTextblock && n.textContent && matches(n.textContent, Q)) { out.push({ kind: 'paper', label: n.type.name === 'heading' ? 'Heading' : 'Paper', text: snippet(n.textContent, Q), pos }); } return !n.isTextblock; });
  if (want('notes')) S.notes.forEach((n) => { const hay = `${n.text} ${(n.tags || []).join(' ')}`; if (matches(hay, Q)) out.push({ kind: 'notes', label: n.kind, text: snippet(n.text, Q), noteId: n.id }); });
  if (want('sources')) S.sources.forEach((s) => { const hay = `${s.title} ${namesDisplay(s.author)} ${(s._tags || []).join(' ')} ${s['container-title'] || ''} ${s.abstract || ''} ${yearOf(s)}`; if (matches(hay, Q)) out.push({ kind: 'sources', label: 'Source', text: `${shortCite(s)}: ${s.title}`, sourceId: s.id }); });
  if (want('quotes')) S.P.highlights.forEach((hl) => { const hay = `${hl.text} ${hl.comment || ''}`; if (matches(hay, Q)) out.push({ kind: 'quotes', label: 'Highlight', text: snippet(hl.text, Q), sourceId: hl.sourceId, hlId: hl.id, page: hl.page }); });
  if (want('text')) S.texts.forEach((pages, sid) => { const s = S.sources.get(sid); if (!s) return; let n = 0; pages.forEach((t, i) => { if (n < 6 && matches(t, Q)) { n++; out.push({ kind: 'text', label: 'Source text', text: snippet(t, Q), sourceId: sid, page: s._pdf ? i + 1 : undefined, pageIndex: i + 1, src: shortCite(s) }); } }); });
  return out;
}

// ---- statistics ----------------------------------------------------------------
export function computeStats(doc, A, derived) {
  const body = A.bodyWords; const text = doc.textBetween(0, doc.content.size, '\n', ' ');
  const bodyText = []; doc.descendants((n) => { if (n.type === T.callout || (n.type === T.heading && n.attrs.planning)) return false; if (n.isTextblock) bodyText.push(n.textContent); return true; });
  const all = bodyText.join('\n'); const sentences = all.split(/(?<=[.!?])\s+(?=[A-Z“"(])/).filter((s) => wordCount(s) > 0); const sl = sentences.map(wordCount); const paras = bodyText.filter((p) => wordCount(p) > 0).map(wordCount);
  const syl = (w) => Math.max(1, (w.toLowerCase().replace(/e$/, '').match(/[aeiouy]{1,2}/g) || []).length);
  const words = all.match(/[\p{L}'’-]+/gu) || []; const sy = words.reduce((a, w) => a + syl(w), 0);
  const flesch = words.length && sentences.length ? 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (sy / words.length) : null;
  const bibWords = derived.bib.entries.reduce((a, e) => a + wordCount(stripTags(e.html)), 0);
  const fnWords = A.footnotes.reduce((a, f) => { let t = ''; walkJSON(f.content, (x) => { if (x.text) t += x.text + ' '; }); return a + wordCount(t); }, 0);
  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return { words: body, chars: all.replace(/\s/g, '').length, charsSpaces: all.length, pages: Math.max(1, Math.round(body / 275 * 10) / 10), pagesSingle: Math.round(body / 500 * 10) / 10, minutes: Math.max(1, Math.round(body / 238)), bibWords, fnWords, sentences: sentences.length, avgSentence: sl.length ? Math.round(sl.reduce((a, b) => a + b, 0) / sl.length * 10) / 10 : 0, medianSentence: median(sl), longSentences: sl.filter((n) => n > 40).length, paragraphs: paras.length, avgPara: paras.length ? Math.round(paras.reduce((a, b) => a + b, 0) / paras.length) : 0, flesch, cites: A.citations.length, uniqueSources: new Set(A.citations.flatMap((c) => c.items.map((i) => i.sourceId))).size, notes: A.footnotes.length, sections: A.headings.filter((h) => !h.planning).map((h) => ({ id: h.id, text: h.text, level: h.level, words: h.words })), figures: A.figures.length, tables: A.tables.length, equations: A.equations.length };
}

// ---- version diff --------------------------------------------------------------
export function docBlocks(json) {
  const doc = PMNode.fromJSON(schema, json); const blocks = [];
  doc.forEach((n, off, i) => { if (i < 3) { blocks.push({ kind: ['Title', 'Subtitle', 'Author'][i], text: n.textContent, key: 'front' + i }); return; } if (i === 3) { blocks.push({ kind: 'Abstract', text: n.textContent, key: 'abstract' }); return; }
    const t = n.type.name; if (t === 'bullet_list' || t === 'ordered_list' || t === 'task_list') { n.forEach((li) => blocks.push({ kind: 'List item', text: li.textContent })); return; }
    if (t === 'table_block') { blocks.push({ kind: 'Table', text: n.textContent }); return; } if (t === 'figure') { blocks.push({ kind: 'Figure', text: n.textContent || '(figure)' }); return; } if (t === 'math_block') { blocks.push({ kind: 'Equation', text: n.attrs.latex }); return; }
    if (t === 'horizontal_rule' || t === 'page_break') return; blocks.push({ kind: t === 'heading' ? 'Heading' : t === 'blockquote' ? 'Quote' : 'Paragraph', text: n.textContent, level: n.attrs?.level }); });
  return blocks.filter((b) => b.text || b.kind === 'Figure');
}
export function diffDocs(aJSON, bJSON) {
  const A = docBlocks(aJSON), B = docBlocks(bJSON); const ops = diffArrays(A.map((x) => x.text), B.map((x) => x.text)); const out = []; let ai = 0, bi = 0;
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.added || o.removed) {
      // pair a removal followed by an addition as modifications
      const next = ops[k + 1];
      if (o.removed && next?.added) { const n = Math.max(o.count, next.count); for (let j = 0; j < n; j++) { const a = A[ai + j], b = B[bi + j]; if (a && b) out.push({ type: 'mod', kind: b.kind, parts: diffWords(a.text, b.text) }); else if (a) out.push({ type: 'del', kind: a.kind, text: a.text }); else out.push({ type: 'add', kind: b.kind, text: b.text }); } ai += o.count; bi += next.count; k++; continue; }
      if (o.removed) { o.value.forEach((_, j) => out.push({ type: 'del', kind: A[ai + j].kind, text: A[ai + j].text })); ai += o.count; } else { o.value.forEach((_, j) => out.push({ type: 'add', kind: B[bi + j].kind, text: B[bi + j].text })); bi += o.count; }
    } else { ai += o.count; bi += o.count; out.push({ type: 'same', count: o.count }); }
  }
  return out;
}
