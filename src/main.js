import './app.css';
import { S, boot, openProject, createBlank, createSample, saveSettings, renameProject, refreshDerived, refreshDerivedSoon, docChanged, setSave, retrySave, pushRecent, addAsset, putItem, flushDoc, takeSnapshot, flushed, notebookChanged } from './state.js';
import * as DB from './db.js';
import { createEditor, suggestTransform, claimStatus } from './editor.js';
import { installEditorUI } from './editor-ui.js';
import { h, icon, clear, menu, popover, dialog, confirmDialog, promptDialog, toast, bus, kbd, field, segmented, fileDialog, announce, $, $$, isMac, ago } from './ui.js';
import { pickSources, editCitationAt, editFootnoteAt, editMathAt, editLink, figureOptions, pickCrossref, specialChars, updateTableBar, hideTableBar } from './editors.js';
import { renderLibrary, addSourceDialog, importFlow, importFiles } from './library.js';
import { renderNotes, noteDialog, handlePasteCapture, insertNoteIntoDraft, addNoteForSelection } from './notes.js';
import { openReaderView } from './reader.js';
import { WikiView } from './wiki.js';
import { mountPanels, show as showPanel, addComment } from './panels.js';
import { listStyles, isNoteStyle, registerStyle } from './csl.js';
import { CITATION_STYLES, EXPORT_PRESETS, shortCite, uid, now, debounce, defaultSettings } from './model.js';
import { exportAs } from './exporters.js';
import { exportProject, importProject, importDocx, importMarkdown } from './importers.js';
import { createNotebook, emptyNotebook } from './notebook.js';
import { renderDashboard } from './dashboard.js';
import { schema } from './schema.js';
import { checkServer } from './research.js';
import { ensureClaim, addEvidence } from './review.js';
import { NodeSelection, TextSelection } from 'prosemirror-state';
window.__TS = TextSelection;

const M = schema.marks, T = schema.nodes;
const loadUI = () => ({ leftOpen: true, rightOpen: true, leftW: 270, rightW: 360, leftTab: 'outline', split: false, ...JSON.parse(localStorage.getItem('ui') || '{}'), focus: false });
S.ui = loadUI(); S.lastCapture = null; if (innerWidth < 1100) { S.ui.leftOpen = false; S.ui.rightOpen = false; }
const saveUI = () => localStorage.setItem('ui', JSON.stringify({ ...S.ui, focus: false }));
const flags = () => ({ noteStyle: S.P ? isNoteStyle(S.settings.citationStyle) : false, numberHeadings: S.P ? S.settings.numberHeadings : false, evidenceMode: S.P ? S.settings.evidenceMode : false });
let E = null, NB = null; S.view = 'dashboard'; S.suggest = false; let projectList = []; const ui = {}; let tabs = [{ id: 'paper', kind: 'paper', title: 'Paper' }], activeTab = 'paper'; const readers = new Map(); let outlineCollapsed = new Set();

// ================= shell =================
function buildShell() {
  const app = $('#app'); clear(app);
  ui.save = h('span.save', { role: 'status', 'aria-live': 'polite' });
  ui.projBtn = h('button.proj-btn', { 'aria-haspopup': 'menu', onclick: projectMenu }, h('span.proj-n'), icon('down', 13));
  ui.viewSw = h('div.view-sw', { role: 'tablist', 'aria-label': 'View' });
  ui.brand = h('span.brand', 'Papers'); ui.top = h('div.topbar', h('button.icon-btn', { id: 'btn-home', 'aria-label': 'All papers', title: 'All papers (' + kbd('Mod-Alt-h') + ')', onclick: () => setView('dashboard') }, icon('library')), ui.brand, h('button.icon-btn', { id: 'btn-left', 'aria-label': 'Toggle outline and library', title: 'Toggle left sidebar (' + kbd('Mod-\\') + ')', onclick: () => toggle('left') }, icon('panelL')), ui.projBtn, ui.save, h('span.grow'), ui.viewSw, h('span.grow'),
    h('button.btn.sm.ghost.hide-sm', { onclick: () => showPanel('search') }, icon('search', 14), 'Search'), h('button.btn.sm.ghost', { onclick: openPalette, title: 'Command palette' }, icon('command', 14), h('span.hide-sm', kbd('Mod-K'))), h('button.icon-btn', { 'aria-label': 'Focus mode', title: 'Focus mode (' + kbd('Mod-Shift-Enter') + ')', onclick: () => setFocus(true) }, icon('maximize')), h('button.btn.sm', { onclick: openExport, 'aria-label': 'Export' }, icon('export', 14), h('span.hide-sm', 'Export')),
    h('button.icon-btn', { id: 'btn-right', 'aria-label': 'Toggle research panel', title: 'Toggle research panel', onclick: () => toggle('right') }, icon('panelR')));
  ui.toolbar = h('div.toolbar', { role: 'toolbar', 'aria-label': 'Document tools' }); ui.nbToolbar = h('div.toolbar.nb-toolbar', { role: 'toolbar', 'aria-label': 'Notes tools', hidden: true }); ui.dashEl = h('main.dash-wrap', { hidden: true, 'aria-label': 'Papers' });
  ui.left = h('aside.left', { 'aria-label': 'Outline and library' }); ui.leftBody = h('div.side-body'); ui.leftTabs = h('div.side-tabs');
  ui.left.append(ui.leftTabs, ui.leftBody);
  ui.center = h('div.center', { role: 'main' }); ui.tabs = h('div.tabs', { role: 'tablist' }); ui.panes = h('div.panes'); ui.center.append(ui.tabs, ui.panes);
  ui.right = h('aside.right', { 'aria-label': 'Research panel' });
  ui.rzL = h('div.resizer', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize left sidebar', 'aria-valuemin': '200', 'aria-valuemax': '480', 'aria-valuenow': String(S.ui.leftW), tabindex: '0' }); ui.rzR = h('div.resizer', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize right panel', 'aria-valuemin': '280', 'aria-valuemax': '640', 'aria-valuenow': String(S.ui.rightW), tabindex: '0' });
  ui.backdrop = h('div.backdrop', { onclick: () => { S.ui.leftOpen = S.ui.rightOpen = false; applyLayout(); } });
  ui.main = h('div.main', ui.left, ui.rzL, ui.center, ui.rzR, ui.right, ui.backdrop);
  ui.exit = h('button.exit-focus.btn.sm', { onclick: () => setFocus(false) }, icon('minimize', 14), 'Exit focus');
  ui.mnav = h('nav.mnav', { 'aria-label': 'Sections' }, [['paper', 'Write', 'pencil'], ['outline', 'Outline', 'list'], ['sources', 'Sources', 'library'], ['notes', 'Notes', 'note'], ['research', 'Research', 'search']].map(([k, l, ic]) => h('button', { 'data-k': k, onclick: () => mobileNav(k) }, icon(ic, 18), l)));
  app.append(h('header.head', ui.top, ui.toolbar, ui.nbToolbar), ui.dashEl, ui.main, ui.exit, ui.mnav);
  mountPanels(ui.right);
  resizer(ui.rzL, 'leftW', 1, 200, 480); resizer(ui.rzR, 'rightW', -1, 280, 640);
  addEventListener('resize', applyLayout);
}
function resizer(el, key, dir, min, max) {
  const move = (dx) => { S.ui[key] = Math.max(min, Math.min(max, S.ui[key] + dir * dx)); el.setAttribute('aria-valuenow', String(S.ui[key])); applyLayout(); saveUI(); };
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); let x = e.clientX; const mv = (ev) => { move(ev.clientX - x); x = ev.clientX; }; const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); });
  el.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') move(-16); if (e.key === 'ArrowRight') move(16); });
}
function applyLayout() {
  const w = innerWidth; const narrow = w < 1100, phone = w < 700; document.body.classList.toggle('narrow', narrow); document.body.classList.toggle('phone', phone); document.body.classList.toggle('focus', S.ui.focus);
  const root = document.documentElement.style; root.setProperty('--lw', (S.ui.leftOpen && !S.ui.focus ? S.ui.leftW : 0) + 'px'); root.setProperty('--rw', (S.ui.rightOpen && !S.ui.focus ? S.ui.rightW : 0) + 'px');
  ui.left.classList.toggle('closed', !S.ui.leftOpen || S.ui.focus); ui.right.classList.toggle('closed', !S.ui.rightOpen || S.ui.focus); ui.left.toggleAttribute('inert', !S.ui.leftOpen || S.ui.focus); ui.right.toggleAttribute('inert', !S.ui.rightOpen || S.ui.focus);
  ui.rzL.hidden = ui.rzR.hidden = narrow; ui.backdrop.classList.toggle('on', narrow && !S.ui.focus && (S.ui.leftOpen || S.ui.rightOpen));
  $('#btn-left')?.setAttribute('aria-pressed', String(S.ui.leftOpen)); $('#btn-right')?.setAttribute('aria-pressed', String(S.ui.rightOpen));
  ui.split?.classList.toggle('on', !!S.ui.split);
  $$('.mnav button', ui.mnav).forEach((b) => b.classList.toggle('on', b.dataset.k === mobileCur));
}
let mobileCur = 'paper';
function mobileNav(k) { mobileCur = k; if (k === 'paper') { S.ui.leftOpen = S.ui.rightOpen = false; } else if (['outline', 'sources', 'notes'].includes(k)) { S.ui.leftOpen = true; S.ui.rightOpen = false; S.ui.leftTab = k; drawLeft(); } else { S.ui.leftOpen = false; S.ui.rightOpen = true; showPanel('research'); } applyLayout(); }
function toggle(side) { if (side === 'left') S.ui.leftOpen = !S.ui.leftOpen; else S.ui.rightOpen = !S.ui.rightOpen; if (innerWidth < 1100) { if (side === 'left') S.ui.rightOpen = false; else S.ui.leftOpen = false; } applyLayout(); saveUI(); }
bus.on('open-right', () => { S.ui.rightOpen = true; if (innerWidth < 1100) S.ui.leftOpen = false; applyLayout(); });
function setFocus(on) { S.ui.focus = on; applyLayout(); if (on) { E?.focus(); announce('Focus mode. Press Escape to exit.'); } }

