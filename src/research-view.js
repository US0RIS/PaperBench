// Dedicated scholarly research workspace. Searches paper indexes in parallel and funnels sources into the endless Notes page.
import { S, addSource, pushRecent } from './state.js';
import { h, icon, clear, menu, toast, bus, segmented } from './ui.js';
import { PROVIDERS, providerById, candidateToSource, loadAbstract } from './research.js';
import { KIND_LABEL, namesDisplay, yearOf } from './model.js';

const PAPER_PROVIDER_IDS = ['openalex', 'crossref', 'semanticscholar', 'pubmed', 'arxiv'];
const DEFAULT_PROVIDERS = ['openalex', 'crossref', 'semanticscholar', 'pubmed', 'arxiv'];
const providers = () => PAPER_PROVIDER_IDS.map(providerById).filter(Boolean);
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function resultKey(c) {
  const s = c?.src || {};
  if (s.DOI) {
    const doi = String(s.DOI).toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
    const axDoi = doi.match(/^10\.48550\/arxiv\.(.+)$/i);
    if (axDoi) return 'arxiv:' + axDoi[1].replace(/v\d+$/, '').toLowerCase();
    return 'doi:' + doi;
  }
  const ax = String(s.URL || '').match(/arxiv\.org\/(?:abs|pdf)\/([^?#/]+?)(?:\.pdf)?$/i);
  if (ax) return 'arxiv:' + ax[1].replace(/v\d+$/, '').toLowerCase();
  return 'title:' + norm(s.title) + ':' + (yearOf(s) || '');
}

function richerSource(a, b) {
  const out = { ...a };
  Object.entries(b || {}).forEach(([k, v]) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return;
    if (out[k] == null || out[k] === '' || (Array.isArray(out[k]) && !out[k].length)) out[k] = v;
  });
  if ((b?.abstract || '').length > (out.abstract || '').length) out.abstract = b.abstract;
  return out;
}

function combinedResults(states) {
  const byKey = new Map();
  for (const [pid, st] of Object.entries(states)) {
    if (st.status !== 'ok') continue;
    (st.items || []).forEach((c, rank) => {
      const k = resultKey(c);
      const old = byKey.get(k);
      if (!old) {
        byKey.set(k, {
          ...c,
          src: { ...c.src },
          providers: [pid],
          score: 1 / (rank + 1),
          cites: c.cites ?? null,
          abstractCandidate: c.provider === 'pubmed' ? c : null,
        });
        return;
      }
      old.providers.push(pid);
      old.score += 1 / (rank + 1);
      old.src = richerSource(old.src, c.src);
      if ((c.abstract || '').length > (old.abstract || '').length) old.abstract = c.abstract;
      if (!old.abstractCandidate && c.provider === 'pubmed') old.abstractCandidate = c;
      if (!old.oaUrl && c.oaUrl) old.oaUrl = c.oaUrl;
      if (c.cites != null) old.cites = Math.max(old.cites ?? 0, c.cites);
    });
  }
  return [...byKey.values()];
}

function savedMatch(c) {
  const s = c.src || {};
  const doi = s.DOI?.toLowerCase();
  const title = norm(s.title);
  const y = yearOf(s);
  return [...S.sources.values()].find((x) =>
    (doi && x.DOI && x.DOI.toLowerCase() === doi) ||
    (title && norm(x.title) === title && (!y || !yearOf(x) || yearOf(x) === y))
  ) || null;
}

export function mountResearchView(host) {
  let q = '';
  let selected = (() => {
    try {
      const v = JSON.parse(localStorage.getItem('research-workspace-providers') || 'null');
      return Array.isArray(v) && v.some((x) => PAPER_PROVIDER_IDS.includes(x)) ? v.filter((x) => PAPER_PROVIDER_IDS.includes(x)) : [...DEFAULT_PROVIDERS];
    } catch { return [...DEFAULT_PROVIDERS]; }
  })();
  let sort = 'best';
  let states = {};
  let ctl = null;
  const expanded = new Set();
  const addedToNotes = new Set();

  const input = h('input.input.research-q', {
    type: 'search',
    placeholder: 'Search papers about anything',
    'aria-label': 'Search scholarly papers',
    onkeydown: (e) => { if (e.key === 'Enter') runSearch(e.target.value); },
    oninput: (e) => { q = e.target.value; },
  });
  const providerBtn = h('button.btn.sm.ghost', { 'aria-haspopup': 'menu' });
  const searchBtn = h('button.btn.btn-primary', { onclick: () => runSearch(input.value) }, icon('search', 15), 'Search');
  const status = h('div.research-status.muted', { role: 'status', 'aria-live': 'polite' });
  const results = h('div.research-results');
  const recent = h('div.research-recents');

  function providerMenu() {
    menu(providerBtn, providers().map((p) => ({
      label: p.name,
      sub: p.kinds,
      checked: selected.includes(p.id),
      action: () => {
        selected = selected.includes(p.id) ? selected.filter((x) => x !== p.id) : [...selected, p.id];
        if (!selected.length) selected = [p.id];
        localStorage.setItem('research-workspace-providers', JSON.stringify(selected));
        drawProviderButton();
      },
    })), { label: 'Paper indexes to search' });
  }
  providerBtn.onclick = providerMenu;

  function drawProviderButton() {
    clear(providerBtn).append(icon('filter', 13), selected.length === PAPER_PROVIDER_IDS.length ? 'All paper indexes' : `${selected.length} index${selected.length === 1 ? '' : 'es'}`, icon('down', 12));
  }

  const sortControl = segmented([['best', 'Best match'], ['newest', 'Newest'], ['cited', 'Most cited']], sort, (v) => {
    sort = v;
    drawResults();
  }, 'Sort papers');

  const hero = h('div.research-hero',
    h('div.research-eyebrow', 'SCHOLARLY SEARCH'),
    h('h1', 'Research'),
    h('p', 'Search broadly across scholarly literature, then send useful papers straight into your Notes as linked sources.'),
    h('div.research-searchbar', input, searchBtn),
    h('div.research-controls', providerBtn, h('span.grow'), sortControl),
    status,
  );
  const inner = h('div.research-view-inner', hero, recent, results);
  const scroll = h('div.research-view-scroll', inner);
  clear(host).append(scroll);
  drawProviderButton();
  drawEmpty();

  function drawEmpty() {
    clear(results);
    const searches = (S.recents?.searches || []).filter((x) => x.kind === 'research').slice(0, 8);
    clear(recent);
    if (searches.length) {
      recent.append(h('div.research-recent-row',
        h('span.research-recent-label', 'Recent'),
        ...searches.map((s) => h('button.chip', { onclick: () => { input.value = s.label; runSearch(s.label); } }, s.label)),
      ));
    }
    results.append(h('div.research-empty',
      h('div.research-empty-icon', icon('search', 20)),
      h('h2', 'Search the literature'),
      h('p', 'Try a topic, question, method, person, organism, case, technology, historical event—anything. PaperBench searches several scholarly indexes at once.'),
    ));
    status.textContent = '';
  }

  async function runSearch(value) {
    q = String(value || '').trim();
    input.value = q;
    if (!q) { drawEmpty(); input.focus(); return; }
    ctl?.abort();
    ctl = new AbortController();
    pushRecent('searches', { id: 'q:' + q, label: q, kind: 'research' });
    states = {};
    selected.forEach((id) => { states[id] = { status: 'loading', items: [] }; });
    clear(recent);
    drawResults();

    selected.forEach((id) => {
      const p = providerById(id);
      if (!p) return;
      p.search(q, { signal: ctl.signal }, (S.settings.language || 'en').slice(0, 2))
        .then((items) => { states[id] = { status: 'ok', items }; })
        .catch((e) => {
          if (ctl?.signal.aborted) return;
          states[id] = { status: 'error', items: [], error: e.message };
        })
        .finally(() => { if (!ctl?.signal.aborted) drawResults(); });
    });
  }

  function sorted(items) {
    return [...items].sort((a, b) => {
      if (sort === 'newest') return (+yearOf(b.src) || 0) - (+yearOf(a.src) || 0) || (b.score || 0) - (a.score || 0);
      if (sort === 'cited') return (b.cites || 0) - (a.cites || 0) || (b.score || 0) - (a.score || 0);
      return (b.score || 0) - (a.score || 0) || (b.cites || 0) - (a.cites || 0);
    });
  }

  function drawResults() {
    const all = sorted(combinedResults(states));
    const loading = Object.values(states).filter((x) => x.status === 'loading').length;
    const errors = Object.entries(states).filter(([, x]) => x.status === 'error');
    clear(results);
    if (loading && !all.length) {
      results.append(h('div.research-loading',
        h('div.research-loading-line'),
        h('div.research-loading-line.short'),
        h('div.research-loading-line'),
      ));
    }
    all.forEach((c) => results.append(resultCard(c)));
    if (!loading && !all.length && Object.keys(states).length) {
      results.append(h('div.research-empty', h('h2', 'No papers found'), h('p', 'Try broader wording or turn on another paper index.')));
    }
    const done = Object.values(states).filter((x) => x.status !== 'loading').length;
    status.textContent = Object.keys(states).length
      ? loading
        ? `Searching ${selected.length} paper indexes… ${all.length ? all.length + ' unique papers so far' : ''}`
        : `${all.length} unique paper${all.length === 1 ? '' : 's'} across ${done} index${done === 1 ? '' : 'es'}${errors.length ? ' · ' + errors.length + ' unavailable' : ''}`
      : '';
    if (errors.length && !loading) {
      results.append(h('details.research-errors',
        h('summary', `${errors.length} search source${errors.length === 1 ? '' : 's'} unavailable`),
        ...errors.map(([id, e]) => h('div', h('b', providerById(id)?.name || id), ': ', e.error)),
      ));
    }
  }

  function resultCard(c) {
    const k = resultKey(c);
    const s = c.src;
    const saved = savedMatch(c);
    const isOpen = expanded.has(k);
    const sourceNames = c.providers.map((id) => providerById(id)?.name || id);
    const meta = [namesDisplay(s.author), yearOf(s), s['container-title']].filter(Boolean).join(' · ');
    const card = h('article.research-card');
    const title = h('button.research-card-title', { onclick: () => toggleAbstract(c) }, s.title || 'Untitled');
    const abstract = h('div.research-card-abstract', { hidden: !isOpen },
      c.abstract || s.abstract || (c.provider === 'pubmed' ? 'Loading abstract…' : 'No abstract available from these indexes.')
    );
    const addBtn = h('button.btn.btn-primary.sm', {
      disabled: addedToNotes.has(k),
      onclick: () => addPaperToNotes(c, addBtn, k),
    }, icon(addedToNotes.has(k) ? 'check' : 'note', 13), addedToNotes.has(k) ? 'Added to notes' : 'Add to notes');

    card.append(
      h('div.research-card-top',
        h('div.research-card-kind', KIND_LABEL[c.kind] || 'Paper'),
        h('div.research-card-badges',
          c.oaUrl ? h('span.tag.sm', 'Open access') : null,
          c.cites != null ? h('span.tag.sm', `${c.cites.toLocaleString()} citations`) : null,
        ),
      ),
      title,
      h('div.research-card-meta', meta || sourceNames.join(' · ')),
      h('div.research-card-indexes', sourceNames.map((n) => h('span', n))),
      abstract,
      h('div.research-card-actions',
        addBtn,
        saved
          ? h('button.btn.sm.ghost', { onclick: () => bus.emit('open-source-detail', saved.id) }, icon('check', 13), 'Saved')
          : h('button.btn.sm.ghost', { onclick: (e) => savePaper(c, e.currentTarget) }, icon('library', 13), 'Save source'),
        (c.oaUrl || s.URL) ? h('button.btn.sm.ghost', { onclick: () => window.open(c.oaUrl || s.URL, '_blank', 'noopener') }, icon('external', 13), c.oaUrl ? 'Open full text' : 'Open record') : null,
        h('span.grow'),
        h('button.icon-btn.sm', { 'aria-label': isOpen ? 'Hide abstract' : 'Show abstract', onclick: () => toggleAbstract(c) }, icon(isOpen ? 'up' : 'down', 14)),
      ),
    );
    return card;
  }

  async function toggleAbstract(c) {
    const k = resultKey(c);
    if (expanded.has(k)) { expanded.delete(k); drawResults(); return; }
    expanded.add(k);
    if (!c.abstract && !c.src.abstract && c.abstractCandidate) {
      drawResults();
      try {
        c.abstract = await loadAbstract(c.abstractCandidate, { signal: ctl?.signal });
        if (c.abstract) c.src.abstract = c.abstract;
      } catch { /* leave the metadata-only message */ }
    }
    drawResults();
  }

  function ensureSaved(c) {
    const before = savedMatch(c);
    if (before) return { source: before, duplicate: true };
    return addSource(candidateToSource(c), { quiet: true });
  }

  function savePaper(c, button) {
    const r = ensureSaved(c);
    clear(button).append(icon('check', 13), r.duplicate ? 'Already saved' : 'Saved');
    button.disabled = true;
    toast(r.duplicate ? 'Already in Sources' : 'Saved to Sources');
  }

  function addPaperToNotes(c, button, k) {
    const r = ensureSaved(c);
    const abstract = c.abstract || c.src.abstract || '';
    bus.emit('research-add-to-notes', { sourceId: r.source.id, abstract });
    addedToNotes.add(k);
    clear(button).append(icon('check', 13), 'Added to notes');
    button.disabled = true;
  }

  const onSources = () => { if (q) drawResults(); };
  const offSources = bus.on('sources', onSources);

  return {
    focus() { input.focus(); input.select(); },
    setQuery(value, { search = false } = {}) {
      q = String(value || '');
      input.value = q;
      if (search && q.trim()) runSearch(q);
      else input.focus();
    },
    search: runSearch,
    destroy() { ctl?.abort(); offSources(); },
  };
}
