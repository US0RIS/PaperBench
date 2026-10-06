// Scholarly / reference providers. Every adapter returns normalized candidates; no results are ever fabricated.
import { parseNames, uid, now, todayDate, normDOI, normISBN, stripTags, todayDate as td } from './model.js';

export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
export const serverState = { checked: false, ok: false, ai: false, desktop: false, model: '' };
export async function checkServer(force = false) {
  if (force) Object.assign(serverState, { checked: false, ok: false, ai: false, desktop: false, model: '' });
  if (serverState.checked) return serverState;
  serverState.checked = true;
  if (!location.protocol.startsWith('http')) return serverState;
  try { const r = await fetch('/api/status', { cache: 'no-store' }); if (r.ok) { const j = await r.json(); serverState.ok = true; serverState.ai = !!j.ai; serverState.model = j.model; serverState.desktop = !!j.desktop; } } catch { /* static hosting or file:// */ }
  return serverState;
}

async function http(url, { signal, headers, json = true, text = false, proxy = true, timeout = 15000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout); signal?.addEventListener('abort', () => ctl.abort());
  const go = async (u) => { const r = await fetch(u, { signal: ctl.signal, headers }); if (!r.ok) throw new ApiError(`${new URL(url).hostname} returned ${r.status}`, r.status); return text || !json ? r.text() : r.json(); };
  try {
    try { return await go(url); }
    catch (e) {
      if (e.name === 'AbortError' || e instanceof ApiError || !proxy) throw e;
      await checkServer(); if (!serverState.ok) throw new ApiError(`Could not reach ${new URL(url).hostname}. Check your connection (or, for sites that block browser requests, run the local server).`);
      const r = await fetch('/api/proxy?url=' + encodeURIComponent(url), { signal: ctl.signal }); if (!r.ok) throw new ApiError(`${new URL(url).hostname} returned ${r.status}`, r.status);
      return text || !json ? r.text() : r.json();
    }
  } catch (e) { if (e.name === 'AbortError') throw new ApiError('Request timed out or was cancelled'); throw e; } finally { clearTimeout(t); }
}
export { http };

const dparts = (y, m, d) => (y ? { 'date-parts': [[+y, ...(m ? [+m] : []), ...(m && d ? [+d] : [])]] } : undefined);
const dateFromStr = (s) => { const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s || ''); return m ? dparts(m[1], m[2], m[3]) : undefined; };
const jats = (s) => (s ? stripTags(String(s).replace(/<\/?jats:title>/g, ' ')).replace(/\s+/g, ' ').trim() : '');
const cand = (provider, kind, src, extra = {}) => ({ key: provider + ':' + (src.DOI || src.ISBN || src.URL || src.title), provider, kind, src, oaUrl: extra.oaUrl || '', abstract: src.abstract || '', cites: extra.cites, note: extra.note });
const kindFor = (type, s = {}) => (type === 'article-journal' ? 'journal' : type === 'article' ? 'preprint' : type === 'book' || type === 'chapter' ? 'book' : type === 'webpage' || type === 'entry-encyclopedia' ? 'web' : 'other');