// ================= left sidebar =================
function drawLeft() {
  clear(ui.leftTabs).append(segmented([['outline', 'Outline'], ['sources', 'Sources'], ['notes', 'Notes']], S.ui.leftTab, (v) => { S.ui.leftTab = v; saveUI(); drawLeft(); }, 'Sidebar section'));
  clear(ui.leftBody); ui.leftBody.classList.toggle('pad-0', S.ui.leftTab !== 'outline');
  if (S.ui.leftTab === 'outline') drawOutline(); else if (S.ui.leftTab === 'sources') renderLibrary(ui.leftBody); else renderNotes(ui.leftBody);
}
function drawNbOutline() {
  const root = ui.leftBody; clear(root); const hs = NB.headings(); root.append(h('div.side-tools', h('div.row', h('span.muted', `${NB.words().toLocaleString()} words in notes`))));
  const list = h('div.outline', { role: 'list' }); root.append(list); if (!hs.length) list.append(h('p.empty-s', 'Headings in your notes appear here. Type # and a space to make one.'));
  hs.forEach((x) => list.append(h('div.ol-row', { role: 'listitem', tabindex: '0', style: { paddingLeft: (x.level - 1) * 14 + 12 + 'px' }, onclick: () => NB.scrollTo(x.pos), onkeydown: (e) => { if (e.key === 'Enter') NB.scrollTo(x.pos); } }, h('span.ol-t', x.text || 'Untitled'))));
}
function drawOutline() {
  if (S.view === 'notes' && NB) return drawNbOutline();
  const root = ui.leftBody; clear(root); const A = E.analysis(); const hs = A.headings;
  const tools = h('div.side-tools', h('div.row', h('span.muted', `${A.bodyWords.toLocaleString()} words`), h('span.grow'), h('button.btn.sm.ghost', { onclick: () => { const cur = E.view.state.selection.$from; const idx = (() => { let k = -1; hs.forEach((x, i) => { if (x.pos < cur.pos) k = i; }); return k; })(); const pos = E.insertHeadingAfterSection(idx, { planning: true, level: idx >= 0 ? hs[idx].level : 1 }); setTimeout(() => { E.scrollTo(pos); }, 30); } }, icon('plus', 13), 'Planning heading')));
  const list = h('div.outline', { role: 'tree', 'aria-label': 'Document outline' }); root.append(tools, list);
  if (!hs.length) list.append(h('p.empty-s', 'Headings you add appear here. Type # and a space, or use / to insert one.'));
  let hide = null; const target = S.settings.sectionTargets || {};
  hs.forEach((x, i) => {
    if (hide != null && x.level > hide) return; hide = null; const kids = hs[i + 1] && hs[i + 1].level > x.level; const col = outlineCollapsed.has(x.id); if (col) hide = x.level;
    const row = h('div.ol-row' + (x.planning ? '.plan' : ''), { role: 'treeitem', 'aria-level': x.level, 'aria-expanded': kids ? String(!col) : null, tabindex: '0', draggable: 'true', style: { paddingLeft: (x.level - 1) * 14 + 6 + 'px' }, 'data-i': i, onclick: () => { E.scrollTo(x.pos); if (innerWidth < 700) mobileNav('paper'); }, onkeydown: (e) => { if (e.key === 'Enter') E.scrollTo(x.pos); if (e.key === 'ArrowRight' && kids && col) { outlineCollapsed.delete(x.id); drawOutline(); } if (e.key === 'ArrowLeft' && kids && !col) { outlineCollapsed.add(x.id); drawOutline(); } if (e.altKey && e.key === 'ArrowUp' && i > 0) { const prev = hs.slice(0, i).reverse().find((p) => p.level <= x.level); if (prev) E.moveSection(i, prev.pos); } if (e.altKey && e.key === 'ArrowDown' && x.sectionEnd < E.view.state.doc.content.size) { E.moveSection(i, x.sectionEnd + (E.view.state.doc.nodeAt(x.sectionEnd)?.nodeSize || 0)); } },
      ondragstart: (e) => { e.dataTransfer.setData('application/x-section', String(i)); e.dataTransfer.effectAllowed = 'move'; }, ondragover: (e) => { if (e.dataTransfer.types.includes('application/x-section')) { e.preventDefault(); const r = row.getBoundingClientRect(); row.classList.toggle('drop-before', e.clientY < r.top + r.height / 2); row.classList.toggle('drop-after', e.clientY >= r.top + r.height / 2); } }, ondragleave: () => row.classList.remove('drop-before', 'drop-after'),
      ondrop: (e) => { e.preventDefault(); const from = +e.dataTransfer.getData('application/x-section'); const before = e.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2; row.classList.remove('drop-before', 'drop-after'); if (from === i) return; E.moveSection(from, before ? x.pos : x.sectionEnd); } },
      kids ? h('button.ol-tw', { 'aria-label': col ? 'Expand' : 'Collapse', tabindex: '-1', onclick: (e) => { e.stopPropagation(); col ? outlineCollapsed.delete(x.id) : outlineCollapsed.add(x.id); drawOutline(); } }, icon(col ? 'right' : 'down', 12)) : h('span.ol-tw'), h('span.ol-t', (S.settings.numberHeadings && x.num ? x.num + ' ' : '') + (x.text || 'Untitled')), x.planning ? h('span.ol-w', 'plan') : h('span.ol-w' + (target[x.id] && x.words >= target[x.id] ? '.met' : ''), x.words ? String(x.words) : ''));
    list.append(row);
  });
  markOutlineCur();
  const notesFor = [...S.notes.values()].filter((n) => n.attach?.type === 'section'); if (notesFor.length) list.append(h('div.sd-h.pad-s', 'Notes attached to sections'), ...notesFor.slice(0, 8).map((n) => h('button.link-btn.block.pad-s', { onclick: () => bus.emit('open-note', n.id) }, n.text.slice(0, 50))));
}
let drawLeftSoon = debounce(() => { if (S.ui.leftTab === 'outline') drawOutline(); }, 200); const drawNbSoon = debounce(() => { if (S.view === 'notes' && S.ui.leftTab === 'outline') drawOutline(); }, 250);
bus.on('sources', debounce(() => { if (S.ui.leftTab === 'sources') drawLeft(); }, 80)); bus.on('notes', debounce(() => { if (S.ui.leftTab === 'notes') drawLeft(); if (S.ui.leftTab === 'outline') drawOutline(); }, 80)); bus.on('collections', () => { if (S.ui.leftTab === 'sources') drawLeft(); });

// ================= views: dashboard / paper / notes =================
function drawViewSw() {
  clear(ui.viewSw); const hidden = S.view === 'dashboard'; ui.viewSw.hidden = hidden;
  [['paper', 'Paper', 'pencil'], ['notes', 'Notes', 'note']].forEach(([v, l, ic]) => ui.viewSw.append(h('button.vs-b' + (S.view === v ? '.on' : ''), { role: 'tab', 'aria-selected': String(S.view === v), title: l + (v === 'notes' ? ' (' + kbd('Mod-Alt-n') + ')' : ''), onclick: () => setView(v) }, icon(ic, 14), l)));
}
async function setView(v) {
  if (v === 'dashboard') await flushDoc();
  S.view = v; document.body.classList.remove('view-dash', 'view-paper', 'view-notes'); document.body.classList.add('view-' + (v === 'dashboard' ? 'dash' : v));
  const dash = v === 'dashboard'; ui.dashEl.hidden = !dash; ui.main.hidden = dash; ui.brand.hidden = !dash; ui.toolbar.hidden = v !== 'paper'; ui.nbToolbar.hidden = v !== 'notes'; ui.mnav.hidden = dash;
  if (ui.tabs) { ui.tabs.hidden = v !== 'paper' || tabs.length < 2; ui.panes.hidden = v === 'notes'; ui.nbPane.hidden = v !== 'notes'; }
  drawViewSw(); if (!dash) { drawLeft(); showPanes?.(); }
  if (dash) { $('#btn-left').hidden = true; $('#btn-right').hidden = true; ui.projBtn.hidden = true; ui.save.hidden = true; await showDashboard(); } else { $('#btn-left').hidden = false; $('#btn-right').hidden = false; ui.projBtn.hidden = false; ui.save.hidden = false; }
  if (v === 'notes') setTimeout(() => NB?.focus(), 30); if (v === 'paper') setTimeout(() => { if (activeTab === 'paper') E?.focus(); }, 30);
  announce({ dashboard: 'All papers', paper: 'Paper', notes: 'Notes' }[v]);
}
async function switchProject(id, view = 'paper') { if (id !== S.id) { await flushDoc(); await openProject(id); await S.mounting; } await setView(view); }
async function showDashboard() {
  const open = (id, v) => switchProject(id, v);
  await renderDashboard(ui.dashEl, { open, create: createPaper, importBackup: restoreBackup, backup: (id) => exportProject(id), remove: deletePaper });
  const cont = h('button.btn.btn-primary.continue', { onclick: () => switchProject(S.id, 'paper') }, icon('pencil', 14), 'Continue writing'); const head = ui.dashEl.querySelector('.d-head .row'); head?.prepend(cont); head?.querySelector('.btn-primary:not(.continue)')?.classList.remove('btn-primary');
}
async function createPaper() { const n = await promptDialog('New paper', 'Title', '', { ok: 'Create' }); if (n === undefined) return; await flushDoc(); const id = await createBlank(n.trim() || 'Untitled paper'); await switchProject(id, 'paper'); }
async function restoreBackup() { const [f] = await fileDialog({ accept: '.json' }); if (!f) return; try { const id = await importProject(f); toast('Paper restored'); await switchProject(id, 'paper'); } catch (e) { toast(e.message, { kind: 'err' }); } }
async function deletePaper(id, name) {
  const list = await DB.listProjects(); if (list.length < 2) { toast('Keep at least one paper. Create another first.'); return; }
  if (!(await confirmDialog('Delete this paper?', `“${name}” with its sources, notes, notebook, highlights and files will be permanently removed from this browser. Back it up first if you might need it.`, { ok: 'Delete paper' }))) return;
  if (id === S.id) { const other = list.find((p) => p.id !== id); await flushDoc(); await openProject(other.id); await S.mounting; }
  await DB.deleteProject(id); toast('Paper deleted'); await showDashboard();
}

