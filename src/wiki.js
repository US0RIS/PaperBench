// Native Wikipedia reader built on the MediaWiki REST and Action APIs (no iframe).
import { S, addSource, putItem, updateSource, pushRecent } from './state.js';
import { h, icon, clear, menu, popover, toast, bus, $, $$, segmented } from './ui.js';
import { http, ApiError, WIKI_API, providerById, lookupDOI, candidateToSource } from './research.js';
import { parseNames, todayDate, uid, now, escapeHtml, normDOI, stripTags } from './model.js';
import { setCapture, noteFromHighlight } from './reader.js';

const mem = new Map();
const REST = (l) => `https://${l}.wikipedia.org/api/rest_v1`;
const wl = () => (S.settings.language || 'en').slice(0, 2);
const cleanSel = (t) => t.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();

export async function fetchArticle(title, lang = wl()) {
  const key = lang + ':' + title; if (mem.has(key)) return mem.get(key);
  const enc = encodeURIComponent(title.replace(/ /g, '_'));
  const [sum, html, rel] = await Promise.all([http(`${REST(lang)}/page/summary/${enc}?redirect=true`), http(`${REST(lang)}/page/html/${enc}?redirect=true`, { text: true }), http(`${WIKI_API(lang)}?action=query&list=search&srsearch=${encodeURIComponent('morelike:' + title)}&srlimit=8&format=json&origin=*`).catch(() => ({}))]);
  const art = parseArticle(html, sum, lang); art.related = (rel.query?.search || []).map((r) => r.title).filter((t) => t !== art.title);
  mem.set(key, art); return art;
}

