// Popover/dialog editors: citations, footnotes, math, links, figures, tables, cross-references, special characters.
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { Node as PMNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import { S, refreshDerived } from './state.js';
import { schema, fnSchema } from './schema.js';
import { h, icon, popover, dialog, clear, $, $$, segmented, field, toast, fileDialog } from './ui.js';
import { shortCite, namesDisplay, yearOf, typeLabel, checkMetadata, uid, debounce } from './model.js';
import { previewCitation, listStyles, isNoteStyle } from './csl.js';
import { renderMath } from './nodeviews.js';
import { setLink, linkAt } from './commands.js';

const ed = () => S.editor;
const LOCATORS = [['page', 'Page'], ['chapter', 'Chapter'], ['section', 'Section'], ['paragraph', 'Paragraph'], ['figure', 'Figure'], ['table', 'Table'], ['line', 'Line'], ['verse', 'Verse'], ['volume', 'Volume'], ['note', 'Note']];

// ---- source picker (multi-select, optional locators) ----------------------------
export function pickSources({ title = 'Insert citation', multi = true, locators = true, confirm = 'Insert', initial = [], showMode = false, hint } = {}) {
  return new Promise((resolve) => {
    const chosen = new Map(initial.map((i) => [i.sourceId, { ...i }]));
    let mode = 'parenthetical';
    const q = h('input.input', { type: 'search', placeholder: 'Search your library by title, author, year or tag', 'aria-label': 'Search library', autofocus: true });
    const list = h('div.pick-list', { role: 'listbox', 'aria-multiselectable': String(multi) });
    const sel = h('div.pick-sel');
    const used = new Set(S.derived?.used || []);
    const renderList = () => {
      clear(list); const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      const arr = [...S.sources.values()].filter((s) => { const hay = `${s.title} ${namesDisplay(s.author)} ${yearOf(s)} ${(s._tags || []).join(' ')}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
        .sort((a, b) => (used.has(b.id) - used.has(a.id)) || b._fav - a._fav || b._added - a._added);
      if (!arr.length) list.append(h('p.empty-s', S.sources.size ? 'No matching sources.' : 'Your library is empty. Add a source first.'));
      arr.forEach((s) => list.append(h('button.pick-it' + (chosen.has(s.id) ? '.on' : ''), { role: 'option', 'aria-selected': String(chosen.has(s.id)), onclick: () => { if (chosen.has(s.id)) chosen.delete(s.id); else { if (!multi) chosen.clear(); chosen.set(s.id, { sourceId: s.id }); } renderList(); renderSel(); } },
        h('span.pick-ck', chosen.has(s.id) ? icon('check', 13) : null), h('span.pick-b', h('span.pick-t', shortCite(s)), h('span.pick-d', s.title)), used.has(s.id) && h('span.pick-tag', 'cited'))));
    };
    const renderSel = () => {
      clear(sel); if (!locators || !chosen.size) return;
      chosen.forEach((it, id) => { const s = S.sources.get(id); sel.append(h('div.pick-loc', h('span.pl-n', shortCite(s)),
        h('select.input.sm', { 'aria-label': 'Locator type', onchange: (e) => { it.label = e.target.value; } }, LOCATORS.map(([v, l]) => h('option', { value: v, selected: (it.label || 'page') === v }, l))),
        h('input.input.sm', { placeholder: 'e.g. 14 or 14–16', 'aria-label': 'Locator', value: it.locator || '', oninput: (e) => { it.locator = e.target.value; } }))); });
    };
    const body = h('div.pick', q, hint && h('p.hint', hint), list, sel, showMode && h('div.pick-mode', segmented([['parenthetical', 'Parenthetical'], ['narrative', 'Narrative'], ['note', 'Footnote']], mode, (v) => { mode = v; }, 'Citation form')), h('div.pick-add', h('button.link-btn', { onclick: () => { dlg.close(); resolve(null); import('./library.js').then((m) => m.addSourceDialog({ then: (src) => pickSources({ title, multi, locators, confirm, initial: [{ sourceId: src.id }], showMode, hint }).then(resolve) })); } }, icon('plus', 13), 'Add a new source')));
    q.addEventListener('input', renderList);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!chosen.size) { const f = $('.pick-it', list); f?.click(); return; } done(); } });
    const done = () => { const items = [...chosen.values()].map((i) => ({ ...i, locator: i.locator?.trim() || undefined, label: i.locator?.trim() ? (i.label || 'page') : undefined })); dlg.close(); resolve({ items, mode }); };
    const dlg = dialog({ title, body, width: 560, actions: [{ label: 'Cancel', value: null }, { label: confirm, primary: true, onClick: () => { if (!chosen.size) { toast('Choose at least one source'); return false; } done(); return false; } }] });
    dlg.then((v) => { if (v === undefined || v === null) resolve(null); });
    renderList(); renderSel();
  });
}

// ---- citation editor ----------------------------------------------------------
export function editCitationAt(pos, anchorEl) {
  const E = ed(); const node = E.view.state.doc.nodeAt(pos); if (!node || node.type.name !== 'citation') return;
  let attrs = { items: node.attrs.items.map((i) => ({ ...i })), mode: node.attrs.mode };
  const commit = () => { E.setAttrs(pos, { items: attrs.items, mode: attrs.mode }); refreshDerived(); renderPrev(); };
  const prev = h('div.cite-prev'); const rows = h('div.cite-rows');
  const renderPrev = () => { const id = E.view.state.doc.nodeAt(pos)?.attrs.id; prev.innerHTML = S.derived?.cites.get(id) || previewCitation(S.settings.citationStyle, attrs.items, S.sources, attrs.mode) || '<span class="muted">No preview</span>'; };
  const renderRows = () => {
    clear(rows);
    attrs.items.forEach((it, i) => { const s = S.sources.get(it.sourceId); rows.append(h('div.cite-row', h('div.cr-h', h('b', s ? shortCite(s) : 'Missing source'), h('span.muted', s ? s.title : it.sourceId), h('button.icon-btn.sm', { 'aria-label': 'Remove this source', onclick: () => { attrs.items.splice(i, 1); if (!attrs.items.length) { removeNode(); return; } commit(); renderRows(); } }, icon('x', 13))),
      h('div.cr-g', h('select.input.sm', { 'aria-label': 'Locator type', onchange: (e) => { it.label = e.target.value; commit(); } }, LOCATORS.map(([v, l]) => h('option', { value: v, selected: (it.label || 'page') === v }, l))),
        h('input.input.sm', { placeholder: 'Page, e.g. 14–16', 'aria-label': 'Locator', value: it.locator || '', oninput: (e) => { it.locator = e.target.value.trim() || undefined; if (!it.locator) it.label = undefined; else it.label = it.label || 'page'; commitSoon(); } })),
      h('div.cr-g', h('input.input.sm', { placeholder: 'Prefix (e.g. see)', 'aria-label': 'Prefix', value: it.prefix || '', oninput: (e) => { it.prefix = e.target.value || undefined; commitSoon(); } }), h('input.input.sm', { placeholder: 'Suffix', 'aria-label': 'Suffix', value: it.suffix || '', oninput: (e) => { it.suffix = e.target.value || undefined; commitSoon(); } })),
      h('label.check', h('input', { type: 'checkbox', checked: !!it.suppressAuthor, onchange: (e) => { it.suppressAuthor = e.target.checked || undefined; commit(); } }), 'Omit author name'),
      s && h('button.link-btn', { onclick: () => { pop.close(); import('./panels.js').then((m) => m.showEvidenceForCitation(pos)); } }, 'Show evidence'))); });
  };
  const commitSoon = debounce(commit, 250);
  const removeNode = () => { pop.close(); E.view.dispatch(E.view.state.tr.delete(pos, pos + node.nodeSize)); E.focus(); };
  const modeSeg = segmented([['parenthetical', 'Parenthetical'], ['narrative', 'Narrative'], ['note', 'Footnote']], attrs.mode, (v) => { attrs.mode = v; commit(); }, 'Citation form');
  const body = h('div.cite-ed', modeSeg, prev, rows, h('div.pop-actions', h('button.btn.sm', { onclick: async () => { const r = await pickSources({ title: 'Add source to citation', locators: true, confirm: 'Add' }); if (r) { attrs.items.push(...r.items); commit(); renderRows(); } } }, icon('plus', 13), 'Add source'), h('span.grow'), h('button.btn.sm', { onclick: removeNode }, 'Remove'), h('button.btn.btn-primary.sm', { onclick: () => { pop.close(); E.focus(); } }, 'Done')));
  const dom = anchorEl || E.view.nodeDOM(pos);
  const pop = popover(dom, body, { className: 'wide', label: 'Edit citation', onClose: () => commitSoon.flush?.() });
  renderRows(); renderPrev(); $('input', rows)?.focus();
  return pop;
}

// ---- footnote editor ----------------------------------------------------------
class FnCitationView {
  constructor(node) { this.node = node; this.dom = h('span.cite'); this.render(); }
  render() { this.dom.innerHTML = previewCitation(S.settings.citationStyle, this.node.attrs.items, S.sources, this.node.attrs.mode) || '(…)'; }
  update(n) { if (n.type !== this.node.type) return false; this.node = n; this.render(); return true; }
  stopEvent() { return false; } ignoreMutation() { return true; }
}
export function editFootnoteAt(pos, anchorEl) {
  const E = ed(); const node = E.view.state.doc.nodeAt(pos); if (!node || node.type.name !== 'footnote') return;
  const content = node.attrs.content || [];
  const docJSON = { type: 'doc', content: [{ type: 'paragraph', content: content.length ? content : undefined }] };
  const mount = h('div.fn-editor');
  let fv; const sync = debounce(() => { const j = fv.state.doc.firstChild.content.toJSON() || []; E.setAttrs(pos, { content: j }); refreshDerived(); }, 250);
  const fnId = node.attrs.id;
  fv = new EditorView(mount, {
    state: EditorState.create({ schema: fnSchema, doc: PMNode.fromJSON(fnSchema, docJSON), plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo, 'Mod-b': toggleMark(fnSchema.marks.strong), 'Mod-i': toggleMark(fnSchema.marks.em), Escape: () => { pop.close(); E.focus(); return true; } }), keymap(baseKeymap)] }),
    nodeViews: { citation: (n) => new FnCitationView(n) }, attributes: { 'aria-label': 'Footnote text', role: 'textbox' },
    dispatchTransaction(tr) { fv.updateState(fv.state.apply(tr)); if (tr.docChanged) sync(); },
  });
  const mk = (ic, label, run) => h('button.tb', { 'aria-label': label, title: label, onmousedown: (e) => { e.preventDefault(); run(); } }, icon(ic, 14));
  const tools = h('div.fn-tools', mk('bold', 'Bold', () => toggleMark(fnSchema.marks.strong)(fv.state, fv.dispatch)), mk('italic', 'Italic', () => toggleMark(fnSchema.marks.em)(fv.state, fv.dispatch)),
    mk('book', 'Insert citation', async () => { const r = await pickSources({ title: 'Cite in footnote' }); if (r) { fv.dispatch(fv.state.tr.replaceSelectionWith(fnSchema.nodes.citation.create({ id: uid('cit'), items: r.items, mode: 'parenthetical' }))); fv.focus(); } }),
    mk('sigma', 'Inline equation', () => { const tex = prompt('LaTeX'); if (tex) fv.dispatch(fv.state.tr.replaceSelectionWith(fnSchema.nodes.math_inline.create({ latex: tex }))); }));
  const l = E.analysis().labels.get(fnId);
  const pop = popover(anchorEl || E.view.nodeDOM(pos), h('div.fn-pop', h('div.fn-h', h('b', `Note ${l ? l.n : ''}`), h('span.grow'), h('button.link-btn', { onclick: () => { pop.close(); E.view.dispatch(E.view.state.tr.delete(pos, pos + node.nodeSize)); E.focus(); } }, 'Delete note')), tools, mount), { className: 'wide', label: 'Edit footnote', onClose: () => { sync.flush(); fv.destroy(); } });
  setTimeout(() => fv.focus(), 30);
  return pop;
}

// ---- math editor --------------------------------------------------------------
const SYMS = [['Greek', 'α \\alpha|β \\beta|γ \\gamma|δ \\delta|ε \\epsilon|θ \\theta|λ \\lambda|μ \\mu|π \\pi|σ \\sigma|φ \\phi|ω \\omega|Δ \\Delta|Σ \\Sigma|Ω \\Omega'], ['Operators', '± \\pm|× \\times|÷ \\div|· \\cdot|≤ \\leq|≥ \\geq|≠ \\neq|≈ \\approx|∝ \\propto|∈ \\in|⊂ \\subset|∞ \\infty|→ \\to|⇒ \\Rightarrow|∀ \\forall|∃ \\exists'], ['Structures', 'a/b \\frac{a}{b}|√ \\sqrt{x}|xⁿ x^{n}|xₙ x_{n}|Σ \\sum_{i=1}^{n}|∫ \\int_{a}^{b}|lim \\lim_{x \\to 0}|∏ \\prod_{i=1}^{n}|(…) \\left( x \\right)|vec \\vec{v}|bar \\bar{x}|hat \\hat{x}|matrix \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}']];
export function editMathAt(pos, anchorEl) {
  const E = ed(); const node = E.view.state.doc.nodeAt(pos); if (!node || !node.type.name.startsWith('math')) return;
  const display = node.type.name === 'math_block'; let numbered = node.attrs.numbered;
  const ta = h('textarea.input.mono', { rows: display ? 3 : 2, 'aria-label': 'LaTeX', spellcheck: 'false', value: node.attrs.latex, placeholder: 'LaTeX, e.g. E = mc^2' });
  const prev = h('div.math-prev', { 'aria-live': 'polite' });
  const commit = () => { const cur = E.view.state.doc.nodeAt(pos); if (cur && cur.attrs.latex !== ta.value || (cur && display && cur.attrs.numbered !== numbered)) E.setAttrs(pos, display ? { latex: ta.value, numbered } : { latex: ta.value }); };
  const commitSoon = debounce(commit, 300);
  const upd = () => { prev.innerHTML = renderMath(ta.value, display); commitSoon(); };
  ta.addEventListener('input', upd);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) { e.preventDefault(); pop.close(); E.focus(); } });
  const palette = h('details.sym-pal', h('summary', 'Symbols and templates'), SYMS.map(([name, items]) => h('div.sym-g', h('span.sym-n', name), h('div.sym-row', items.split('|').map((it) => { const i = it.indexOf(' '); const label = it.slice(0, i), tex = it.slice(i + 1); return h('button.sym', { title: tex, 'aria-label': tex, onmousedown: (e) => e.preventDefault(), onclick: () => { const s = ta.selectionStart; ta.setRangeText(tex, s, ta.selectionEnd, 'end'); upd(); ta.focus(); } }, label); })))));
  const body = h('div.math-ed', ta, prev, display && h('label.check', h('input', { type: 'checkbox', checked: numbered, onchange: (e) => { numbered = e.target.checked; commit(); } }), 'Number this equation'), palette,
    h('div.pop-actions', h('button.btn.sm', { onclick: () => { pop.close(); E.view.dispatch(E.view.state.tr.delete(pos, pos + node.nodeSize)); E.focus(); } }, 'Delete'), h('span.grow'), h('button.btn.btn-primary.sm', { onclick: () => { pop.close(); E.focus(); } }, 'Done')));
  const pop = popover(anchorEl || E.view.nodeDOM(pos), body, { className: 'wide', label: 'Edit equation', onClose: () => commit() });
  upd(); setTimeout(() => { ta.focus(); ta.select(); }, 30); return pop;
}

// ---- link editor ---------------------------------------------------------------
export function editLink(anchor) {
  const E = ed(); const view = E.view; const cur = linkAt(view.state); const { from, to } = view.state.selection;
  const input = h('input.input', { type: 'url', placeholder: 'https://', value: cur?.attrs.href || '', 'aria-label': 'Link address', autofocus: true });
  const apply = () => { const v = input.value.trim(); view.dispatch(view.state.tr.setSelection(view.state.selection)); if (v) setLink(view, /^[a-z]+:|^#|^\//i.test(v) ? v : 'https://' + v); else setLink(view, null); pop.close(); view.focus(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  const pop = popover(anchor || view.coordsAtPos(from), h('div.link-ed', input, h('div.pop-actions', cur && h('button.btn.sm', { onclick: () => { setLink(view, null); pop.close(); view.focus(); } }, 'Remove link'), h('span.grow'), h('button.btn.btn-primary.sm', { onclick: apply }, 'Apply'))), { label: 'Edit link' });
  setTimeout(() => { input.focus(); input.select(); }, 20);
}

// ---- figure options ------------------------------------------------------------
export async function replaceFigureImage(pos) {
  const [f] = await fileDialog({ accept: 'image/*' }); if (!f) return; const { addAsset } = await import('./state.js'); const id = await addAsset(f, f.name);
  ed().setAttrs(pos, { assetId: id, src: null });
}
export function figureOptions(pos) {
  const E = ed(); const n = E.view.state.doc.nodeAt(pos); if (!n || n.type.name !== 'figure') return null;
  const a = n.attrs; const up = (patch) => E.setAttrs(pos, patch);
  const alt = h('input.input', { value: a.alt, 'aria-label': 'Alternative text', placeholder: 'Describe the image for readers who cannot see it', oninput: (e) => up({ alt: e.target.value }) });
  const body = h('div.fig-opts', field('Alternative text', alt, 'Required for accessible export.'), field('Source or credit', h('input.input', { value: a.credit, placeholder: 'e.g. Adapted from Smith (2020)', oninput: (e) => up({ credit: e.target.value }) })),
    h('div.fo-row', field('Width', h('input', { type: 'range', min: 20, max: 100, step: 5, value: a.width, 'aria-label': 'Width percent', oninput: (e) => up({ width: +e.target.value }) })), h('div.field', h('span.field-l', 'Align'), segmented([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], a.align, (v) => up({ align: v }), 'Alignment'))),
    h('label.check', h('input', { type: 'checkbox', checked: a.numbered, onchange: (e) => up({ numbered: e.target.checked }) }), 'Number and caption as a figure'),
    h('div.pop-actions', h('button.btn.sm', { onclick: () => replaceFigureImage(pos) }, 'Replace image'), h('button.btn.sm', { onclick: () => { pop.close(); E.view.dispatch(E.view.state.tr.delete(pos, pos + n.nodeSize)); } }, 'Remove'), h('span.grow'), h('button.btn.btn-primary.sm', { onclick: () => { pop.close(); E.focus(); } }, 'Done')));
  const dom = E.view.nodeDOM(pos);
  const pop = popover(dom.querySelector('.fig-media') || dom, body, { placement: 'bottom-start', className: 'wide', label: 'Figure options' });
  return pop;
}

// ---- cross-reference picker ----------------------------------------------------
export function pickCrossref() {
  const A = ed().analysis(); const groups = { figure: 'Figures', table: 'Tables', equation: 'Equations', section: 'Sections', footnote: 'Notes' }; const by = {};
  A.labels.forEach((l, id) => { (by[l.kind] = by[l.kind] || []).push({ id, ...l }); });
  let form = 'full'; let dlg;
  const body = h('div.xref-pick', Object.entries(groups).map(([k, name]) => (by[k]?.length ? h('div.xp-g', h('div.xp-h', name), by[k].map((l) => h('button.pick-it', { onclick: () => { dlg.close(); ed().cmd.crossref(l.id, l.kind, form); } }, h('span.pick-b', h('span.pick-t', l.label), l.text && h('span.pick-d', l.text.slice(0, 80)))))) : null)),
    !A.labels.size && h('p.empty-s', 'No figures, tables, equations or sections to reference yet.'));
  body.prepend(h('div.xp-form', segmented([['full', 'Label and number (Figure 3)'], ['number', 'Number only (3)']], form, (v) => { form = v; }, 'Reference form')));
  dlg = dialog({ title: 'Insert cross-reference', body, width: 500 });
}

// ---- special characters --------------------------------------------------------
const CHARS = { Punctuation: '– — … “ ” ‘ ’ « » § ¶ † ‡ • ° ′ ″ ¿ ¡', Math: '± × ÷ ≤ ≥ ≠ ≈ ∞ ∑ ∏ √ ∫ ∂ ∇ ∈ ∉ ⊂ ⊆ ∪ ∩ → ← ⇒ ⇔ ∴ ∵ ′', Greek: 'α β γ δ ε ζ η θ λ μ ν ξ π ρ σ τ φ χ ψ ω Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω', Letters: 'á à â ä ã å æ ç é è ê ë í ì î ï ñ ó ò ô ö õ ø œ ß ú ù û ü ý ÿ Á É Í Ó Ú Ñ Ç Ä Ö Ü', Symbols: '© ® ™ € £ ¥ ¢ ¹ ² ³ ½ ¼ ¾ ‰ ♀ ♂ ✓ ✗' };
export function specialChars() {
  let dlg; const body = h('div.chars', Object.entries(CHARS).map(([k, v]) => h('div.chr-g', h('div.chr-h', k), h('div.chr-row', v.split(' ').map((c) => h('button.chr', { 'aria-label': 'Insert ' + c, onclick: () => { ed().cmd.text(c); } }, c))))));
  dlg = dialog({ title: 'Special characters', body, width: 460, className: 'dlg-persist' });
}

// ---- table bar -----------------------------------------------------------------
let tbar = null;
export function updateTableBar(state) {
  const E = ed(); const { $from } = state.selection; let blockPos = null;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table_block') { blockPos = $from.before(d); break; }
  const inCell = (() => { for (let d = $from.depth; d > 0; d--) if (['table_cell', 'table_header'].includes($from.node(d).type.name)) return true; return false; })();
  if (blockPos == null || !inCell) { if (tbar) { tbar.remove(); tbar = null; } return; }
  const dom = E.view.nodeDOM(blockPos); if (!dom) return;
  if (!tbar) { tbar = h('div.table-bar', { role: 'toolbar', 'aria-label': 'Table tools' }); document.body.append(tbar); }
  const b = (ic, label, op) => h('button.tb', { title: label, 'aria-label': label, onmousedown: (e) => { e.preventDefault(); op(); } }, typeof ic === 'string' && ic.length > 3 ? icon(ic, 14) : ic);
  clear(tbar).append(b('+ Row', 'Add row below', () => E.cmd.tableOp('addRowAfter')), b('+ Col', 'Add column right', () => E.cmd.tableOp('addColumnAfter')), b('− Row', 'Delete row', () => E.cmd.tableOp('deleteRow')), b('− Col', 'Delete column', () => E.cmd.tableOp('deleteColumn')), h('span.tb-sep'),
    b('Header', 'Toggle header row', () => E.cmd.tableOp('toggleHeaderRow')), b('L', 'Align left', () => E.cmd.cellAlign('left')), b('C', 'Align center', () => E.cmd.cellAlign('center')), b('R', 'Align right', () => E.cmd.cellAlign('right')), h('span.tb-sep'), b('trash', 'Delete table', () => E.cmd.tableOp('deleteTable')));
  const r = dom.getBoundingClientRect(); tbar.style.left = Math.max(8, r.left) + 'px'; tbar.style.top = Math.max(60, r.top - 36) + 'px';
}
export const hideTableBar = () => { if (tbar) { tbar.remove(); tbar = null; } };