// ================= notebook pane =================
function buildNotes() {
  ui.nbPane?.remove(); NB?.destroy();
  ui.nbMount = h('div.nb-mount'); ui.nbFind = h('div.findbar', { hidden: true, role: 'search' }); ui.nbScroll = h('div.nb-scroll', { onclick: (e) => { if (e.target === ui.nbScroll || e.target.classList.contains('nb-page') || e.target.classList.contains('nb-tail')) { const v = NB.view; v.focus(); v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atEnd(v.state.doc))); } } }, h('div.nb-page', h('div.nb-head', h('h1', 'Notes'), h('p.muted', 'An endless page for thinking. Type [[ to link to a section, a source or another note.')), ui.nbMount, h('div.nb-tail')));
  ui.nbPane = h('div.nb-pane', { hidden: S.view !== 'notes' }, ui.nbFind, ui.nbScroll); ui.center.append(ui.nbPane);
  NB = createNotebook(ui.nbMount, { json: S.P.notebookJSON || emptyNotebook(), onChange: (j) => { notebookChanged(j); drawNbSoon(); } });
  NB.onSelection = () => updateNbToolbar(); window.__NB = NB; buildNbToolbar(); if (S.P.nbRecovered) toast('Recovered unsaved notes from this browser.', { timeout: 6000 });
}
function buildNbToolbar() {
  clear(ui.nbToolbar); const c = NB.cmd; const b = (ic, label, run, id, k) => h('button.tb', { 'aria-label': label, title: label + (k ? ' (' + kbd(k) + ')' : ''), 'data-nb': id || '', 'aria-pressed': id ? 'false' : null, onmousedown: (e) => e.preventDefault(), onclick: run }, icon(ic, 16));
  const sel = h('select.tb-sel', { 'aria-label': 'Block style', onchange: (e) => { const v = e.target.value; if (v === 'p') c.paragraph(); else if (v === 'q') c.quote(); else if (v === 'c') c.codeBlock(); else c.heading(+v); e.target.blur(); NB.focus(); } }, [['p', 'Text'], ['1', 'Heading 1'], ['2', 'Heading 2'], ['3', 'Heading 3'], ['q', 'Quote'], ['c', 'Code']].map(([v, l]) => h('option', { value: v }, l))); ui.nbSel = sel;
  ui.nbToolbar.append(b('undo', 'Undo', () => c.undo(), '', 'Mod-z'), b('redo', 'Redo', () => c.redo(), '', 'Mod-Shift-z'), h('span.tb-sep'), sel, h('span.tb-sep'), b('bold', 'Bold', () => c.bold(), 'strong', 'Mod-b'), b('italic', 'Italic', () => c.italic(), 'em', 'Mod-i'), b('highlight', 'Highlight', () => c.highlight(), 'highlight', 'Mod-Shift-h'), b('code', 'Inline code', () => c.code(), 'code', 'Mod-e'), h('span.tb-sep'), b('list', 'Bulleted list', () => c.bullet()), b('olist', 'Numbered list', () => c.ordered()), b('tasks', 'Checklist', () => c.tasks()), b('quote', 'Quote', () => c.quote()), h('span.tb-sep'), b('link', 'Link to a section, source or note', () => { NB.view.focus(); NB.view.dispatch(NB.view.state.tr.insertText('[[')); }), b('copy', 'Copy a link to the current block', () => { const r = NB.copyLinkToBlock(); toast(r ? 'Link copied. Paste it anywhere in these notes.' : 'Place the cursor in a block first'); }), h('span.grow'), h('button.btn.sm.ghost', { onclick: () => openNbFind() }, icon('search', 14), 'Find', h('span.kbd', kbd('Mod-f'))));
}
function updateNbToolbar() {
  const st = NB.view.state; const { from, to, empty, $from } = st.selection; $$('[data-nb]', ui.nbToolbar).forEach((x) => { if (!x.dataset.nb) return; const t = NB.view.state.schema.marks[x.dataset.nb]; const on = empty ? !!t.isInSet(st.storedMarks || $from.marks()) : st.doc.rangeHasMark(from, to, t); x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
  const p = $from.parent; let v = 'p'; if (p.type.name === 'heading') v = String(Math.min(3, p.attrs.level)); else if (p.type.name === 'code_block') v = 'c'; else for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'blockquote') { v = 'q'; break; } if (ui.nbSel) ui.nbSel.value = v;
}
function openNbFind() {
  const fb = ui.nbFind; fb.hidden = false; clear(fb); const sel = NB.view.state.doc.textBetween(NB.view.state.selection.from, NB.view.state.selection.to); let cs = false;
  const q = h('input.input.sm', { type: 'search', 'aria-label': 'Find in notes', placeholder: 'Find in notes', value: sel && sel.length < 80 ? sel : NB.find.get().q.text }); const cnt = h('span.muted.fc');
  const upd = () => { NB.find.set({ text: q.value, cs, ww: false }, 0); const s = NB.find.get(); cnt.textContent = q.value ? (s.matches.length ? `${s.idx + 1} of ${s.matches.length}` : 'No matches') : ''; if (s.matches.length) NB.find.step(0); };
  const step = (d) => { NB.find.step(d); const s = NB.find.get(); cnt.textContent = s.matches.length ? `${s.idx + 1} of ${s.matches.length}` : 'No matches'; };
  q.addEventListener('input', upd); q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') { closeNbFind(); } });
  fb.append(q, h('button.icon-btn.sm', { 'aria-label': 'Previous match', onclick: () => step(-1) }, icon('up', 14)), h('button.icon-btn.sm', { 'aria-label': 'Next match', onclick: () => step(1) }, icon('down', 14)), h('label.check', h('input', { type: 'checkbox', onchange: (e) => { cs = e.target.checked; upd(); } }), 'Match case'), cnt, h('span.grow'), h('button.icon-btn.sm', { 'aria-label': 'Close find', onclick: closeNbFind }, icon('x', 14)));
  q.focus(); q.select(); upd();
}
function closeNbFind() { ui.nbFind.hidden = true; NB.find.set({ text: '' }, 0); NB.focus(); }
bus.on('notelink-open', (a) => {
  if (a.kind === 'note') { setView('notes').then(() => { if (!NB.scrollToId(a.target)) toast('That block no longer exists'); }); }
  else if (a.kind === 'paper') { setView('paper').then(() => { activate('paper'); setTimeout(() => { if (!E.scrollToId(a.target)) toast('That part of the paper no longer exists'); }, 40); }); }
  else if (a.kind === 'source') { if (S.sources.has(a.target)) { bus.emit('open-right'); bus.emit('open-source-detail', a.target); } else toast('That source was deleted'); }
});
function sendToNotes() {
  const text = E.selectionText().trim(); if (!text) { toast('Select some text first'); return; } const b = E.blockAt(E.view.state.selection.from); const A = E.analysis(); let head = null; A.headings.forEach((x) => { if (x.pos < E.view.state.selection.from && !x.planning) head = x; });
  NB.appendQuote(text, { kind: 'paper', target: b?.node.attrs.id || head?.id || '', label: head ? 'Paper: ' + (head.text || 'section').slice(0, 40) : 'Paper' }); toast('Added to notes', { action: 'Open notes', onAction: () => setView('notes') });
}

// ================= center: tabs, paper, readers =================
function drawTabs() {
  clear(ui.tabs);
  tabs.forEach((t) => ui.tabs.append(h('div.tab' + (t.id === activeTab ? '.on' : ''), h('button.tab-b', { role: 'tab', 'aria-selected': String(t.id === activeTab), onclick: () => activate(t.id) }, t.kind === 'paper' ? icon('pencil', 13) : t.kind === 'wiki' ? icon('globe', 13) : icon('book', 13), h('span.tab-t', t.title)), t.kind !== 'paper' && h('button.tab-x', { 'aria-label': 'Close ' + t.title, onclick: () => closeTab(t.id) }, icon('x', 12)))));
  ui.tabs.hidden = tabs.length < 2;
  ui.split = h('button.icon-btn.sm.tab-split', { 'aria-label': 'Show reader beside the paper', title: 'Split view: paper and reader side by side', 'aria-pressed': String(!!S.ui.split), onclick: () => { S.ui.split = !S.ui.split; saveUI(); showPanes(); applyLayout(); } }, icon('split', 15)); ui.tabs.append(h('span.grow'), tabs.length > 1 ? ui.split : null);
}
function showPanes() {
  const act = tabs.find((t) => t.id === activeTab); const split = S.ui.split && tabs.length > 1;
  ui.paperPane.hidden = !(act.kind === 'paper' || split); ui.panes.classList.toggle('split', split && !ui.paperPane.hidden);
  const readerTab = act.kind !== 'paper' ? act : split ? tabs[tabs.length - 1] : null;
  $$('.reader-pane', ui.panes).forEach((p) => { p.hidden = !(readerTab && p.dataset.tab === readerTab.id); });
  ui.paperPane.classList.toggle('narrowed', split);
  $$('.mnav button', ui.mnav).forEach((b) => b.classList.toggle('on', b.dataset.k === (act.kind === 'paper' ? 'paper' : b.dataset.k)));
}
function activate(id) { activeTab = id; drawTabs(); showPanes(); if (id === 'paper') setTimeout(() => E?.focus(), 0); }
function closeTab(id) { const r = readers.get(id); r?.api?.destroy?.(); readers.delete(id); $(`.reader-pane[data-tab="${id}"]`, ui.panes)?.remove(); tabs = tabs.filter((t) => t.id !== id); if (activeTab === id) activeTab = 'paper'; drawTabs(); showPanes(); }
async function openReader(sourceId, opts = {}) {
  const src = S.sources.get(sourceId); if (!src) return; const id = 'src:' + sourceId; let tab = tabs.find((t) => t.id === id);
  if (!tab) { tab = { id, kind: 'source', title: shortCite(src) }; tabs.push(tab); const pane = h('div.reader-pane', { 'data-tab': id }); ui.panes.append(pane); const host = h('div.reader-host'); pane.append(host); const api = await openReaderView(host, src, opts); readers.set(id, { api, pane }); }
  else if (opts.highlight || opts.page || opts.text) { const r = readers.get(id)?.api; if (opts.highlight) r?.goToHighlight?.(opts.highlight); else if (opts.page) r?.goToPage?.(opts.page); else if (opts.text) r?.search?.(opts.text); }
  if (innerWidth < 1100 && !S.ui.split) S.ui.split = false; activate(id); if (opts.highlight && tab) setTimeout(() => readers.get(id)?.api?.goToHighlight?.(opts.highlight), 150);
}
bus.on('open-reader', openReader);
bus.on('wiki-tab', (title) => { const id = 'wiki:' + title; let tab = tabs.find((t) => t.id === id); if (!tab) { tab = { id, kind: 'wiki', title: title.slice(0, 24) }; tabs.push(tab); const pane = h('div.reader-pane', { 'data-tab': id }); const host = h('div.wiki-host.expanded'); pane.append(host); ui.panes.append(pane); const v = new WikiView(host, { expanded: true }); v.load(title); readers.set(id, { api: { destroy() {} }, pane }); } activate(id); });
bus.on('focus-paper', () => activate('paper'));
bus.on('cite-source', (id) => { activate('paper'); setTimeout(() => { E.cmd.citation([{ sourceId: id }]); }, 30); });

function buildPaper() {
  ui.paperPane = h('div.paper-pane'); ui.paperScroll = h('div.paper-scroll'); ui.paper = h('article.paper'); ui.mount = h('div#paper-mount.paper-mount'); ui.notesEl = h('section.paper-notes', { 'aria-label': 'Notes' }); ui.bibEl = h('section.paper-bib', { 'aria-label': 'Bibliography' });
  ui.findbar = h('div.findbar', { hidden: true, role: 'search' }); ui.banner = h('div.mode-banner', { hidden: !S.suggest, role: 'status' }, icon('suggest', 14), h('span', 'Suggesting: text edits are tracked and can be accepted or rejected.'), h('button.link-btn', { onclick: () => setSuggesting(false) }, 'Switch to editing'), h('button.link-btn', { onclick: () => showPanel('changes') }, 'Review changes'));
  ui.paper.append(ui.mount, ui.notesEl, ui.bibEl); ui.paperScroll.append(ui.paper); ui.paperPane.append(ui.banner, ui.findbar, ui.paperScroll); clear(ui.panes).append(ui.paperPane);
}
function renderNotesAndBib() {
  const D = S.derived; if (!D) return; const A = D.A;
  // notes
  const notes = []; A.footnotes.forEach((f) => notes.push({ n: f.n, id: f.id, content: f.content, cites: D.fnCites.get(f.id) || [] })); A.citations.forEach((c, i) => { if (!c.inFootnote && c.asNote) notes.push({ n: c.noteIndex, cite: D.cites.get(c.id) }); }); notes.sort((a, b) => a.n - b.n);
  clear(ui.notesEl);
  if (notes.length) {
    const noteHTML = (n) => { if (n.cite != null) return n.cite; let ci = 0; const w = (arr) => (arr || []).map((x) => { if (x.type === 'text') return (x.marks || []).reduce((t, m) => (m.type === 'em' ? `<em>${t}</em>` : m.type === 'strong' ? `<strong>${t}</strong>` : m.type === 'sup' ? `<sup>${t}</sup>` : t), x.text.replace(/</g, '&lt;')); if (x.type === 'citation') return n.cites[ci++] || ''; if (x.type === 'math_inline') return `<code>${x.attrs.latex}</code>`; return w(x.content); }).join(''); return w(n.content); };
    const open = (n) => { if (!n.id) return; const p = E.posOf(n.id); if (p != null) { E.scrollTo(p, { flash: false }); editFootnoteAt(p, E.view.nodeDOM(p)); } };
    ui.notesEl.append(h('h2.sec-h', S.settings.noteMode === 'endnote' ? 'Endnotes' : 'Notes'), h('ol.notes', notes.map((n) => h('li', { value: n.n }, h('button.note-li', { onclick: () => open(n), html: noteHTML(n) || '<span class="muted">Empty note</span>' })))));
  }
  // bibliography
  clear(ui.bibEl); const title = { apa: 'References', mla: 'Works Cited', 'chicago-nb': 'Bibliography', 'chicago-ad': 'References', harvard: 'Reference list', ieee: 'References' }[D.styleId] || 'References';
  if (D.bib.entries.length) { ui.bibEl.append(h('h2.sec-h', title), h('div.bib' + (D.bib.params?.hangingindent ? '.hang' : ''), D.bib.entries.map((e) => h('div.bib-e', { html: e.html.replace(/^\s*<div class="csl-entry">|<\/div>\s*$/g, ''), onclick: () => bus.emit('open-source-detail', e.sourceId), title: 'Open source details' })))); } else ui.bibEl.append(h('p.muted.bib-empty', 'The bibliography appears here once you cite sources.'));
}
bus.on('derived', () => { renderNotesAndBib(); drawLeftSoon(); updateStatus(); });
function updateStatus() { const st = S.derived?.A; if (!st) return; ui.paperPane.dataset.words = st.bodyWords; const t = S.settings.targetWords; ui.wc.textContent = `${st.bodyWords.toLocaleString()} words${t ? ' of ' + t.toLocaleString() : ''}`; if (ui.wcBar) { ui.wcBar.style.setProperty('--w', (t ? Math.min(100, st.bodyWords / t * 100) : 0) + '%'); ui.wcBar.hidden = !t; } }

// ================= toolbar =================
function buildToolbar() {
  clear(ui.toolbar); const c = E.cmd; const b = (ic, label, run, extra = {}) => h('button.tb' + (extra.cls ? '.' + extra.cls : ''), { 'aria-label': label, title: label + (extra.kbd ? ' (' + kbd(extra.kbd) + ')' : ''), 'data-cmd': extra.id || '', 'aria-pressed': extra.id ? 'false' : null, onmousedown: (e) => e.preventDefault(), onclick: run }, typeof ic === 'string' && ic.length > 2 ? icon(ic, 16) : ic);
  const style = h('select.tb-sel', { 'aria-label': 'Paragraph style', onchange: (e) => { const v = e.target.value; if (v === 'p') c.paragraph(); else if (v === 'q') c.blockquote(); else if (v === 'n') c.callout(); else if (v === 'plan') c.planningHeading(); else c.heading(+v); e.target.blur(); E.focus(); } }, [['p', 'Normal text'], ['1', 'Heading 1'], ['2', 'Heading 2'], ['3', 'Heading 3'], ['4', 'Heading 4'], ['q', 'Block quote'], ['n', 'Drafting note'], ['plan', 'Planning heading']].map(([v, l]) => h('option', { value: v }, l)));
  ui.styleSel = style;
  const insert = h('button.tb.wide', { 'aria-haspopup': 'menu', onmousedown: (e) => e.preventDefault(), onclick: () => menu(insert, [
    { label: 'Citation', icon: 'book', kbd: '@', action: () => pickCitation() }, { label: 'Footnote', icon: 'footnote', kbd: 'Mod-Alt-f', action: () => c.footnote() }, { label: 'Cross-reference', icon: 'link', action: pickCrossref }, { divider: true },
    { label: 'Table', icon: 'table', action: () => c.table() }, { label: 'Image', icon: 'image', action: () => insertImage(false) }, { label: 'Figure with caption', icon: 'image', action: () => insertImage(true) }, { label: 'Equation', icon: 'sigma', action: () => c.mathBlock() }, { label: 'Inline equation', icon: 'sigma', kbd: 'Mod-Alt-e', action: () => c.mathInline() }, { divider: true },
    { label: 'Block quote', icon: 'quote', action: () => c.blockquote() }, { label: 'Drafting note', icon: 'note', action: () => c.callout() }, { label: 'Checklist', icon: 'tasks', action: () => c.tasks() }, { label: 'Divider', icon: 'minus', action: () => c.hr() }, { label: 'Page break', icon: 'hr', action: () => c.pageBreak() }, { label: 'Special character…', icon: 'hash', action: specialChars }], { label: 'Insert' }) }, icon('plus', 15), 'Insert', icon('down', 12));
  ui.mode = h('div.seg.mode-seg', { role: 'radiogroup', 'aria-label': 'Editing mode' }); drawMode();
  ui.wc = h('span.wc', { 'aria-live': 'off' }); ui.wcBar = h('span.wc-bar'); 
  ui.toolbar.append(b('undo', 'Undo', () => c.undo(), { kbd: 'Mod-z' }), b('redo', 'Redo', () => c.redo(), { kbd: 'Mod-Shift-z' }), h('span.tb-sep'), style, h('span.tb-sep'), b('bold', 'Bold', () => c.bold(), { id: 'bold', kbd: 'Mod-b' }), b('italic', 'Italic', () => c.italic(), { id: 'italic', kbd: 'Mod-i' }), b('underline', 'Underline', () => c.underline(), { id: 'underline', kbd: 'Mod-u' }), h('span.tb-sep'), b('list', 'Bulleted list', () => c.bullet(), { kbd: 'Mod-Shift-8' }), b('olist', 'Numbered list', () => c.ordered(), { kbd: 'Mod-Shift-7' }), b('tasks', 'Checklist', () => c.tasks()), b('link', 'Link', () => editLink(null)), h('span.tb-sep'), b('book', 'Insert citation', () => pickCitation(), { kbd: 'Mod-Alt-c' }), b('footnote', 'Footnote', () => c.footnote(), { kbd: 'Mod-Alt-f' }), insert, h('span.grow'), h('span.wc-wrap', ui.wc, ui.wcBar), ui.mode);
}
function drawMode() {
  if (!ui.mode) return; clear(ui.mode);
  [['edit', 'Editing', 'pencil'], ['suggest', 'Suggesting', 'suggest']].forEach(([v, l, ic]) => { const on = (v === 'suggest') === S.suggest; ui.mode.append(h('button.seg-b' + (on ? '.on' : ''), { role: 'radio', 'aria-checked': String(on), title: v === 'suggest' ? 'Suggesting: text edits are tracked (' + kbd('Mod-Shift-e') + ')' : 'Editing: changes apply directly', onmousedown: (e) => e.preventDefault(), onclick: () => setSuggesting(v === 'suggest') }, icon(ic, 13), l)); });
}
function setSuggesting(on) {
  on = !!on; const changed = S.suggest !== on; S.suggest = on; if (E) E.suggesting = on; drawMode(); document.body.classList.toggle('suggesting', on);
  if (ui.banner) { ui.banner.hidden = !on; }
  if (changed) { announce(on ? 'Suggesting mode on: text edits are tracked' : 'Editing mode on'); bus.emit('mode', on); }
  if (S.view === 'paper') E?.focus();
}
let lastUntracked = 0;
function untrackedNotice(kind) { if (Date.now() - lastUntracked < 20000) return; lastUntracked = Date.now(); toast(kind === 'composition' ? 'That edit came from an input method or autocorrect and was not tracked.' : 'That edit changed paragraph structure, which is not tracked. Typing, deleting and replacing text is.', { timeout: 6000 }); }
bus.on('set-suggesting', setSuggesting);
function updateToolbar(state) {
  const { $from, from, to, empty } = state.selection; const has = (t) => (empty ? !!t.isInSet(state.storedMarks || $from.marks()) : state.doc.rangeHasMark(from, to, t));
  $$('[data-cmd]', ui.toolbar).forEach((x) => { const t = { bold: M.strong, italic: M.em, underline: M.underline }[x.dataset.cmd]; if (t) { const on = has(t); x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); } });
  const p = $from.parent; let v = 'p'; if (p.type === T.heading) v = p.attrs.planning ? 'plan' : String(Math.min(4, p.attrs.level)); else for (let d = $from.depth; d > 0; d--) { const n = $from.node(d).type.name; if (n === 'blockquote') { v = 'q'; break; } if (n === 'callout') { v = 'n'; break; } } if (ui.styleSel) ui.styleSel.value = v;
}

