// Data model, helpers and defaults. Sources are stored as CSL-JSON with app fields prefixed "_".
export const uid = (p = 'x') => p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
export const now = () => Date.now();

export const SOURCE_TYPES = [
  ['article-journal', 'Journal article'], ['article', 'Preprint / article'], ['book', 'Book'], ['chapter', 'Book chapter'],
  ['paper-conference', 'Conference paper'], ['thesis', 'Thesis'], ['report', 'Report'], ['webpage', 'Web page'],
  ['entry-encyclopedia', 'Encyclopedia entry'], ['article-newspaper', 'Newspaper article'], ['article-magazine', 'Magazine article'],
  ['dataset', 'Dataset'], ['graphic', 'Image'], ['motion_picture', 'Video'], ['document', 'Document'], ['post-weblog', 'Blog post'],
];
export const typeLabel = (t) => (SOURCE_TYPES.find((x) => x[0] === t) || [0, 'Document'])[1];

export function kindOf(s) {
  if (s._kind) return s._kind;
  if (s._origin === 'wikipedia') return 'wikipedia';
  if (s.type === 'article' || /^10\.48550\//.test(s.DOI || '') || s._origin === 'arxiv') return 'preprint';
  if (s.type === 'article-journal') return 'journal';
  if (s.type === 'book' || s.type === 'chapter') return 'book';
  if (s.type === 'webpage' || s.type === 'post-weblog') return 'web';
  return 'other';
}
export const KIND_LABEL = { journal: 'Journal article', preprint: 'Preprint', book: 'Book', wikipedia: 'Wikipedia', web: 'Web page', other: 'Other' };
export const KIND_HINT = {
  journal: 'Published in a journal. Indexes do not verify peer review; check the journal.',
  preprint: 'Not peer reviewed. Check whether a published version exists.',
  book: 'Book or book chapter.',
  wikipedia: 'Encyclopedia entry. Useful for orientation; follow its references to stronger sources.',
  web: 'Web page.', other: 'Other source type.',
};

export function parseNames(str) {
  if (!str) return [];
  return String(str).split(/\s*(?:;|\n|\band\b|&)\s*/i).map((s) => s.trim()).filter(Boolean).map((n) => {
    if (n.includes(',')) { const [f, ...g] = n.split(','); return { family: f.trim(), given: g.join(',').trim() }; }
    const parts = n.split(/\s+/);
    if (parts.length === 1) return { literal: n };
    return { family: parts.pop(), given: parts.join(' ') };
  });
}
export const namesToString = (arr = []) => arr.map((a) => (a.literal ? a.literal : [a.family, a.given].filter(Boolean).join(', '))).join('; ');
export const namesDisplay = (arr = []) => arr.map((a) => a.literal || [a.given, a.family].filter(Boolean).join(' ')).join(', ');
export const firstFamily = (s) => { const a = (s.author || s.editor || [])[0]; return a ? (a.family || a.literal || '') : ''; };

export function parseDate(str) {
  if (!str) return undefined;
  const m = String(str).trim().match(/^(\d{4})(?:[-/](\d{1,2}))?(?:[-/](\d{1,2}))?$/);
  if (m) return { 'date-parts': [[+m[1], ...(m[2] ? [+m[2]] : []), ...(m[3] ? [+m[3]] : [])]] };
  const d = new Date(str);
  if (!isNaN(d)) return { 'date-parts': [[d.getFullYear(), d.getMonth() + 1, d.getDate()]] };
  return { literal: String(str) };
}
export const dateToString = (d) => (!d ? '' : d.literal ? d.literal : (d['date-parts']?.[0] || []).map((x, i) => (i ? String(x).padStart(2, '0') : x)).join('-'));
export const yearOf = (s) => (s.issued?.['date-parts']?.[0]?.[0]) || (s.issued?.literal?.match(/\d{4}/) || [''])[0] || '';
export const todayDate = () => { const d = new Date(); return { 'date-parts': [[d.getFullYear(), d.getMonth() + 1, d.getDate()]] }; };

export function newSource(over = {}) {
  return { id: uid('src'), type: 'article-journal', title: '', author: [], _tags: [], _collections: [], _fav: false, _role: '', _added: now(), ...over };
}
export function toCSL(s) {
  const o = {};
  for (const k in s) if (k[0] !== '_' && s[k] !== '' && s[k] != null && !(Array.isArray(s[k]) && !s[k].length)) o[k] = s[k];
  if (!o.author && !o.editor && s.type === 'webpage' && s['container-title']) o.author = [{ literal: s['container-title'] }];
  return o;
}
export const normTitle = (t = '') => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const normDOI = (d = '') => d.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '').trim();
export const normISBN = (i = '') => i.replace(/[^0-9Xx]/g, '').toUpperCase();
export const normURL = (u = '') => { try { const x = new URL(u); return (x.host + x.pathname).replace(/\/$/, '').toLowerCase().replace(/^www\./, ''); } catch { return u.toLowerCase(); } };