function absUrl(u) { return u?.startsWith('//') ? 'https:' + u : u; }
function parseArticle(html, sum, lang) {
  const doc = new DOMParser().parseFromString(html, 'text/html'); const body = doc.body;
  const rev = sum.revision || doc.querySelector('html')?.getAttribute('about')?.match(/revision\/(\d+)/)?.[1] || ''; const ts = sum.timestamp;
  // infobox
  const infobox = []; const ib = body.querySelector('table.infobox'); if (ib) { ib.querySelectorAll('tr').forEach((tr) => { const th = tr.querySelector('th'), td = tr.querySelector('td'); if (th && td && infobox.length < 16) { const k = th.textContent.replace(/\s+/g, ' ').trim(), v = td.textContent.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim(); if (k && v && v.length < 240) infobox.push([k, v]); } }); }
  // references
  const refs = []; body.querySelectorAll('ol.mw-references > li, ol.references > li').forEach((li, i) => { const text = li.querySelector('.mw-reference-text, .reference-text') || li; refs.push({ id: li.id, n: i + 1, text: text.textContent.replace(/\s+/g, ' ').replace(/^\s*↑\s*/, '').trim(), links: [...text.querySelectorAll('a[href]')].map((a) => ({ href: absUrl(a.getAttribute('href')), text: a.textContent })).filter((l) => /^https?:/.test(l.href) && !/wikipedia\.org\/wiki\/Special:|\/wiki\/Help:/.test(l.href)), cite: parseCite(text) }); });
  const refNum = new Map(refs.map((r) => [r.id, r.n]));
  // strip noise
  body.querySelectorAll('style, link, script, .mw-editsection, .noprint, .navbox, .navbox-styles, .metadata, .ambox, .sistersitebox, .mw-empty-elt, table.infobox, .shortdescription, .mw-references-wrap, ol.references, .reflist, div.refbegin, [role="navigation"], .hatnote').forEach((e) => e.remove());
  body.querySelectorAll('section[data-mw-section-id]').forEach((s) => { const hd = s.querySelector(':scope > h2, :scope > h3, :scope > h4'); if (hd && /^(References|Notes|External links|Further reading|See also|Bibliography|Sources)$/i.test(hd.textContent.trim())) s.remove(); });
  // rewrite links
  body.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') || ''; const rel = a.getAttribute('rel') || '';
    if (/^#cite_note/.test(href)) { a.setAttribute('data-ref', href.slice(1)); const n = refNum.get(href.slice(1)); if (n) a.textContent = `[${n}]`; a.removeAttribute('href'); a.setAttribute('role', 'button'); a.tabIndex = 0; }
    else if (/mw:WikiLink/.test(rel) && href.startsWith('./') && !/:/.test(href.slice(2).replace(/%3A/gi, ':').split('#')[0])) { a.setAttribute('data-wiki', decodeURIComponent(href.slice(2).split('#')[0]).replace(/_/g, ' ')); a.removeAttribute('href'); a.setAttribute('role', 'link'); a.tabIndex = 0; }
    else if (href.startsWith('#')) { a.removeAttribute('href'); }
    else if (/^(https?:)?\/\//.test(href)) { a.setAttribute('href', absUrl(href)); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    else { const t = document.createElement('span'); t.textContent = a.textContent; a.replaceWith(t); }
  });
  body.querySelectorAll('img').forEach((i) => { i.setAttribute('src', absUrl(i.getAttribute('src') || '')); i.removeAttribute('srcset'); i.removeAttribute('data-file-width'); i.loading = 'lazy'; i.setAttribute('referrerpolicy', 'no-referrer'); });
  body.querySelectorAll('[style]').forEach((e) => e.removeAttribute('style')); body.querySelectorAll('[typeof], [about], [data-mw], [data-parsoid], [id]').forEach((e) => { if (!e.matches('h2,h3,h4,section')) { ['typeof', 'about', 'data-mw', 'data-parsoid'].forEach((a) => e.removeAttribute(a)); if (!/^cite_/.test(e.id)) e.removeAttribute('id'); } });
  body.querySelectorAll('h2,h3,h4').forEach((e) => { e.removeAttribute('data-mw'); });
  const sections = [...body.querySelectorAll('h2')].map((e, i) => { e.id = e.id || 'sec-' + i; return { id: e.id, title: e.textContent.trim() }; });
  const lead = sum.extract || ''; const thumb = sum.thumbnail?.source;
  return { title: sum.title || '', display: sum.titles?.display ? stripTags(sum.titles.display) : sum.title, description: sum.description || '', lead, thumb, rev: String(rev || ''), ts, lang, url: sum.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((sum.title || '').replace(/ /g, '_'))}`, permalink: rev ? `https://${lang}.wikipedia.org/w/index.php?title=${encodeURIComponent((sum.title || '').replace(/ /g, '_'))}&oldid=${rev}` : '', html: body.innerHTML, infobox, refs, sections };
}
const TPL = { 'cite journal': 'article-journal', 'cite book': 'book', 'cite web': 'webpage', 'cite news': 'article-newspaper', 'cite conference': 'paper-conference', 'cite encyclopedia': 'entry-encyclopedia', 'cite arxiv': 'article', 'cite thesis': 'thesis', 'cite report': 'report', 'cite magazine': 'article-magazine', 'cite press release': 'webpage', 'cite techreport': 'report' };
function parseCite(el) {
  const out = []; el.querySelectorAll('[data-mw]').forEach((e) => { try { const j = JSON.parse(e.getAttribute('data-mw')); (j.parts || []).forEach((p) => { const t = p.template; if (!t) return; const name = (t.target?.wt || '').trim().toLowerCase(); if (!name.startsWith('cite') && name !== 'citation') return; const params = {}; for (const [k, v] of Object.entries(t.params || {})) params[k.toLowerCase()] = (v.wt || '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/''+/g, '').trim(); out.push({ name, params }); }); } catch { /* */ } });
  return out[0] || null;
}
export function refToSource(ref) {
  const c = ref.cite; const p = c?.params || {}; const get = (...k) => k.map((x) => p[x]).find(Boolean) || '';
  if (!c) return null;
  const authors = []; for (let i = 1; i <= 8; i++) { const l = get(`last${i}`, i === 1 ? 'last' : '', `surname${i}`, i === 1 ? 'surname' : ''); const f = get(`first${i}`, i === 1 ? 'first' : '', `given${i}`, i === 1 ? 'given' : ''); const a = get(`author${i}`, i === 1 ? 'author' : ''); if (l) authors.push({ family: l, given: f }); else if (a) authors.push(...parseNames(a)); }
  if (!authors.length && p.vauthors) p.vauthors.split(/,\s*/).forEach((v) => { const m = v.trim().split(/\s+/); const init = m.pop(); if (m.length) authors.push({ family: m.join(' '), given: init.split('').join('. ') + '.' }); });
  const type = TPL[c.name] || (get('journal') ? 'article-journal' : get('publisher') && !get('url') ? 'book' : 'webpage');
  const yr = get('year') || (get('date').match(/\d{4}/) || [''])[0]; const dm = get('date').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  const s = { type, title: get('title', 'chapter', 'article'), author: authors, issued: dm ? { 'date-parts': [[+dm[1], +dm[2], ...(dm[3] ? [+dm[3]] : [])]] } : yr ? { 'date-parts': [[+yr]] } : undefined, 'container-title': get('journal', 'work', 'website', 'newspaper', 'magazine', 'encyclopedia', 'periodical', 'chapter' && type === 'chapter' ? 'title' : ''), publisher: get('publisher', 'institution'), volume: get('volume'), issue: get('issue', 'number'), page: get('pages', 'page'), DOI: get('doi') ? normDOI(get('doi')) : undefined, ISBN: get('isbn') || undefined, URL: get('url', 'chapter-url') || undefined, accessed: get('access-date', 'accessdate') ? undefined : undefined, _origin: 'wikipedia-ref' };
  if (type === 'chapter') s['container-title'] = get('title'); Object.keys(s).forEach((k) => (s[k] === undefined || s[k] === '' || (Array.isArray(s[k]) && !s[k].length)) && delete s[k]);
  return s.title ? s : null;
}

// ---- save page as source ---------------------------------------------------------
export function wikiSourceFor(art, { create = true } = {}) {
  let s = [...S.sources.values()].find((x) => x._origin === 'wikipedia' && x._wikiTitle === art.title && x._wikiLang === art.lang && (!art.rev || x._wikiRev === art.rev)) || [...S.sources.values()].find((x) => x._origin === 'wikipedia' && x._wikiTitle === art.title && x._wikiLang === art.lang);
  if (s || !create) return s;
  const d = art.ts ? new Date(art.ts) : null;
  const src = { type: 'entry-encyclopedia', title: art.display || art.title, 'container-title': 'Wikipedia', publisher: 'Wikimedia Foundation', URL: art.permalink || art.url, issued: d ? { 'date-parts': [[d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]] } : undefined, accessed: todayDate(), language: art.lang, abstract: art.lead, _origin: 'wikipedia', _kind: 'wikipedia', _wikiTitle: art.title, _wikiRev: art.rev, _wikiLang: art.lang, _tags: ['wikipedia'], _role: 'background' };
  Object.keys(src).forEach((k) => src[k] === undefined && delete src[k]);
  const r = addSource(src, { quiet: true, allowDuplicate: true }); return r.source;
}

// ---- viewer --------------------------------------------------------------------
export class WikiView {
  constructor(host, { expanded = false, onTitle } = {}) { this.host = host; this.expanded = expanded; this.onTitle = onTitle; this.stack = []; this.art = null; this.mode = 'article'; host.classList.add('wiki'); }
  async load(title, { push = true, section } = {}) {
    clear(this.host); this.host.append(h('p.muted.pad', 'Loading “' + title + '”…'));
    try { const art = await fetchArticle(title); if (push && this.art) this.stack.push(this.art.title); this.art = art; this.mode = 'article'; pushRecent('searches', { id: 'wiki:' + art.title, label: art.title, kind: 'wiki' }); this.onTitle?.(art.title); this.render(section); }
    catch (e) { clear(this.host); this.host.append(h('div.pad', h('p.err', e.status === 404 ? `There is no Wikipedia article called “${title}”.` : e.message), h('button.btn.sm', { onclick: () => this.load(title, { push: false }) }, 'Try again'))); }
  }
  render(section) {
    const a = this.art; clear(this.host); const host = this.host;
    const saved = wikiSourceFor(a, { create: false });
    const back = this.stack.length ? h('button.icon-btn', { 'aria-label': 'Back', onclick: () => { const t = this.stack.pop(); this.load(t, { push: false }); } }, icon('left', 15)) : null;
    const insertLink = () => { const E = S.editor; const { empty, from, to } = E.view.state.selection; const href = a.url; if (!empty) { E.view.dispatch(E.view.state.tr.addMark(from, to, S.editor.view.state.schema.marks.link.create({ href })).scrollIntoView()); } else { const sch = E.view.state.schema; E.view.dispatch(E.view.state.tr.replaceSelectionWith(sch.text(a.display || a.title, [sch.marks.link.create({ href })]), false)); } bus.emit('focus-paper'); toast('Link inserted'); };
    host.append(h('div.wiki-head', back, h('div.wh-t', h('h3', a.display || a.title), a.description && h('div.muted', a.description)), !this.expanded && h('button.icon-btn', { 'aria-label': 'Open in a larger reader', title: 'Expand', onclick: () => bus.emit('open-wiki-tab', a.title) }, icon('maximize', 15))),
      h('div.wiki-actions', h('button.btn.sm', { onclick: () => { const s = wikiSourceFor(a); toast(saved ? 'Already saved as a source' : 'Saved as a source', { action: 'Cite', onAction: () => bus.emit('cite-source', s.id) }); this.render(); } }, icon('plus', 13), saved ? 'Saved' : 'Save as source'), h('button.btn.sm', { onclick: insertLink }, icon('link', 13), 'Insert link'), h('a.btn.sm.ghost', { href: a.permalink || a.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external', 13), 'Wikipedia'), h('span.grow'), segmented([['article', 'Article'], ['refs', `References (${a.refs.length})`]], this.mode, (v) => { this.mode = v; this.render(); }, 'View')),
      h('div.wiki-note', 'Wikipedia is good for orientation but is rarely the right final source. Use the references to reach the sources it relies on.'));
    const scroll = h('div.wiki-scroll'); host.append(scroll); this.scroll = scroll;
    if (this.mode === 'refs') return this.renderRefs(scroll);
    if (a.thumb) scroll.append(h('img.wiki-thumb', { src: a.thumb, alt: '', referrerpolicy: 'no-referrer' }));
    scroll.append(h('p.wiki-lead', a.lead));
    if (a.infobox.length) scroll.append(h('details.wiki-ib', { open: this.expanded }, h('summary', 'At a glance'), h('dl', a.infobox.flatMap(([k, v]) => [h('dt', k), h('dd', v)]))));
    if (a.sections.length) scroll.append(h('details.wiki-toc', h('summary', 'Contents'), h('ol', a.sections.map((s) => h('li', h('button.link-btn', { onclick: () => { const el = scroll.querySelector('#' + CSS.escape(s.id)); el?.scrollIntoView({ block: 'start' }); } }, s.title))))));
    const body = h('div.wiki-body', { html: a.html }); scroll.append(body);
    body.addEventListener('click', (e) => { const w = e.target.closest('[data-wiki]'); if (w) { e.preventDefault(); this.load(w.dataset.wiki); return; } const r = e.target.closest('[data-ref]'); if (r) { e.preventDefault(); this.refPopover(r, r.dataset.ref); } });
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.click?.(); });
    if (a.related.length) scroll.append(h('div.wiki-rel', h('div.sd-h', 'Related pages'), h('div.chips', a.related.map((t) => h('button.chip', { onclick: () => this.load(t) }, t)))));
    scroll.append(h('p.muted.src', `Text from Wikipedia, available under CC BY-SA 4.0. Revision ${a.rev || 'unknown'}${a.ts ? ', ' + new Date(a.ts).toLocaleDateString() : ''}.`));
    this.selectionBar(scroll);
    if (section) setTimeout(() => scroll.querySelector('#' + CSS.escape(section))?.scrollIntoView(), 0);
  }
  renderRefs(scroll) {
    const a = this.art; if (!a.refs.length) { scroll.append(h('p.empty-s', 'This article lists no references.')); return; }
    a.refs.forEach((r) => scroll.append(this.refCard(r)));
  }
  refCard(r) {
    const src = refToSource(r.cite ? r : r); const doi = r.cite?.params?.doi || r.links.find((l) => /doi\.org\/10\./.test(l.href))?.href;
    return h('div.ref-card', { id: 'rc-' + r.id }, h('div.ref-n', '[' + r.n + ']'), h('div.ref-b', h('div.ref-t', r.text), h('div.ref-l', r.links.slice(0, 3).map((l) => h('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer' }, (l.text || l.href).slice(0, 48)))),
      h('div.row', h('button.btn.sm', { onclick: (e) => this.saveRef(r, e.currentTarget) }, icon('plus', 13), doi ? 'Save source (DOI lookup)' : src ? 'Save as source' : 'Save link as source'), h('button.btn.sm.ghost', { onclick: () => bus.emit('research-search', (src?.title || r.text).slice(0, 120)) }, 'Search for it'))));
  }
  refPopover(anchor, id) { const r = this.art.refs.find((x) => x.id === id); if (!r) return; popover(anchor, h('div.ref-pop', this.refCard(r)), { className: 'wide', label: 'Reference ' + r.n }); }
  async saveRef(r, btn) {
    btn.disabled = true; const { saveResolved } = await import('./library.js');
    try {
      const doi = r.cite?.params?.doi || (r.links.find((l) => /doi\.org\/(10\.\S+)/.test(l.href))?.href.match(/doi\.org\/(10\.\S+)/) || [])[1];
      if (doi) { const c = await lookupDOI(decodeURIComponent(doi)); const s = await saveResolved({ candidate: c }); bus.emit('open-source-detail', s.id); }
      else { const src = refToSource(r); const url = r.links.find((l) => !/wikipedia\.org/.test(l.href))?.href; const base = src || (url ? { type: 'webpage', title: r.text.slice(0, 120), URL: url } : { type: 'document', title: r.text.slice(0, 160) }); const res = addSource({ ...base, accessed: base.URL ? todayDate() : undefined, _origin: 'wikipedia-ref', _tags: ['from wikipedia'] }, { quiet: true }); toast(res.duplicate ? 'Already in your library' : 'Saved. Check the metadata before citing.', { action: 'Review', onAction: () => bus.emit('open-source-detail', res.source.id) }); }
    } catch (e) { toast(e.message, { kind: 'err' }); } btn.disabled = false;
  }
  selectionBar(scroll) {
    let bar; const hide = () => { bar?.remove(); bar = null; };
    scroll.addEventListener('mouseup', () => setTimeout(() => {
      const s = window.getSelection(); if (!s || s.isCollapsed || !scroll.contains(s.anchorNode)) return hide(); const text = cleanSel(s.toString()); if (text.length < 2) return hide(); hide(); const r = s.getRangeAt(0).getBoundingClientRect();
      const b = (ic, label, fn) => h('button.tb', { 'aria-label': label, title: label, onmousedown: (e) => e.preventDefault(), onclick: () => { fn(); hide(); } }, icon(ic, 15));
      bar = h('div.bubble.reader-bar', { role: 'toolbar' }, b('copy', 'Copy with source', () => { navigator.clipboard?.writeText(text).catch(() => {}); const src = wikiSourceFor(this.art); setCapture(src.id, text, {}); toast('Copied. Pasting into the paper will ask how to cite it.'); }),
        b('note', 'Make a research note', () => { const src = wikiSourceFor(this.art); const n = { id: uid('note'), kind: 'quotation', text, attach: { type: 'source', refId: src.id }, sourceId: src.id, page: '', tags: ['wikipedia'], created: now(), updated: now() }; putItem('note', n); bus.emit('open-note', n.id); }),
        b('plus', 'Save page as source', () => { const had = wikiSourceFor(this.art, { create: false }); wikiSourceFor(this.art); toast(had ? 'Already saved' : 'Saved as a source'); this.render(); }),
        b('link', 'Insert link to this article', () => { const E = S.editor; const sch = E.view.state.schema; const { from, to, empty } = E.view.state.selection; if (!empty) E.view.dispatch(E.view.state.tr.addMark(from, to, sch.marks.link.create({ href: this.art.url }))); else E.view.dispatch(E.view.state.tr.replaceSelectionWith(sch.text(text, [sch.marks.link.create({ href: this.art.url })]), false)); toast('Link inserted'); }),
        b('dict', 'Define', () => bus.emit('define', text)));
      document.body.append(bar); bar.style.left = Math.max(8, Math.min(r.left + r.width / 2 - bar.offsetWidth / 2, innerWidth - bar.offsetWidth - 8)) + 'px'; bar.style.top = Math.max(8, r.top - bar.offsetHeight - 8) + 'px';
    }, 10));
    scroll.addEventListener('mousedown', hide); scroll.addEventListener('scroll', hide);
    scroll.addEventListener('copy', () => { const t = cleanSel(window.getSelection().toString()); if (t) { const src = wikiSourceFor(this.art, { create: false }) || null; if (src) setCapture(src.id, t, {}); } });
  }
}
export async function searchWikipedia(q) { return providerById('wikipedia').search(q, {}, wl()); }