// ================= editor hooks and actions =================
async function pickCitation() { const r = await pickSources({ title: 'Insert citation', showMode: true }); if (!r) return; activate('paper'); setTimeout(() => { E.cmd.citation(r.items, r.mode); }, 20); }
async function insertImage(numbered) { const [f] = await fileDialog({ accept: 'image/*' }); if (f) await insertImageFiles([f], null, numbered); }
async function insertImageFiles(files, pos, numbered = true) { for (const f of files) { const id = await addAsset(f, f.name); if (pos != null) E.view.dispatch(E.view.state.tr.setSelection(E.view.state.selection.constructor.near(E.view.state.doc.resolve(pos)))); E.cmd.figure({ assetId: id, alt: '', numbered }); } toast('Image added. Add alternative text from the figure options.'); }
function moreMenu(anchor) {
  const c = E.cmd; const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  menu(rect, [{ heading: 'Format' }, { label: 'Strikethrough', icon: 'strike', kbd: 'Mod-Shift-x', action: () => c.strike() }, { label: 'Superscript', icon: 'sup', kbd: 'Mod-.', action: () => c.sup() }, { label: 'Subscript', icon: 'sub', kbd: 'Mod-,', action: () => c.sub() }, { label: 'Code', icon: 'code', kbd: 'Mod-e', action: () => c.code() }, { label: 'Clear formatting', icon: 'reset', action: () => c.removeFormatting() }, { divider: true },
    { heading: 'Research' }, { label: 'Search research', icon: 'search', action: () => bus.emit('research-search', E.selectionText()) }, { label: 'Search Wikipedia', icon: 'globe', kbd: 'Mod-Alt-w', action: () => bus.emit('wiki-search', E.selectionText()) }, { label: 'Synonyms', icon: 'dict', action: () => { import('./language.js').then((m) => { m.dictState.tab = 'thesaurus'; bus.emit('define', E.selectionText()); }); } }, { divider: true },
    { heading: 'Mark up' }, { label: 'Create note…', icon: 'note', action: () => menu(rect, Object.entries({ idea: 'Idea', question: 'Question', paraphrase: 'Paraphrase', quotation: 'Quotation' }).map(([k, l]) => ({ label: l, action: () => addNoteForSelection(k) }))) }, { label: 'Mark as quotation', icon: 'quote', action: () => markQuote() }, { label: 'Mark as claim', icon: 'check', action: () => { const id = ensureClaim(E); if (id) { E.reanalyze(); showPanel('evidence'); } } }, { label: 'Link evidence to this sentence…', icon: 'link', action: linkEvidence }, { divider: true }, { label: 'Send selection to notes', icon: 'note', action: sendToNotes }]);
}
function markQuote() { const { from, to, empty } = E.view.state.selection; if (empty) return; E.view.dispatch(E.view.state.tr.addMark(from, to, M.quote.create({ quoteId: uid('q') })).setMeta('noSuggest', true)); toast('Marked as a quotation. Add a citation after it.'); }
async function linkEvidence() { const id = ensureClaim(E); if (!id) return; const r = await pickSources({ title: 'Link source as evidence', multi: true, locators: false, confirm: 'Link' }); r?.items.forEach((i) => addEvidence(id, 'source', i.sourceId)); E.reanalyze(); showPanel('evidence'); }
const hooks = {
  untracked: untrackedNotice, editMath: (pos) => editMathAt(pos, E.view.nodeDOM(pos)), editFootnote: (pos) => editFootnoteAt(pos, E.view.nodeDOM(pos)), citationInserted: () => { refreshDerived(); },
  clickNode(node, pos, ev) { if (node.type.name === 'link') return; },
  contextMenu: (e) => moreMenu({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0, getBoundingClientRect() { return this; } }),
  imageFiles: (files, pos) => insertImageFiles(files, pos, true), pasteCapture: handlePasteCapture, dropNote: (id, pos) => insertNoteIntoDraft(id, { form: S.notes.get(id)?.kind === 'quotation' ? 'inline' : 'text', pos }),
};
const api = { insertTable: () => E.cmd.table(), insertImage, pickCitation, pickCrossref, specialChars, addSource: (q) => addSourceDialog({ initial: q }), editCitationAt: (pos) => editCitationAt(pos, E.view.nodeDOM(pos)), editLink: (a) => editLink(a), addComment: () => { addComment(); }, define: () => bus.emit('define', E.selectionText()), moreMenu };