// ---- Crossref ----------------------------------------------------------------
const CR_TYPES = { 'journal-article': 'article-journal', book: 'book', 'edited-book': 'book', monograph: 'book', 'book-chapter': 'chapter', 'proceedings-article': 'paper-conference', 'posted-content': 'article', dissertation: 'thesis', report: 'report', dataset: 'dataset', 'reference-entry': 'entry-encyclopedia' };
export function crossrefItem(m) {
  const type = CR_TYPES[m.type] || 'document';
  const s = { type, title: jats((m.title || [])[0] || ''), author: (m.author || []).map((a) => (a.family ? { family: a.family, given: a.given || '' } : { literal: a.name || '' })), issued: m.issued?.['date-parts']?.[0]?.[0] ? { 'date-parts': [m.issued['date-parts'][0].filter(Boolean)] } : undefined,
    'container-title': (m['container-title'] || [])[0], volume: m.volume, issue: m.issue, page: m.page ? String(m.page).replace(/-/g, '-') : undefined, publisher: m.publisher, DOI: m.DOI, URL: m.DOI ? 'https://doi.org/' + m.DOI : m.URL, ISBN: (m.ISBN || [])[0], abstract: jats(m.abstract), _origin: 'crossref' };
  if (m.subtitle?.[0] && s.title && !s.title.includes(m.subtitle[0])) s.title += ': ' + m.subtitle[0];
  Object.keys(s).forEach((k) => s[k] === undefined && delete s[k]);
  const oa = (m.link || []).find((l) => /pdf/.test(l['content-type'] || '') && l['intended-application'] !== 'text-mining');
  return cand('crossref', m.subtype === 'preprint' ? 'preprint' : kindFor(type), m.subtype === 'preprint' ? { ...s, type: 'article' } : s, { cites: m['is-referenced-by-count'] });
}
const crossref = {
  id: 'crossref', name: 'Crossref', kinds: 'Journal articles, books, preprints', async search(q, o) {
    const j = await http(`https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=15&select=DOI,title,subtitle,author,issued,container-title,volume,issue,page,publisher,type,subtype,URL,abstract,ISBN,is-referenced-by-count`, o);
    return (j.message?.items || []).map(crossrefItem).filter((c) => c.src.title);
  },
};
export async function lookupDOI(doi, o) {
  doi = normDOI(doi); if (!/^10\.\d{4,9}\//.test(doi)) throw new ApiError('That does not look like a DOI (expected 10.xxxx/…)');
  try { const j = await http(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, o); return crossrefItem(j.message); }
  catch (e) {
    if (e.status === 404) { try { const j = await http(`https://doi.org/${doi}`, { ...o, headers: { Accept: 'application/vnd.citationstyles.csl+json' } }); return cslJsonCand(j, 'doi.org'); } catch { throw new ApiError('DOI not found in Crossref or doi.org'); } }
    throw e;
  }
}
export function cslJsonCand(j, provider = 'import') {
  const s = { ...j, _origin: provider }; delete s.id; delete s.key; if (!s.type) s.type = 'document'; if (s['container-title-short']) delete s['container-title-short'];
  return cand(provider, kindFor(s.type), s);
}

// ---- OpenAlex ----------------------------------------------------------------
function invertedAbstract(ix) { if (!ix) return ''; const w = []; for (const [word, pos] of Object.entries(ix)) pos.forEach((p) => { w[p] = word; }); return w.join(' '); }
const openalex = {
  id: 'openalex', name: 'OpenAlex', kinds: 'Papers across all fields; open-access links', async search(q, o) {
    const j = await http(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=15&select=id,doi,display_name,publication_year,publication_date,type,authorships,primary_location,biblio,abstract_inverted_index,open_access,cited_by_count`, o);
    return (j.results || []).map((w) => {
      const src = w.primary_location?.source, srcType = src?.type;
      const type = w.type === 'preprint' || (w.type === 'article' && srcType !== 'journal') ? 'article' : w.type === 'article' ? 'article-journal' : w.type === 'book' ? 'book' : w.type === 'book-chapter' ? 'chapter' : w.type === 'dissertation' ? 'thesis' : w.type === 'dataset' ? 'dataset' : w.type === 'report' ? 'report' : 'document';
      const names = (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean);
      const s = { type, title: w.display_name, author: names.map((n) => parseNames(n)[0]), issued: dateFromStr(w.publication_date) || dparts(w.publication_year), 'container-title': src?.display_name, publisher: src?.host_organization_name, volume: w.biblio?.volume, issue: w.biblio?.issue, page: w.biblio?.first_page ? (w.biblio.last_page && w.biblio.last_page !== w.biblio.first_page ? `${w.biblio.first_page}-${w.biblio.last_page}` : w.biblio.first_page) : undefined, DOI: w.doi ? normDOI(w.doi) : undefined, abstract: invertedAbstract(w.abstract_inverted_index), _origin: 'openalex' };
      s.URL = s.DOI ? 'https://doi.org/' + s.DOI : w.id; Object.keys(s).forEach((k) => (s[k] === undefined || s[k] === null || s[k] === '') && delete s[k]);
      return cand('openalex', type === 'article' ? 'preprint' : kindFor(type), s, { oaUrl: w.open_access?.oa_url || '', cites: w.cited_by_count });
    }).filter((c) => c.src.title);
  },
};

// ---- Semantic Scholar -----------------------------------------------------------
const semantic = {
  id: 'semanticscholar', name: 'Semantic Scholar', kinds: 'Papers; citation counts; open PDFs', async search(q, o) {
    const j = await http(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=15&fields=title,authors,year,venue,abstract,externalIds,openAccessPdf,publicationTypes,journal,publicationDate,citationCount`, o);
    return (j.data || []).map((p) => {
      const types = p.publicationTypes || []; const arxivOnly = p.externalIds?.ArXiv && !p.journal?.name && !types.includes('JournalArticle');
      const type = types.includes('JournalArticle') ? 'article-journal' : types.includes('Conference') ? 'paper-conference' : types.includes('Book') ? 'book' : arxivOnly ? 'article' : p.journal?.name ? 'article-journal' : 'article';
      const s = { type, title: p.title, author: (p.authors || []).map((a) => parseNames(a.name)[0]), issued: dateFromStr(p.publicationDate) || dparts(p.year), 'container-title': p.journal?.name || p.venue || (arxivOnly ? 'arXiv' : undefined), volume: p.journal?.volume, page: p.journal?.pages ? String(p.journal.pages).replace(/--?/, '-') : undefined, DOI: p.externalIds?.DOI ? p.externalIds.DOI.toLowerCase() : undefined, abstract: p.abstract || undefined, _origin: 'semanticscholar' };
      s.URL = s.DOI ? 'https://doi.org/' + s.DOI : p.externalIds?.ArXiv ? 'https://arxiv.org/abs/' + p.externalIds.ArXiv : undefined; Object.keys(s).forEach((k) => (s[k] === undefined || s[k] === null || s[k] === '') && delete s[k]);
      return cand('semanticscholar', type === 'article' ? 'preprint' : kindFor(type), s, { oaUrl: p.openAccessPdf?.url || '', cites: p.citationCount });
    }).filter((c) => c.src.title);
  },
};

// ---- PubMed -------------------------------------------------------------------
const pubmed = {
  id: 'pubmed', name: 'PubMed', kinds: 'Biomedical literature', async search(q, o) {
    const e = await http(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=15&term=${encodeURIComponent(q)}`, o);
    const ids = e.esearchresult?.idlist || []; if (!ids.length) return [];
    const j = await http(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`, o);
    return ids.map((id) => j.result?.[id]).filter(Boolean).map((r) => {
      const doi = (r.articleids || []).find((a) => a.idtype === 'doi')?.value;
      const s = { type: 'article-journal', title: (r.title || '').replace(/\.$/, ''), author: (r.authors || []).filter((a) => a.authtype === 'Author' || !a.authtype).map((a) => { const p = a.name.split(' '); const init = p.pop(); return { family: p.join(' '), given: init.split('').join('. ') + '.' }; }), issued: dateFromStr((r.pubdate || '').replace(/(\d{4}) (\w{3}).*/, (_, y, m) => `${y}-${String(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m.toLowerCase()) + 1).padStart(2, '0')}`).replace(/^(\d{4}).*/, '$1')), 'container-title': r.fulljournalname || r.source, volume: r.volume, issue: r.issue, page: r.pages, DOI: doi, URL: doi ? 'https://doi.org/' + doi : `https://pubmed.ncbi.nlm.nih.gov/${r.uid}/`, _origin: 'pubmed', _pmid: r.uid };
      Object.keys(s).forEach((k) => (s[k] === undefined || s[k] === '') && delete s[k]);
      return cand('pubmed', 'journal', s, { note: 'Abstract loads on request' });
    });
  },
  async abstract(c, o) {
    const x = await http(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&id=${c.src._pmid}`, { ...o, text: true });
    const d = new DOMParser().parseFromString(x, 'text/xml'); return [...d.querySelectorAll('AbstractText')].map((n) => (n.getAttribute('Label') ? n.getAttribute('Label') + ': ' : '') + n.textContent).join('\n');
  },
};

// ---- arXiv --------------------------------------------------------------------
const arxiv = {
  id: 'arxiv', name: 'arXiv', kinds: 'Preprints (not peer reviewed)', async search(q, o) {
    const x = await http(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=15`, { ...o, text: true });
    const d = new DOMParser().parseFromString(x, 'text/xml');
    return [...d.querySelectorAll('entry')].map((e) => {
      const g = (t) => e.querySelector(t)?.textContent?.replace(/\s+/g, ' ').trim(); const id = (g('id') || '').replace(/^https?:\/\/arxiv.org\/abs\//, '').replace(/v\d+$/, '');
      const doi = e.getElementsByTagName('arxiv:doi')[0]?.textContent;
      const s = { type: 'article', title: g('title'), author: [...e.querySelectorAll('author > name')].map((n) => parseNames(n.textContent)[0]), issued: dateFromStr(g('published')), 'container-title': 'arXiv', genre: 'Preprint', number: id, abstract: g('summary'), DOI: doi || '10.48550/arXiv.' + id, URL: 'https://arxiv.org/abs/' + id, _origin: 'arxiv' };
      const pdf = [...e.querySelectorAll('link')].find((l) => l.getAttribute('title') === 'pdf')?.getAttribute('href');
      return cand('arxiv', 'preprint', s, { oaUrl: pdf ? pdf.replace(/^http:/, 'https:') : 'https://arxiv.org/pdf/' + id });
    });
  },
};

// ---- Books --------------------------------------------------------------------
function gbItem(v) {
  const i = v.volumeInfo || {}; const isbn = (i.industryIdentifiers || []).find((x) => x.type === 'ISBN_13')?.identifier || (i.industryIdentifiers || []).find((x) => x.type === 'ISBN_10')?.identifier;
  const s = { type: 'book', title: i.title + (i.subtitle ? ': ' + i.subtitle : ''), author: (i.authors || []).map((a) => parseNames(a)[0]), issued: dateFromStr(i.publishedDate), publisher: i.publisher, ISBN: isbn, 'number-of-pages': i.pageCount ? String(i.pageCount) : undefined, language: i.language, abstract: i.description ? stripTags(i.description) : undefined, URL: i.canonicalVolumeLink || i.infoLink, _origin: 'googlebooks' };
  Object.keys(s).forEach((k) => (s[k] === undefined || s[k] === '') && delete s[k]); return cand('googlebooks', 'book', s);
}
const books = {
  id: 'googlebooks', name: 'Google Books', kinds: 'Books', async search(q, o) { const j = await http(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=15&printType=books`, o); return (j.items || []).map(gbItem).filter((c) => c.src.title); },
};
export async function lookupISBN(isbn, o) {
  const n = normISBN(isbn); if (![10, 13].includes(n.length)) throw new ApiError('An ISBN has 10 or 13 digits');
  try { const j = await http(`https://www.googleapis.com/books/v1/volumes?q=isbn:${n}`, o); if (j.items?.length) { const c = gbItem(j.items[0]); c.src.ISBN = n; return c; } } catch (e) { if (e.name === 'AbortError') throw e; }
  const j = await http(`https://openlibrary.org/api/books?bibkeys=ISBN:${n}&format=json&jscmd=data`, o); const b = j['ISBN:' + n];
  if (!b) throw new ApiError('No book found for that ISBN');
  const s = { type: 'book', title: b.title + (b.subtitle ? ': ' + b.subtitle : ''), author: (b.authors || []).map((a) => parseNames(a.name)[0]), issued: dateFromStr((b.publish_date || '').match(/\d{4}/)?.[0]), publisher: b.publishers?.[0]?.name, ISBN: n, 'number-of-pages': b.number_of_pages ? String(b.number_of_pages) : undefined, URL: b.url, _origin: 'openlibrary' };
  Object.keys(s).forEach((k) => (s[k] === undefined || s[k] === '') && delete s[k]); return cand('openlibrary', 'book', s);
}

// ---- Wikipedia (search only; reading lives in wiki.js) ---------------------------
export const WIKI_API = (lang = 'en') => `https://${lang}.wikipedia.org/w/api.php`;
const wikipedia = {
  id: 'wikipedia', name: 'Wikipedia', kinds: 'Encyclopedia articles (orientation, not a final source)', async search(q, o, lang = 'en') {
    const j = await http(`${WIKI_API(lang)}?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=12&format=json&origin=*&srprop=snippet|wordcount`, o);
    return (j.query?.search || []).map((r) => ({ key: 'wikipedia:' + r.pageid, provider: 'wikipedia', kind: 'wikipedia', wikiTitle: r.title, src: { type: 'entry-encyclopedia', title: r.title, 'container-title': 'Wikipedia', publisher: 'Wikimedia Foundation', URL: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`, _origin: 'wikipedia', _kind: 'wikipedia' }, abstract: stripTags(r.snippet).replace(/&quot;/g, '"').replace(/&amp;/g, '&') + '…', note: `${r.wordcount.toLocaleString()} words` }));
  },
};

export const PROVIDERS = [wikipedia, crossref, openalex, semantic, pubmed, arxiv, books];
export const providerById = (id) => PROVIDERS.find((p) => p.id === id);
export async function loadAbstract(c, o) { const p = providerById(c.provider); if (p?.abstract) return p.abstract(c, o); return c.abstract; }

// ---- URL capture ----------------------------------------------------------------
const meta = (doc, ...names) => { for (const n of names) { const el = doc.querySelector(`meta[name="${n}" i], meta[property="${n}" i]`); const v = el?.getAttribute('content')?.trim(); if (v) return v; } return ''; };
const metaAll = (doc, name) => [...doc.querySelectorAll(`meta[name="${name}" i]`)].map((e) => e.getAttribute('content')?.trim()).filter(Boolean);
export function extractPageMetadata(doc, url) {
  const ld = []; doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { const j = JSON.parse(s.textContent); (Array.isArray(j) ? j : j['@graph'] || [j]).forEach((x) => ld.push(x)); } catch { /* */ } });
  const art = ld.find((x) => /Article|ScholarlyArticle|BlogPosting|NewsArticle|WebPage/.test([].concat(x['@type'] || []).join(' '))) || {};
  const authors = metaAll(doc, 'citation_author').length ? metaAll(doc, 'citation_author') : metaAll(doc, 'author').length ? metaAll(doc, 'author') : [].concat(art.author || []).map((a) => (typeof a === 'string' ? a : a.name)).filter(Boolean);
  const title = meta(doc, 'citation_title', 'dc.title', 'og:title', 'twitter:title') || art.headline || doc.querySelector('title')?.textContent?.trim() || url;
  const date = meta(doc, 'citation_publication_date', 'citation_date', 'article:published_time', 'dc.date', 'datePublished', 'date') || art.datePublished || '';
  const journal = meta(doc, 'citation_journal_title'); const doi = meta(doc, 'citation_doi', 'dc.identifier') || '';
  const site = meta(doc, 'og:site_name') || (typeof art.publisher === 'object' ? art.publisher?.name : '') || new URL(url).hostname.replace(/^www\./, '');
  const s = { type: journal ? 'article-journal' : 'webpage', title: title.replace(/\s+[|–—-]\s+.*$/, (m) => (title.length - m.length > 12 && !journal ? '' : m)), author: authors.map((a) => parseNames(a)[0]).filter(Boolean), issued: dateFromStr(date.slice(0, 10).replace(/\//g, '-')) || (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(date) ? dateFromStr(date.replace(/\//g, '-')) : undefined), 'container-title': journal || site, publisher: meta(doc, 'citation_publisher') || (journal ? undefined : site), volume: meta(doc, 'citation_volume') || undefined, issue: meta(doc, 'citation_issue') || undefined, page: meta(doc, 'citation_firstpage') ? [meta(doc, 'citation_firstpage'), meta(doc, 'citation_lastpage')].filter(Boolean).join('-') : undefined, DOI: /^10\./.test(doi.replace(/^doi:/i, '')) ? normDOI(doi) : undefined, abstract: meta(doc, 'citation_abstract', 'description', 'og:description') || undefined, URL: meta(doc, 'citation_public_url') || url, accessed: todayDate(), language: doc.documentElement.lang || undefined, _origin: 'web' };
  Object.keys(s).forEach((k) => (s[k] === undefined || s[k] === '' || (Array.isArray(s[k]) && !s[k].length)) && delete s[k]);
  return s;
}
export async function captureURL(url, { signal } = {}) {
  url = url.trim(); if (!/^https?:\/\//i.test(url)) url = 'https://' + url; new URL(url);
  const doiM = url.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\..+)$/i); if (doiM) return { candidate: await lookupDOI(decodeURIComponent(doiM[1]), { signal }), html: null };
  await checkServer();
  if (!serverState.ok) return { candidate: cand('web', 'web', { type: 'webpage', title: url, URL: url, accessed: todayDate(), _origin: 'web' }), html: null, limited: 'Reading and extracting metadata from arbitrary web pages needs the local server (run “node server.js”). Saved the URL only; complete the fields by hand.' };
  const r = await fetch('/api/fetch?url=' + encodeURIComponent(url), { signal }); if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch { /* */ } throw new ApiError(m || `Could not fetch that page (${r.status})`, r.status); }
  const j = await r.json();
  if (/pdf/i.test(j.contentType || '')) return { pdfUrl: j.finalUrl, candidate: cand('web', 'other', { type: 'report', title: url.split('/').pop() || url, URL: j.finalUrl, accessed: todayDate(), _origin: 'web' }) };
  const doc = new DOMParser().parseFromString(j.html, 'text/html'); const base = doc.createElement('base'); base.href = j.finalUrl; doc.head.prepend(base);
  const s = extractPageMetadata(doc, j.finalUrl); const html = await readableHTML(doc, j.finalUrl);
  return { candidate: cand('web', s.type === 'article-journal' ? 'journal' : 'web', s, { oaUrl: '' }), html };
}
export async function readableHTML(doc, url) {
  const { Readability } = await import('@mozilla/readability');
  const art = new Readability(doc.cloneNode(true), { keepClasses: false }).parse(); if (!art) return null;
  const safe = sanitizeHTML(art.content, url);
  return `<article><h1>${stripTags(art.title || '')}</h1>${art.byline ? `<p class="meta">${stripTags(art.byline)}</p>` : ''}${safe}</article>`;
}
export function sanitizeHTML(html, base) {
  const d = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html'); const root = d.getElementById('r');
  root.querySelectorAll('script, style, iframe, object, embed, form, link, meta, noscript, svg, video, audio, button, input').forEach((e) => e.remove());
  root.querySelectorAll('*').forEach((e) => {
    [...e.attributes].forEach((a) => { const n = a.name.toLowerCase(); if (!(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'data-page'].includes(n))) e.removeAttribute(a.name); });
    if (e.tagName === 'A') { try { const u = new URL(e.getAttribute('href') || '', base); if (/^https?:/.test(u.protocol)) { e.setAttribute('href', u.href); e.setAttribute('target', '_blank'); e.setAttribute('rel', 'noopener noreferrer'); } else e.removeAttribute('href'); } catch { e.removeAttribute('href'); } }
    if (e.tagName === 'IMG') { try { e.setAttribute('src', new URL(e.getAttribute('src') || '', base).href); e.setAttribute('loading', 'lazy'); e.setAttribute('referrerpolicy', 'no-referrer'); } catch { e.remove(); } }
  });
  return root.innerHTML;
}
export const candidateToSource = (c) => ({ ...c.src, _kind: c.kind === 'other' ? undefined : c.kind, _oa: c.oaUrl || undefined, _added: now(), accessed: c.src.accessed || (c.kind === 'web' || c.kind === 'wikipedia' ? todayDate() : undefined) });