function jaccard(a, b) { const A = new Set(a.split(' ')), B = new Set(b.split(' ')); let i = 0; A.forEach((x) => B.has(x) && i++); return i / (A.size + B.size - i || 1); }
export function duplicateOf(cand, sources, ignoreId) {
  const list = sources instanceof Map ? [...sources.values()] : sources;
  for (const s of list) {
    if (s.id === ignoreId || s.id === cand.id) continue;
    if (cand.DOI && s.DOI && normDOI(cand.DOI) === normDOI(s.DOI)) return { source: s, reason: 'Same DOI' };
    if (cand.ISBN && s.ISBN && normISBN(cand.ISBN) === normISBN(s.ISBN)) return { source: s, reason: 'Same ISBN' };
    if (cand.URL && s.URL && normURL(cand.URL) === normURL(s.URL) && cand.type !== 'chapter') return { source: s, reason: 'Same URL' };
    const ta = normTitle(cand.title), tb = normTitle(s.title);
    if (ta && tb && (ta === tb || (ta.length > 15 && jaccard(ta, tb) > 0.85)) && (yearOf(cand) === yearOf(s) || !yearOf(cand) || !yearOf(s)) &&
      (firstFamily(cand).toLowerCase() === firstFamily(s).toLowerCase() || !firstFamily(cand) || !firstFamily(s))) return { source: s, reason: 'Similar title, author and year' };
  }
  return null;
}
export function findDuplicateGroups(sources) {
  const list = [...sources.values()], seen = new Set(), groups = [];
  for (const s of list) {
    if (seen.has(s.id)) continue;
    const g = [s];
    for (const t of list) if (t.id !== s.id && !seen.has(t.id) && duplicateOf(s, [t])) g.push(t);
    if (g.length > 1) { g.forEach((x) => seen.add(x.id)); groups.push(g); }
  }
  return groups;
}

// Metadata completeness. severity: 'error' blocks a usable reference, 'warn' is recommended.
export function checkMetadata(s) {
  const out = [], has = (k) => s[k] != null && s[k] !== '' && !(Array.isArray(s[k]) && !s[k].length);
  const need = (k, label, sev = 'error') => { if (!has(k)) out.push({ sev, field: k, msg: `Missing ${label}` }); };
  need('title', 'title');
  if (!has('author') && !has('editor') && s.type !== 'webpage') out.push({ sev: 'error', field: 'author', msg: 'Missing author' });
  if (!has('issued')) out.push({ sev: s.type === 'webpage' ? 'warn' : 'error', field: 'issued', msg: 'Missing publication date' });
  switch (s.type) {
    case 'article-journal': need('container-title', 'journal title'); if (!has('volume')) out.push({ sev: 'warn', field: 'volume', msg: 'Missing volume' }); if (!has('page') && !has('DOI')) out.push({ sev: 'warn', field: 'page', msg: 'Missing pages or DOI' }); break;
    case 'book': need('publisher', 'publisher'); break;
    case 'chapter': need('container-title', 'book title'); need('publisher', 'publisher'); if (!has('page')) out.push({ sev: 'warn', field: 'page', msg: 'Missing page range' }); break;
    case 'webpage': case 'post-weblog': case 'entry-encyclopedia': need('URL', 'URL'); if (!has('accessed')) out.push({ sev: 'warn', field: 'accessed', msg: 'Missing access date' }); break;
    case 'report': need('publisher', 'institution / publisher'); break;
    case 'paper-conference': need('container-title', 'proceedings title'); break;
    case 'thesis': need('publisher', 'university'); break;
    case 'dataset': need('publisher', 'publisher / repository'); break;
    case 'article': if (!has('DOI') && !has('URL')) out.push({ sev: 'warn', field: 'URL', msg: 'Missing URL or DOI' }); break;
  }
  return out;
}