let selPopover = null;
function markOutlineCur() { if (S.view !== 'paper' || S.ui.leftTab !== 'outline') return; const hs = E.analysis().headings; let cur = -1; hs.forEach((x, i) => { if (x.pos < E.view.state.selection.from) cur = i; }); $$('.ol-row', ui.leftBody).forEach((r) => r.classList.toggle('cur', +r.dataset.i === cur)); }
const markOutlineSoon = debounce(markOutlineCur, 120);
function onSelection(state) {
  markOutlineSoon(); updateToolbar(state); updateTableBar(state); bus.emit('selection');
  const sel = state.selection; if (selPopover && !(sel instanceof NodeSelection && sel.node.type === T.figure)) { selPopover.close(); selPopover = null; }
  if (sel instanceof NodeSelection) {
    const n = sel.node.type.name;
    if (n === 'figure' && !selPopover) selPopover = figureOptions(sel.from);
    if (n === 'citation' && S.ui.rightOpen) showPanel('evidence', { citPos: sel.from });
    if (n === 'math_inline' || n === 'math_block') { /* edit on double-click / Enter */ }
  }
  trackSection(state);
}
const trackSection = debounce((state) => { const A = E.analysis(); let cur = null; A.headings.forEach((x) => { if (x.pos < state.selection.from) cur = x; }); if (cur && !cur.planning) pushRecent('sections', { id: cur.id, label: cur.text || 'Untitled' }); }, 4000);
function onKeyDocClick(e) { const el = e.target.closest?.('.cite, .fn-ref, .math-inline, .math-block, .xref'); if (!el) return; }
function attachEditorEvents() {
  const dom = E.view.dom;
  dom.addEventListener('dblclick', (e) => { const { selection } = E.view.state; if (selection instanceof NodeSelection) { const t = selection.node.type.name; if (t === 'citation') editCitationAt(selection.from, E.view.nodeDOM(selection.from)); else if (t === 'footnote') editFootnoteAt(selection.from, E.view.nodeDOM(selection.from)); else if (t.startsWith('math')) editMathAt(selection.from, E.view.nodeDOM(selection.from)); else if (t === 'crossref') pickCrossref(); } });
  dom.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { const { selection } = E.view.state; if (selection instanceof NodeSelection) { const t = selection.node.type.name; if (t === 'citation') { e.preventDefault(); editCitationAt(selection.from, E.view.nodeDOM(selection.from)); } else if (t === 'footnote') { e.preventDefault(); editFootnoteAt(selection.from, E.view.nodeDOM(selection.from)); } else if (t.startsWith('math')) { e.preventDefault(); editMathAt(selection.from, E.view.nodeDOM(selection.from)); } } } });
  dom.addEventListener('click', (e) => { const x = e.target.closest?.('.xref'); if (x && (e.metaKey || e.ctrlKey)) { const pos = E.view.posAtDOM(x, 0); const n = E.view.state.doc.nodeAt(pos); if (n?.attrs?.target) E.scrollToId(n.attrs.target); } const a = e.target.closest?.('a[href]'); if (a && (e.metaKey || e.ctrlKey)) window.open(a.href, '_blank', 'noopener'); const q = e.target.closest?.('[data-comment]'); if (q) showPanel('comments', { focus: q.dataset.comment }); });
}

