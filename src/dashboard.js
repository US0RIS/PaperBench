// Dashboard: stats for every paper in this browser, and the quickest way to switch between them.
import * as DB from './db.js';
import { S, flushDoc } from './state.js';
import { h, icon, clear, menu, bus, ago, confirmDialog, toast, $ } from './ui.js';
import { wordCount, CITATION_STYLES } from './model.js';

function walk(n, f) { f(n); (n.content || []).forEach((c) => walk(c, f)); }
export function summarizeDoc(json) {
  const s = { words: 0, citations: 0, notes: 0, figures: 0, tables: 0, equations: 0, cited: new Set(), claims: 0 };
  if (!json) return s;
  (function go(n) {
    if (n.type === 'callout' || (n.type === 'heading' && n.attrs?.planning)) return;
    if (n.type === 'text') { s.words += wordCount(n.text || ''); if (n.marks?.some((m) => m.type === 'claim')) s.claims++; }
    else if (n.type === 'citation') { s.citations++; (n.attrs?.items || []).forEach((i) => s.cited.add(i.sourceId)); }
    else if (n.type === 'footnote') { s.notes++; walk({ content: n.attrs?.content || [] }, (c) => { if (c.type === 'citation') { s.citations++; (c.attrs?.items || []).forEach((i) => s.cited.add(i.sourceId)); } }); }
    else if (n.type === 'figure') s.figures++; else if (n.type === 'table_block') s.tables++; else if (n.type === 'math_block') s.equations++;
    (n.content || []).forEach((c) => go(c));
  })({ type: 'doc', content: (json.content || []).slice(3) });
  return s;
}
export async function loadSummaries() {
  await flushDoc();
  const [projects, docs, items, kv] = await Promise.all([DB.listProjects(), DB.allDocs(), DB.allItems(), DB.allKV()]);
  const docBy = new Map(docs.map((d) => [d.projectId, d])); const kvBy = new Map(kv.map((k) => [k.key, k.value]));
  const counts = new Map(); items.forEach((it) => { const pid = it.key.split(':')[0]; const c = counts.get(pid) || {}; c[it.kind] = (c[it.kind] || 0) + 1; counts.set(pid, c); });
  const rows = projects.map((p) => {
    const d = docBy.get(p.id); const sum = summarizeDoc(d?.json); const c = counts.get(p.id) || {}; const nb = kvBy.get('notebook:' + p.id); const log = kvBy.get('wordlog:' + p.id) || {};
    let nbWords = 0; if (nb?.json) walk(nb.json, (n) => { if (n.type === 'text') nbWords += wordCount(n.text); });
    const comments = items.filter((it) => it.key.startsWith(p.id + ':comment:') && !it.data.resolved).length;
    return { id: p.id, name: p.settings?.title || p.name || 'Untitled', author: p.settings?.author, course: p.settings?.course, style: CITATION_STYLES.find((x) => x.id === p.settings?.citationStyle)?.name || p.settings?.citationStyle, target: p.settings?.targetWords || 0, ...sum, cited: sum.cited.size, sources: c.source || 0, notes: c.note || 0, highlights: c.highlight || 0, nbWords, comments, edited: Math.max(d?.updatedAt || 0, p.updatedAt || 0, nb?.updatedAt || 0), log };
  });
  return rows;
}
function dailyNet(rows, days = 14) {
  const out = []; const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i); const key = d.toISOString().slice(0, 10); let net = 0;
    rows.forEach((r) => { const keys = Object.keys(r.log).sort(); if (!keys.length) return; const prevKeys = keys.filter((k) => k < key); if (r.log[key] != null) net += r.log[key] - (prevKeys.length ? r.log[prevKeys[prevKeys.length - 1]] : r.log[key]); });
    out.push({ key, label: d.toLocaleDateString(undefined, { weekday: 'short' }), net });
  }
  return out;
}
const num = (n) => n.toLocaleString();
export async function renderDashboard(root, { open, create, importBackup, backup, remove }) {
  clear(root).append(h('p.muted.pad', 'Loading your papers…'));
  const rows = await loadSummaries(); clear(root);
  const sort = renderDashboard.sort || (renderDashboard.sort = { key: 'edited', dir: -1 });
  const tot = rows.reduce((a, r) => ({ words: a.words + r.words, sources: a.sources + r.sources, citations: a.citations + r.citations, nb: a.nb + r.nbWords }), { words: 0, sources: 0, citations: 0, nb: 0 });
  const series = dailyNet(rows); const max = Math.max(1, ...series.map((x) => Math.abs(x.net))); const week = series.slice(-7).reduce((a, x) => a + x.net, 0);
  const stat = (n, l, sub) => h('div.d-stat', h('div.d-n', n), h('div.d-l', l), sub && h('div.d-s', sub));
  const chart = h('div.d-chart', { role: 'img', 'aria-label': 'Net words added per day over the last two weeks: ' + series.map((x) => `${x.label} ${x.net}`).join(', ') }, series.map((x) => h('div.d-bar', { title: `${x.key}: ${x.net >= 0 ? '+' : ''}${num(x.net)} words` }, h('div.d-bar-i' + (x.net < 0 ? '.neg' : '') + (x.net === 0 ? '.zero' : ''), { style: { height: Math.max(3, Math.abs(x.net) / max * 100) + '%' } }), h('span.d-bar-l', x.label.slice(0, 1)))));
  root.append(h('div.dash',
    h('div.d-head', h('div', h('h1', 'Papers'), h('p.muted', `${rows.length} paper${rows.length === 1 ? '' : 's'} in this browser. Everything stays on this device.`)), h('div.row', h('button.btn', { onclick: importBackup }, icon('upload', 14), 'Restore backup'), h('button.btn.btn-primary', { onclick: create }, icon('plus', 14), 'New paper'))),
    h('div.d-stats', stat(num(tot.words), 'words across papers'), stat(num(tot.sources), 'sources in libraries', `${num(tot.citations)} citations placed`), stat(num(tot.nb), 'words in notebooks'), h('div.d-stat.chart', h('div.d-l', `Net words per day · ${week >= 0 ? '+' : ''}${num(week)} this week`), chart)),
    h('div.d-table', h('div.d-row.d-hd', ...[['name', 'Paper'], ['words', 'Progress'], ['sources', 'Sources'], ['citations', 'Citations'], ['nbWords', 'Notebook'], ['edited', 'Edited']].map(([k, l]) => h('button.d-th', { title: 'Sort by ' + l.toLowerCase(), onclick: () => { sort.dir = sort.key === k ? -sort.dir : (k === 'name' ? 1 : -1); sort.key = k; renderDashboard(root, arguments[1]); } }, l, sort.key === k ? icon(sort.dir > 0 ? 'up' : 'down', 12) : null)), h('span')),
      ...[...rows].sort((a, b) => (typeof a[sort.key] === 'string' ? a[sort.key].localeCompare(b[sort.key]) : a[sort.key] - b[sort.key]) * sort.dir).map((r) => {
        const cur = r.id === S.id; const pct = r.target ? Math.min(100, r.words / r.target * 100) : 0;
        const row = h('div.d-row.d-data' + (cur ? '.current' : ''), { 'data-id': r.id, onclick: (e) => { if (!e.target.closest('.d-more, .d-open')) open(r.id, 'paper'); } },
          h('div.d-c.d-title', h('button.d-open', { onclick: () => open(r.id, 'paper') }, h('span.d-name', r.name), cur ? h('span.d-cur', 'open') : null), h('div.d-meta', [r.author, r.course, r.style].filter(Boolean).join(' · ') || ' ')),
          h('div.d-c', h('div.d-words', num(r.words), r.target ? h('span.muted', ` / ${num(r.target)}`) : h('span.muted', ' words')), r.target ? h('div.prog', { role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Progress to target' }, h('div.prog-b', { style: { width: pct + '%' } })) : h('div.d-meta', 'No target set')),
          h('div.d-c', h('div', num(r.sources)), h('div.d-meta', r.sources ? `${r.cited} cited` : 'none yet')),
          h('div.d-c', h('div', num(r.citations)), h('div.d-meta', [r.figures && `${r.figures} fig`, r.tables && `${r.tables} tbl`, r.equations && `${r.equations} eq`].filter(Boolean).join(' · ') || ' ')),
          h('div.d-c', h('div', r.nbWords ? num(r.nbWords) : '0'), h('div.d-meta', r.notes + r.highlights ? `${r.notes} notes, ${r.highlights} highlights` : ' ')),
          h('div.d-c', h('div', r.edited ? ago(r.edited) : 'never'), h('div.d-meta', r.comments ? `${r.comments} open comment${r.comments > 1 ? 's' : ''}` : ' ')),
          h('button.icon-btn.d-more', { 'aria-label': 'Actions for ' + r.name, onclick: (e) => menu(e.currentTarget, [{ label: 'Open paper', icon: 'pencil', action: () => open(r.id, 'paper') }, { label: 'Open notebook', icon: 'note', action: () => open(r.id, 'notes') }, { divider: true }, { label: 'Back up to file', icon: 'download', action: () => backup(r.id) }, { label: 'Delete…', icon: 'trash', action: () => remove(r.id, r.name) }], { placement: 'bottom-end', label: 'Paper actions' }) }, icon('more')));
        return row; })),
    !rows.length && h('p.empty-s', 'No papers yet.')));
}
