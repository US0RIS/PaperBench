// CSL engine wrapper (citeproc-js). Any CSL 1.0 style can be added via registerStyle().
import CSL from 'citeproc';
import localeEn from './csl/locales-en-US.xml';
import apa from './csl/apa.csl';
import mla from './csl/modern-language-association.csl';
import chicagoNB from './csl/chicago-notes-bibliography.csl';
import chicagoAD from './csl/chicago-author-date.csl';
import harvard from './csl/harvard-cite-them-right.csl';
import ieee from './csl/ieee.csl';
import { CITATION_STYLES, toCSL, firstFamily, yearOf, escapeHtml } from './model.js';

const XML = { apa, 'modern-language-association': mla, 'chicago-notes-bibliography': chicagoNB, 'chicago-author-date': chicagoAD, 'harvard-cite-them-right': harvard, ieee };
const custom = new Map(); // id -> {name, xml}
export function registerStyle(id, name, xml) { custom.set(id, { name, xml }); }
export function listStyles() { return [...CITATION_STYLES.map((s) => ({ id: s.id, name: s.name })), ...[...custom].map(([id, v]) => ({ id, name: v.name + ' (imported)' }))]; }
export function styleXml(id) {
  if (custom.has(id)) return custom.get(id).xml;
  const s = CITATION_STYLES.find((x) => x.id === id) || CITATION_STYLES[0];
  return XML[s.file];
}
export const styleClass = (id) => (/<style[^>]*\sclass="([\w-]+)"/.exec(styleXml(id)) || [])[1] || 'in-text';
export const isNumeric = (id) => /citation-number/.test((/<citation[\s>][\s\S]*?<\/citation>/.exec(styleXml(id)) || [''])[0]);
export const isNoteStyle = (id) => styleClass(id) === 'note';

const caches = new Map();
function engineFor(styleId, lang, slot) {
  const key = styleId + '|' + lang + '|' + custom.size; let c = caches.get(slot);
  if (!c || c.key !== key) { const items = {}; c = { key, items, engine: new CSL.Engine({ retrieveLocale: () => localeEn, retrieveItem: (id) => items[id] }, styleXml(styleId), 'en-US') }; caches.set(slot, c); }
  return c;
}
const clean = (h) => String(h).replace(/&#38;/g, '&').replace(/<(?!\/?(i|b|sup|sub|span)\b)[^>]*>/g, '').replace(/ style="[^"]*"/g, (m) => (/small-caps|italic|bold/.test(m) ? m : ''));
const plain = (h) => String(h).replace(/<[^>]+>/g, '').replace(/&#38;/g, '&').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const narrativeName = (s) => {
  const a = s.author || s.editor || []; if (!a.length) return (s.title || 'Untitled').split(/[:.]/)[0];
  const f = (x) => x.family || x.literal || '';
  return a.length === 1 ? f(a[0]) : a.length === 2 ? `${f(a[0])} and ${f(a[1])}` : `${f(a[0])} et al.`;
};

// citations: [{id, items:[{sourceId, locator, label, prefix, suffix, suppressAuthor}], mode, noteIndex}]
export function renderCitations({ styleId, lang = 'en-US', citations, sources, includeUncited = [], slot = 'main' }) {
  const items = {}, missing = new Set(), used = [];
  const noteStyle = isNoteStyle(styleId), cls = styleClass(styleId), numeric = isNumeric(styleId);
  for (const c of citations) for (const it of c.items) {
    const s = sources.get(it.sourceId);
    if (!s) { missing.add(it.sourceId); continue; }
    items[s.id] = toCSL(s); if (!used.includes(s.id)) used.push(s.id);
  }
  for (const id of includeUncited) { const s = sources.get(id); if (s && !items[id]) { items[id] = toCSL(s); } }
  const C = engineFor(styleId, lang, slot), engine = C.engine;
  for (const k of Object.keys(C.items)) delete C.items[k];
  Object.assign(C.items, items);
  const clusters = [], plan = [];
  citations.forEach((c, i) => {
    const valid = c.items.filter((it) => items[it.sourceId]);
    if (!valid.length) return;
    const mk = (extra = {}) => valid.map((it) => ({ id: it.sourceId, ...(it.locator ? { locator: it.locator, label: it.label || 'page' } : {}), ...(it.prefix ? { prefix: it.prefix } : {}), ...(it.suffix ? { suffix: it.suffix } : {}), ...(it.suppressAuthor ? { 'suppress-author': true } : {}), ...extra }));
    const ni = c.noteIndex || 0;
    const base = { citationID: 'k' + i, properties: { noteIndex: ni } };
    if (c.mode === 'narrative' && !noteStyle && !numeric) {
      // Author-date narrative: "Author" + "(year, p. x)"
      clusters.push({ ...base, citationID: base.citationID + '__a', citationItems: mk({ 'author-only': true }).map((x) => { delete x.locator; delete x.label; delete x.prefix; delete x.suffix; delete x['suppress-author']; return x; }) });
      clusters.push({ ...base, citationID: base.citationID + '__b', citationItems: mk({ 'suppress-author': true }) });
      plan.push({ id: base.citationID, kind: 'narrative2' });
    } else {
      clusters.push({ ...base, citationItems: mk() });
      plan.push({ id: base.citationID, kind: c.mode === 'narrative' ? 'narrative-name' : 'plain', first: valid[0] });
    }
  });
  let out = [];
  try { out = engine.rebuildProcessorState(clusters); } catch (e) { console.warn('citeproc', e); out = []; }
  const strings = new Map(out.map(([cid, , str]) => [cid, str]));
  const cites = new Map();
  for (const p of plan) {
    if (p.kind === 'narrative2') {
      const a = plain(strings.get(p.id + '__a') || ''), b = clean(strings.get(p.id + '__b') || '');
      cites.set(p.id, `${escapeHtml(a)} ${b}`);
    } else if (p.kind === 'narrative-name') cites.set(p.id, `${escapeHtml(narrativeName(sources.get(p.first.sourceId)))} ${clean(strings.get(p.id) || '')}`);
    else cites.set(p.id, clean(strings.get(p.id) || ''));
  }
  let bib = { entries: [], params: {} };
  if (Object.keys(items).length) {
    try {
      engine.updateUncitedItems(includeUncited.filter((id) => items[id]));
      const b = engine.makeBibliography();
      if (b) {
        const ids = b[0].entry_ids.map((x) => x[0]);
        bib = { params: b[0], entries: b[1].map((h, i) => ({ sourceId: ids[i], html: h })) };
      }
    } catch (e) { console.warn('bib', e); }
  }
  return { cites, bib, missing: [...missing], used, noteStyle, cls };
}
export const bibText = (html) => plain(html).replace(/\s+/g, ' ').trim();
export const bibInner = (html) => String(html).replace(/^\s*<div class="csl-entry">/, '').replace(/<\/div>\s*$/, '');
export const citeHtmlToText = plain;

// One-off formatting of a single source (preview in library and search results)
export function formatReference(styleId, source) {
  const m = new Map([[source.id, source]]);
  const r = renderCitations({ styleId, citations: [{ id: 'p', items: [{ sourceId: source.id }], mode: 'parenthetical', noteIndex: 1 }], sources: m, slot: 'preview' });
  return { cite: r.cites.get('k0') || '', bib: r.bib.entries[0]?.html || '' };
}

export function previewCitation(styleId, items, sources, mode = 'parenthetical') {
  const r = renderCitations({ styleId, citations: [{ id: 'p', items, mode, noteIndex: isNoteStyle(styleId) ? 1 : 0 }], sources, slot: 'preview' });
  return r.cites.get('k0') || '';
}