export const CITATION_STYLES = [
  { id: 'apa', name: 'APA 7', file: 'apa' },
  { id: 'mla', name: 'MLA 9', file: 'modern-language-association' },
  { id: 'chicago-nb', name: 'Chicago, Notes and Bibliography', file: 'chicago-notes-bibliography' },
  { id: 'chicago-ad', name: 'Chicago, Author-Date', file: 'chicago-author-date' },
  { id: 'harvard', name: 'Harvard (Cite Them Right)', file: 'harvard-cite-them-right' },
  { id: 'ieee', name: 'IEEE', file: 'ieee' },
];

export const EXPORT_PRESETS = {
  apa: { name: 'APA 7 student paper', pageSize: 'letter', margin: 1, font: 'Times New Roman', size: 12, line: 2, paraSpace: 0, pageNumbers: true, titlePage: true, runningHeader: 'title', indent: 0.5, headingStyle: 'apa' },
  mla: { name: 'MLA 9', pageSize: 'letter', margin: 1, font: 'Times New Roman', size: 12, line: 2, paraSpace: 0, pageNumbers: true, titlePage: false, runningHeader: 'author', indent: 0.5, headingStyle: 'mla' },
  chicago: { name: 'Chicago', pageSize: 'letter', margin: 1, font: 'Times New Roman', size: 12, line: 2, paraSpace: 0, pageNumbers: true, titlePage: true, runningHeader: 'none', indent: 0.5, headingStyle: 'chicago' },
  generic: { name: 'Generic manuscript', pageSize: 'a4', margin: 1, font: 'Georgia', size: 11, line: 1.5, paraSpace: 6, pageNumbers: true, titlePage: false, runningHeader: 'none', indent: 0, headingStyle: 'generic' },
};

export function defaultSettings() {
  return {
    title: '', author: '', institution: '', course: '', instructor: '', date: '',
    citationStyle: 'apa', language: 'en-US', spell: 'en-US', targetWords: 0, sectionTargets: {},
    noteMode: 'footnote', numberHeadings: false, includeUncited: false,
    exportPreset: 'apa', export: { ...EXPORT_PRESETS.apa },
    theme: 'auto', evidenceMode: false, customStyles: {},
  };
}

export function newProject(name = 'Untitled paper') { return { id: uid('prj'), name, settings: { ...defaultSettings(), title: name === 'Untitled paper' ? '' : name }, createdAt: now(), updatedAt: now() }; }

export const NOTE_KINDS = { quotation: 'Quotation', paraphrase: 'Paraphrase', idea: 'Idea', question: 'Question' };
export const REL_TYPES = { supports: 'supports', contradicts: 'contradicts', cites: 'cites', responds: 'responds to', background: 'is background for' };

export const wordCount = (t = '') => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
export const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; };
export const stripTags = (h = '') => h.replace(/<[^>]+>/g, '');
export const shortCite = (s) => { const f = firstFamily(s) || (s.title || 'Untitled').slice(0, 24); const n = (s.author || []).length; return `${f}${n > 2 ? ' et al.' : n === 2 ? ' & ' + ((s.author[1].family) || s.author[1].literal || '') : ''}${yearOf(s) ? ' ' + yearOf(s) : ''}`; };