// ================= palette, find, shortcuts =================
function commands() {
  const c = E.cmd, A = E.analysis();
  const base = [
    ['Insert citation', 'Insert', 'Mod-Alt-c', pickCitation], ['Add source', 'Library', '', () => addSourceDialog()], ['Import files, BibTeX, RIS…', 'Library', '', importFlow], ['Search research', 'Research', '', () => showPanel('research')], ['Search Wikipedia', 'Research', 'Mod-Alt-w', () => bus.emit('wiki-search', E.selectionText())], ['Define word', 'Research', 'Mod-Alt-d', () => bus.emit('define', E.selectionText())], ['Search project', 'Research', 'Mod-Shift-f', () => showPanel('search')],
    ['Insert footnote', 'Insert', 'Mod-Alt-f', () => c.footnote()], ['Insert equation', 'Insert', 'Mod-Alt-e', () => c.mathBlock()], ['Insert inline equation', 'Insert', '', () => c.mathInline()], ['Insert table', 'Insert', '', () => c.table()], ['Insert figure', 'Insert', '', () => insertImage(true)], ['Insert cross-reference', 'Insert', '', pickCrossref], ['Insert page break', 'Insert', '', () => c.pageBreak()], ['Special characters', 'Insert', '', specialChars],
    ['Add comment', 'Review', 'Mod-Alt-m', () => addComment()], ['Show comments', 'Review', '', () => showPanel('comments')], ['Show suggested changes', 'Review', '', () => showPanel('changes')], ['Citation audit', 'Review', '', () => showPanel('audit')], ['Evidence', 'Review', '', () => showPanel('evidence')], ['Writing statistics', 'Review', '', () => showPanel('stats')], ['Version history', 'Review', '', () => showPanel('versions')], ['Save named snapshot', 'Review', '', async () => { const n = await promptDialog('Name this snapshot', 'Name', '', { ok: 'Save snapshot' }); if (n !== undefined) { takeSnapshot(n || 'Snapshot'); toast('Snapshot saved'); } }], ['Source relationships', 'Review', '', () => showPanel('map')], ['Assist', 'Review', '', () => showPanel('assist')], ['Recent', 'Go to', '', () => showPanel('recent')],
    ['Find and replace in paper', 'Go to', 'Mod-f', () => (S.view === 'notes' ? openNbFind() : openFind(true))], ['All papers (dashboard)', 'Go to', 'Mod-Alt-h', () => setView('dashboard')], ['Switch to notes', 'Go to', 'Mod-Alt-n', () => setView('notes')], ['Switch to paper', 'Go to', 'Mod-Alt-n', () => setView('paper')], ['Toggle suggesting mode', 'Review', 'Mod-Shift-e', () => setSuggesting(!S.suggest)], ['Send selection to notes', 'Insert', '', sendToNotes], ['Open outline', 'Go to', '', () => { S.ui.leftOpen = true; S.ui.leftTab = 'outline'; drawLeft(); applyLayout(); }], ['Open library', 'Go to', '', () => { S.ui.leftOpen = true; S.ui.leftTab = 'sources'; drawLeft(); applyLayout(); }], ['Open notes', 'Go to', '', () => { S.ui.leftOpen = true; S.ui.leftTab = 'notes'; drawLeft(); applyLayout(); }], ['New note', 'Go to', '', () => noteDialog({ kind: 'idea' })],
    ['Toggle focus mode', 'View', 'Mod-Shift-Enter', () => setFocus(!S.ui.focus)], ['Toggle left sidebar', 'View', 'Mod-\\', () => toggle('left')], ['Toggle research panel', 'View', 'Mod-Shift-\\', () => toggle('right')], ['Keyboard shortcuts', 'View', 'Mod-/', shortcutsDialog], ['Project settings', 'Project', '', settingsDialog], ['Export…', 'Project', '', openExport], ['Print or save as PDF', 'Project', '', () => exportAs('pdf').catch((e) => toast(e.message, { kind: 'err' }))],
  ].map(([label, group, k, run]) => ({ label, group, kbd: k, run }));
  const papers = projectList.filter((p) => p.id !== S.id).map((p) => ({ label: 'Open paper: ' + (p.name || 'Untitled'), group: 'Papers', run: () => switchProject(p.id, 'paper') }));
  const secs = A.headings.map((x) => ({ label: x.text || 'Untitled', group: 'Jump to section', run: () => { activate('paper'); setTimeout(() => E.scrollTo(x.pos), 20); }, level: x.level }));
  return { base: [...base, ...papers], secs };
}
function openPalette() {
  const { base, secs } = commands(); const input = h('input.input.pal-in', { type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', placeholder: 'Type a command, section or source', 'aria-label': 'Command palette', autofocus: true }); const list = h('div#pal-list.pal-list', { role: 'listbox' }); let idx = 0, items = [];
  const draw = () => {
    const q = input.value.toLowerCase().trim(); const score = (l) => { const s = l.toLowerCase(); return !q ? 1 : s.startsWith(q) ? 3 : s.includes(q) ? 2 : q.split(/\s+/).every((w) => s.includes(w)) ? 1.5 : 0; };
    items = [...base.map((x) => ({ ...x, s: score(x.label) })), ...(q ? secs.map((x) => ({ ...x, s: score(x.label) })) : []), ...(q ? [...S.sources.values()].map((s) => ({ label: shortCite(s) + ' — ' + s.title, group: 'Sources', s: score(s.title + ' ' + shortCite(s)), run: () => bus.emit('open-source-detail', s.id), sec: 'Open details' })) : [])].filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 14);
    if (!q) { const r = S.recents.sources.slice(0, 3).filter((x) => S.sources.has(x.id)).map((x) => ({ label: 'Open ' + x.label.slice(0, 50), group: 'Recent', run: () => bus.emit('open-reader', x.id), s: 9 })); items = [...r, ...items].slice(0, 14); }
    idx = Math.min(idx, Math.max(0, items.length - 1)); clear(list); let g = ''; items.forEach((it, i) => { if (it.group !== g) { g = it.group; list.append(h('div.pal-g', g)); } list.append(h('button.pal-it' + (i === idx ? '.on' : ''), { role: 'option', 'aria-selected': String(i === idx), id: 'pal-' + i, onmouseenter: () => { idx = i; hl(); }, onclick: () => go(i) }, h('span', it.label), it.kbd && h('span.kbd', kbd(it.kbd)))); }); if (!items.length) list.append(h('p.empty-s', 'No matches')); input.setAttribute('aria-activedescendant', 'pal-' + idx);
  };
  const hl = () => { $$('.pal-it', list).forEach((b, i) => { b.classList.toggle('on', i === idx); b.setAttribute('aria-selected', String(i === idx)); }); input.setAttribute('aria-activedescendant', 'pal-' + idx); $('.pal-it.on', list)?.scrollIntoView({ block: 'nearest' }); };
  const go = (i) => { const it = items[i]; if (!it) return; dlg.close(); setTimeout(() => it.run(), 30); };
  input.addEventListener('input', () => { idx = 0; draw(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % Math.max(1, items.length); hl(); } else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % Math.max(1, items.length); hl(); } else if (e.key === 'Enter') { e.preventDefault(); go(idx); } });
  const dlg = dialog({ title: 'Command palette', body: h('div.pal', input, list), width: 560, className: 'palette' }); draw(); input.focus();
}
function openFind(replace) {
  const fb = ui.findbar; fb.hidden = false; clear(fb); activate('paper'); const sel = E.selectionText(); let cs = false, ww = false;
  const q = h('input.input.sm', { type: 'search', 'aria-label': 'Find', placeholder: 'Find', value: sel && sel.length < 80 ? sel : E.find.get().q.text }); const r = h('input.input.sm', { 'aria-label': 'Replace with', placeholder: 'Replace with' }); const cnt = h('span.muted.fc');
  const upd = () => { E.find.set({ text: q.value, cs, ww }, 0); const s = E.find.get(); cnt.textContent = q.value ? (s.matches.length ? `${s.idx + 1} of ${s.matches.length}` : 'No matches') : ''; };
  const step = (d) => { E.find.step(d); const s = E.find.get(); cnt.textContent = `${s.idx + 1} of ${s.matches.length}`; };
  q.addEventListener('input', upd); q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeFind(); }); r.addEventListener('keydown', (e) => { if (e.key === 'Enter') { E.find.replace(r.value); upd(); } if (e.key === 'Escape') closeFind(); });
  fb.append(q, h('button.icon-btn.sm', { 'aria-label': 'Previous match', onclick: () => step(-1) }, icon('up', 14)), h('button.icon-btn.sm', { 'aria-label': 'Next match', onclick: () => step(1) }, icon('down', 14)), h('label.check', h('input', { type: 'checkbox', onchange: (e) => { cs = e.target.checked; upd(); } }), 'Match case'), h('label.check', h('input', { type: 'checkbox', onchange: (e) => { ww = e.target.checked; upd(); } }), 'Whole word'), cnt, r, h('button.btn.sm', { onclick: () => { E.find.replace(r.value); upd(); } }, 'Replace'), h('button.btn.sm', { onclick: () => { const n = E.find.replaceAll(r.value); toast(`Replaced ${n}`); upd(); } }, 'Replace all'), h('button.icon-btn.sm', { 'aria-label': 'Close find', onclick: closeFind }, icon('x', 14)));
  q.focus(); q.select(); upd();
}
function closeFind() { ui.findbar.hidden = true; E.find.set({ text: '' }, 0); E.focus(); }
const SHORT = [['Text', [['Bold', 'Mod-b'], ['Italic', 'Mod-i'], ['Underline', 'Mod-u'], ['Strikethrough', 'Mod-Shift-x'], ['Superscript', 'Mod-.'], ['Subscript', 'Mod-,'], ['Code', 'Mod-e'], ['Heading 1–3', 'Mod-Alt-1…3'], ['Normal text', 'Mod-Alt-0'], ['Bulleted / numbered list', 'Mod-Shift-8 / 7'], ['Block quote', 'Mod-Shift-9']]], ['Insert', [['Citation (type @ in text)', 'Mod-Alt-c'], ['Footnote', 'Mod-Alt-f'], ['Inline equation', 'Mod-Alt-e'], ['Commands (at start of a line)', '/'], ['Edit citation, note or equation', 'Enter (when selected)']]], ['Research', [['Define word', 'Mod-Alt-d'], ['Search Wikipedia', 'Mod-Alt-w'], ['Search project', 'Mod-Shift-f'], ['Add comment', 'Mod-Alt-m']]], ['Navigate', [['Command palette', 'Mod-k'], ['Find and replace', 'Mod-f'], ['Toggle left sidebar', 'Mod-\\'], ['Toggle research panel', 'Mod-Shift-\\'], ['Focus mode', 'Mod-Shift-Enter'], ['Move block up / down', 'Alt-↑ / ↓'], ['Undo / redo', 'Mod-z / Mod-Shift-z'], ['This list', 'Mod-/']]]];
function shortcutsDialog() { dialog({ title: 'Keyboard shortcuts', width: 560, body: h('div.shortcuts', SHORT.map(([g, rows]) => h('div.sc-g', h('div.sd-h', g), rows.map(([l, k]) => h('div.sc-r', h('span', l), h('span.kbd', kbd(k))))))) }); }
function globalKeys(e) {
  const mod = isMac ? e.metaKey : e.ctrlKey; const k = e.key.toLowerCase();
  if (e.key === 'Escape' && !S.ui.focus && S.view === 'notes' && ui.nbFind && !ui.nbFind.hidden && ui.nbFind.contains(document.activeElement)) { closeNbFind(); return; }
  if (e.key === 'Escape' && S.ui.focus && !document.querySelector('dialog[open], .popover')) { setFocus(false); return; }
  if (!mod) return;
  const done = () => { e.preventDefault(); e.stopPropagation(); };
  if (k === 'k' && !e.shiftKey && !e.altKey) { done(); openPalette(); }
  else if (k === 'f' && !e.shiftKey && !e.altKey) { done(); if (S.view === 'dashboard') return; S.view === 'notes' ? openNbFind() : openFind(true); }
  else if (k === 'e' && e.shiftKey && !e.altKey) { done(); if (S.view === 'paper') setSuggesting(!S.suggest); }
  else if (e.code === 'KeyN' && e.altKey) { done(); if (S.view !== 'dashboard') setView(S.view === 'notes' ? 'paper' : 'notes'); }
  else if (e.code === 'KeyH' && e.altKey) { done(); setView('dashboard'); }
  else if (k === 'f' && e.shiftKey) { done(); showPanel('search'); }
  else if ((k === 'c' || e.code === 'KeyC') && e.altKey) { done(); pickCitation(); }
  else if (e.code === 'KeyD' && e.altKey) { done(); bus.emit('define', E.selectionText()); }
  else if (e.code === 'KeyW' && e.altKey) { done(); bus.emit('wiki-search', E.selectionText()); }
  else if (e.code === 'KeyM' && e.altKey) { done(); addComment(); }
  else if (e.code === 'Backslash' && !e.shiftKey) { done(); toggle('left'); }
  else if (e.code === 'Backslash' && e.shiftKey) { done(); toggle('right'); }
  else if (e.key === 'Enter' && e.shiftKey) { done(); setFocus(!S.ui.focus); }
  else if (e.key === '/' ) { done(); shortcutsDialog(); }
}

// ================= project / settings / export dialogs =================
async function projectMenu() {
  const projects = (await DB.listProjects()).sort((a, b) => b.updatedAt - a.updatedAt);
  menu(ui.projBtn, [{ label: 'All papers (dashboard)', icon: 'library', kbd: 'Mod-Alt-h', action: () => setView('dashboard') }, { divider: true }, { heading: 'Switch paper' }, ...projects.map((p) => ({ label: p.name || 'Untitled', checked: p.id === S.id, action: () => switchProject(p.id, S.view === 'notes' ? 'notes' : 'paper') })), { divider: true },
    { label: 'New blank paper', icon: 'plus', action: async () => { const n = await promptDialog('New paper', 'Title', '', { ok: 'Create' }); if (n === undefined) return; await flushDoc(); const id = await createBlank(n.trim() || 'Untitled paper'); await switchProject(id, 'paper'); } },
    { label: 'Add the example paper', icon: 'file', action: async () => { await flushDoc(); const id = await createSample(); await switchProject(id, 'paper'); } }, { divider: true },
    { label: 'Project settings…', icon: 'settings', action: settingsDialog }, { label: 'Import Word or Markdown into this paper…', icon: 'fileUp', action: async () => { const [f] = await fileDialog({ accept: '.docx,.md,.markdown,.txt' }); if (!f) return; try { /\.docx$/i.test(f.name) ? await importDocx(f) : await importMarkdown(f); } catch (e) { toast(e.message, { kind: 'err' }); } } },
    { label: 'Back up project to a file', icon: 'download', action: () => exportProject(S.id) }, { label: 'Restore project from backup…', icon: 'upload', action: async () => { const [f] = await fileDialog({ accept: '.json' }); if (!f) return; try { const id = await importProject(f); await switchProject(id, 'paper'); toast('Project restored'); } catch (e) { toast(e.message, { kind: 'err' }); } } }, { divider: true },
    { label: 'Delete this project…', icon: 'trash', action: async () => { if (projects.length < 2) { toast('Keep at least one project'); return; } if (await confirmDialog('Delete this project?', `“${S.project.name}” with its sources, notes, highlights and files will be permanently removed from this browser. Back it up first if you might need it.`, { ok: 'Delete project', danger: true })) { const id = S.id; await flushDoc(); const other = projects.find((p) => p.id !== id); await openProject(other.id); await S.mounting; await DB.deleteProject(id); toast('Project deleted'); setView('dashboard'); } } }], { label: 'Project menu' });
}
function settingsDialog() {
  const st = S.settings; const d = JSON.parse(JSON.stringify(st)); const inp = (k, o = {}) => h('input.input', { value: d[k] || '', oninput: (e) => { d[k] = e.target.value; }, ...o });
  const styleSel = h('select.input', { onchange: (e) => { d.citationStyle = e.target.value; } }, listStyles().map((s) => h('option', { value: s.id, selected: d.citationStyle === s.id }, s.name)));
  const ex = d.export; const exf = (k, label, type = 'text', opts) => field(label, opts ? h('select.input', { onchange: (e) => { ex[k] = type === 'number' ? +e.target.value : e.target.value; } }, opts.map(([v, l]) => h('option', { value: v, selected: String(ex[k]) === String(v) }, l))) : h('input.input', { type, value: ex[k], step: 'any', onchange: (e) => { ex[k] = type === 'number' ? +e.target.value : e.target.value; } }));
  const preset = h('select.input', { 'aria-label': 'Export preset', onchange: (e) => { const p = EXPORT_PRESETS[e.target.value]; if (p) { Object.assign(ex, p); d.exportPreset = e.target.value; d.export = ex; applySettings(d); dlg.close(); settingsDialog(); } } }, h('option', { value: '' }, 'Custom'), Object.entries(EXPORT_PRESETS).map(([k, p]) => h('option', { value: k, selected: d.exportPreset === k }, p.name)));
  const css = h('input', { type: 'file', accept: '.csl,.xml', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; const xml = await f.text(); const title = /<title[^>]*>([^<]+)</.exec(xml)?.[1] || f.name; const id = 'custom-' + f.name.replace(/\W+/g, '-'); registerStyle(id, title, xml); d.customStyles = { ...(d.customStyles || {}), [id]: { title, xml } }; d.citationStyle = id; toast('Imported style: ' + title); } });
  const body = h('div.settings', h('div.f2', field('Paper title', inp('title')), field('Author', inp('author'))), h('div.f2', field('Institution', inp('institution')), field('Course', inp('course'))), h('div.f2', field('Instructor', inp('instructor')), field('Date', inp('date'), 'Shown on the title page.')),
    h('div.f2', field('Citation style', styleSel), field('Notes', h('select.input', { onchange: (e) => { d.noteMode = e.target.value; } }, [['footnote', 'Footnotes'], ['endnote', 'Endnotes (in exports)']].map(([v, l]) => h('option', { value: v, selected: d.noteMode === v }, l))))), field('Import a CSL style', css, 'Any CSL 1.0 file from the CSL style repository.'),
    h('div.f2', field('Language', h('select.input', { onchange: (e) => { d.language = e.target.value; d.spell = e.target.value; } }, [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['it-IT', 'Italiano'], ['pt-BR', 'Português']].map(([v, l]) => h('option', { value: v, selected: d.language === v }, l))), 'Sets spell-check and dictionary language. Citation text uses US English terms.'), field('Target words', h('input.input', { type: 'number', min: 0, value: d.targetWords || '', onchange: (e) => { d.targetWords = +e.target.value || 0; } }))),
    h('div.f2', h('label.check', h('input', { type: 'checkbox', checked: d.numberHeadings, onchange: (e) => { d.numberHeadings = e.target.checked; } }), 'Number headings'), h('label.check', h('input', { type: 'checkbox', checked: d.includeUncited, onchange: (e) => { d.includeUncited = e.target.checked; } }), 'Include uncited library sources in the bibliography')), field('Appearance', segmented([['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']], d.theme, (v) => { d.theme = v; }, 'Theme')),
    h('div.sd-h', 'Export defaults'), field('Preset', preset), h('div.f3', exf('pageSize', 'Page size', 'text', [['letter', 'Letter'], ['a4', 'A4'], ['legal', 'Legal']]), exf('margin', 'Margins (in)', 'number'), exf('font', 'Font')), h('div.f3', exf('size', 'Font size (pt)', 'number'), exf('line', 'Line spacing', 'number'), exf('paraSpace', 'Paragraph space (pt)', 'number')), h('div.f3', exf('indent', 'First-line indent (in)', 'number'), exf('runningHeader', 'Running header', 'text', [['none', 'None'], ['title', 'Short title'], ['author', 'Author surname']]), exf('headingStyle', 'Heading style', 'text', [['apa', 'APA'], ['mla', 'MLA'], ['chicago', 'Chicago'], ['generic', 'Generic']])), h('div.f2', h('label.check', h('input', { type: 'checkbox', checked: ex.pageNumbers, onchange: (e) => { ex.pageNumbers = e.target.checked; } }), 'Page numbers'), h('label.check', h('input', { type: 'checkbox', checked: ex.titlePage, onchange: (e) => { ex.titlePage = e.target.checked; } }), 'Title page')));
  settingsDraft = d; var dlg = dialog({ title: 'Project settings', body, width: 640, actions: [{ label: 'Cancel', value: false }, { label: 'Save', primary: true, onClick: () => { applySettings(d); } }] });
}
let settingsDraft = null; function settingsDialog2(d) { settingsDialog(); }
function applySettings(d) {
  const styleChanged = d.citationStyle !== S.settings.citationStyle; saveSettings(d); renameProject(d.title || S.project.name); applyTheme(); E.view.dom.setAttribute('lang', d.spell.split('-')[0]);
  const t = E.view.state.doc.child(0); if (d.title && !t.textContent) E.view.dispatch(E.view.state.tr.insertText(d.title, 1, 1).setMeta('noSuggest', true)); const au = E.view.state.doc.child(2); if (d.author && !au.textContent) { const p = t.nodeSize + E.view.state.doc.child(1).nodeSize; E.view.dispatch(E.view.state.tr.insertText(d.author, p + 1, p + 1).setMeta('noSuggest', true)); }
  E.reanalyze(); refreshDerived(); updateProjName(); if (styleChanged) toast('Citations and bibliography reformatted as ' + (listStyles().find((s) => s.id === d.citationStyle)?.name || d.citationStyle));
}
function applyTheme() { document.documentElement.dataset.theme = S.settings.theme === 'auto' ? '' : S.settings.theme; }
function updateProjName() { const n = $('.proj-n', ui.projBtn); if (n) n.textContent = S.project.name || 'Untitled'; document.title = (S.project.name || 'Paper') + ' · Paper'; }
function openExport() {
  const o = { ...S.settings.export }; let fmt = 'docx'; const fmts = [['docx', 'Word (.docx)', 'Headings, citations, real footnotes, tables, figures, equations.'], ['pdf', 'PDF', 'Opens the print dialog; choose “Save as PDF”. Notes print as endnotes.'], ['md', 'Markdown', 'Zip with images when figures exist.'], ['html', 'HTML', 'Single self-contained file; equations as MathML.'], ['txt', 'Plain text', ''], ['latex', 'LaTeX', 'Zip with .tex, .bib and figures; uses biblatex.'], ['bibtex', 'BibTeX', 'Cited sources.'], ['ris', 'RIS', 'Cited sources.'], ['csljson', 'CSL JSON', 'Cited sources.']];
  const info = h('p.muted'); const box = h('div.export-opts'); let all = false;
  const draw = () => { clear(box); info.textContent = fmts.find((f) => f[0] === fmt)[2]; if (['docx', 'pdf', 'html'].includes(fmt)) { const p = h('select.input.sm', { onchange: (e) => { const x = EXPORT_PRESETS[e.target.value]; if (x) { Object.assign(o, x); draw(); } } }, h('option', { value: '' }, 'Preset…'), Object.entries(EXPORT_PRESETS).map(([k, v]) => h('option', { value: k }, v.name))); box.append(h('div.f3', field('Preset', p), field('Page size', h('select.input.sm', { onchange: (e) => { o.pageSize = e.target.value; } }, [['letter', 'Letter'], ['a4', 'A4'], ['legal', 'Legal']].map(([v, l]) => h('option', { value: v, selected: o.pageSize === v }, l)))), field('Margins (in)', h('input.input.sm', { type: 'number', step: 0.1, value: o.margin, onchange: (e) => { o.margin = +e.target.value; } }))), h('div.f3', field('Font', h('input.input.sm', { value: o.font, onchange: (e) => { o.font = e.target.value; } })), field('Size (pt)', h('input.input.sm', { type: 'number', value: o.size, onchange: (e) => { o.size = +e.target.value; } })), field('Line spacing', h('input.input.sm', { type: 'number', step: 0.1, value: o.line, onchange: (e) => { o.line = +e.target.value; } }))), h('div.f3', field('Paragraph space (pt)', h('input.input.sm', { type: 'number', value: o.paraSpace, onchange: (e) => { o.paraSpace = +e.target.value; } })), field('Running header', h('select.input.sm', { onchange: (e) => { o.runningHeader = e.target.value; } }, [['none', 'None'], ['title', 'Short title'], ['author', 'Author surname']].map(([v, l]) => h('option', { value: v, selected: o.runningHeader === v }, l)))), h('div', h('label.check', h('input', { type: 'checkbox', checked: o.pageNumbers, onchange: (e) => { o.pageNumbers = e.target.checked; } }), 'Page numbers'), h('label.check', h('input', { type: 'checkbox', checked: o.titlePage, onchange: (e) => { o.titlePage = e.target.checked; } }), 'Title page')))); box.append(h('p.muted.sm', 'Pending suggested changes are exported as accepted. Planning headings and drafting notes are left out.')); } else if (['bibtex', 'ris', 'csljson'].includes(fmt)) box.append(h('label.check', h('input', { type: 'checkbox', onchange: (e) => { all = e.target.checked; } }), 'Include uncited library sources')); };
  const list = h('div.fmt-list', { role: 'radiogroup', 'aria-label': 'Format' }, fmts.map(([k, l]) => h('label.fmt', h('input', { type: 'radio', name: 'fmt', checked: k === fmt, onchange: () => { fmt = k; draw(); } }), l))); draw();
  dialog({ title: 'Export', width: 560, body: h('div.export', list, info, box), actions: [{ label: 'Cancel', value: false }, { label: 'Export', primary: true, onClick: async (d, close) => { try { toast('Preparing export…'); await flushDoc(); const f = await exportAs(fmt, { ...o, all }); if (f !== 'print') toast('Exported ' + f); } catch (e) { console.error(e); toast('Export failed: ' + e.message, { kind: 'err' }); } } }] });
}
function drawSave(st) { const t = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Not saved' }[st]; clear(ui.save); ui.save.className = 'save ' + st; ui.save.append(t, st === 'error' ? h('button.link-btn', { onclick: retrySave }, ' Retry') : null); }
bus.on('save', drawSave);

// ================= project mounting =================
async function mountProject() {
  buildPaper(); tabs = [{ id: 'paper', kind: 'paper', title: 'Paper' }]; activeTab = 'paper'; readers.forEach((r) => r.api?.destroy?.()); readers.clear();
  const P = S.P; let json = P.docJSON; if (!json) { const { emptyDoc } = await import('./schema.js'); json = emptyDoc({ title: P.project.settings.title }); }
  S.settings.customStyles && Object.entries(S.settings.customStyles).forEach(([id, v]) => registerStyle(id, v.title, v.xml));
  applyTheme(); E = null; S.editor = null;
  const sampleOK = (() => { try { return schema.nodeFromJSON(json) && true; } catch (e) { console.error('Stored document invalid', e); return false; } })();
  if (!sampleOK) { const { emptyDoc } = await import('./schema.js'); json = emptyDoc({ title: P.project.settings.title }); toast('The stored draft could not be read; started from a blank page. A recovery copy was kept.', { kind: 'err' }); }
  E = createEditor(ui.mount, { doc: json, flags, hooks, spell: S.settings.spell, onDoc: (changed) => { if (changed) { docChanged(E.getJSON()); refreshDerivedSoon(); } }, onSelection });
  E.author = 'You'; S.editor = E; E.suggesting = false; S.suggest = false; drawMode(); window.__E = E; installEditorUI(E, api); attachEditorEvents(); buildToolbar(); buildNotes(); drawTabs(); showPanes(); updateProjName(); drawLeft(); refreshProjectList(); drawViewSw();
  ui.nbPane.hidden = S.view !== 'notes'; ui.panes.hidden = S.view === 'notes';
  refreshDerived(); renderNotesAndBib(); updateToolbar(E.view.state); updateStatus(); drawSave('saved'); applyLayout();
  if (P.recovered) toast('Recovered unsaved work from this browser.', { timeout: 7000 });
  if (matchMedia('(pointer: fine)').matches) setTimeout(() => { if (E.view.state.doc.child(0).textContent) { /* keep focus out of the title for new readers */ } else E.view.focus(); }, 100);
}
bus.on('project', () => { S.mounting = mountProject(); });
const refreshProjectList = async () => { projectList = (await DB.listProjects()).sort((a, b) => b.updatedAt - a.updatedAt); };
bus.on('settings', () => { updateProjName(); updateStatus(); });
bus.on('highlights', () => {});

// ================= start =================
window.__S = S; import('./exporters.js').then((m) => { window.__exp = m; }); import('./export-model.js').then((m) => { window.__model = m; });
addEventListener('DOMContentLoaded', async () => {
  document.documentElement.classList.toggle('desktop-app', !!window.paperDesktop);
  buildShell(); document.addEventListener('keydown', globalKeys, true);
  try { await boot(); } catch (e) { console.error(e); $('#app').append(h('div.fatal', h('h1', 'This browser could not open local storage'), h('p', e.message), h('p', 'Private browsing modes can block IndexedDB. Open the app in a normal window.'))); return; }
  await S.mounting; await setView('dashboard');
  const st = await checkServer();
  if (!st.desktop && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.paperDesktop?.onOpenAssist?.(() => showPanel('assist'));
  navigator.storage?.persist?.();
});
