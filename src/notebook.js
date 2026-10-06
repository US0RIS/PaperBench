// Notebook: one endless free-form notes document per project. Supports [[links]] to its own blocks, paper sections and sources.
import { Schema, Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands } from 'prosemirror-commands';
import { inputRules, wrappingInputRule, textblockTypeInputRule, InputRule, smartQuotes, ellipsis } from 'prosemirror-inputrules';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { schema as paperSchema } from './schema.js';
import { findPlugin, findKey } from './editor.js';
import { nodeViews as paperViews } from './nodeviews.js';
import { S } from './state.js';
import { h, icon, clear, $, bus } from './ui.js';
import { uid, shortCite, namesDisplay, yearOf, stripTags } from './model.js';

const sp = paperSchema.spec.nodes;
const nodes = { doc: { content: 'block+' }, paragraph: sp.get('paragraph'), heading: sp.get('heading'), blockquote: sp.get('blockquote'), bullet_list: sp.get('bullet_list'), ordered_list: sp.get('ordered_list'), list_item: sp.get('list_item'), task_list: sp.get('task_list'), task_item: sp.get('task_item'), code_block: sp.get('code_block'), horizontal_rule: sp.get('horizontal_rule'), text: sp.get('text'), hard_break: sp.get('hard_break'),
  notelink: { inline: true, group: 'inline', atom: true, selectable: true, attrs: { kind: { default: 'note' }, target: { default: '' }, label: { default: '' } }, parseDOM: [{ tag: 'span[data-nl]', getAttrs: (d) => ({ kind: d.dataset.kind, target: d.dataset.target, label: d.textContent }) }], toDOM: (n) => ['span', { 'data-nl': '', 'data-kind': n.attrs.kind, 'data-target': n.attrs.target }, n.attrs.label] } };
const mk = paperSchema.spec.marks;
export const noteSchema = new Schema({ nodes, marks: { link: mk.get('link'), em: mk.get('em'), strong: mk.get('strong'), underline: mk.get('underline'), strike: mk.get('strike'), code: mk.get('code'), highlight: { parseDOM: [{ tag: 'mark' }], toDOM: () => ['mark', 0] } } });
const T = noteSchema.nodes, M = noteSchema.marks;
export const emptyNotebook = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });
const IDT = new Set(['paragraph', 'heading', 'blockquote', 'bullet_list', 'ordered_list', 'task_list', 'code_block']);
const idsPlugin = new Plugin({ appendTransaction(trs, o, st) { if (!trs.some((t) => t.docChanged)) return null; const seen = new Set(); let tr = null; st.doc.descendants((n, pos) => { if (!IDT.has(n.type.name)) return; if (!n.attrs.id || seen.has(n.attrs.id)) { tr = tr || st.tr; tr.setNodeMarkup(pos, null, { ...n.attrs, id: uid('nb') }); } else seen.add(n.attrs.id); }); return tr ? tr.setMeta('addToHistory', false) : null; } });
const linkLabel = (a) => a.label || (a.kind === 'source' ? shortCite(S.sources.get(a.target) || { title: 'source' }) : 'link');

class NoteLinkView {
  constructor(node, view, getPos) { this.node = node; this.dom = h('span.nlink', { role: 'link', tabindex: '-1', 'data-kind': node.attrs.kind }); this.render(); this.dom.addEventListener('click', (e) => { if (e.button === 0) { e.preventDefault(); bus.emit('notelink-open', this.node.attrs); } }); }
  render() { const a = this.node.attrs; let ok = true, label = linkLabel(a); if (a.kind === 'source') ok = S.sources.has(a.target); else if (a.kind === 'paper') { const p = S.editor?.posOf(a.target); ok = p != null; } this.dom.textContent = label; this.dom.classList.toggle('broken', !ok); this.dom.title = { note: 'Link to a block in these notes', paper: 'Link to the paper', source: 'Link to a source' }[a.kind] + (ok ? '' : ' (target no longer exists)'); }
  update(n) { if (n.type !== this.node.type) return false; this.node = n; this.render(); return true; }
  stopEvent() { return false; } ignoreMutation() { return true; }
}

function rules() {
  const markRule = (re, type, delim) => new InputRule(re, (state, match, start, end) => { const lead = match[1].length, inner = match[2], s = start + lead; const tr = state.tr; tr.delete(end - (delim - 1), end); tr.delete(s, s + delim); tr.addMark(s, s + inner.length, type.create()); tr.removeStoredMark(type); return tr; });
  return inputRules({ rules: [textblockTypeInputRule(/^(#{1,4})\s$/, T.heading, (m) => ({ level: m[1].length })), wrappingInputRule(/^\s*>\s$/, T.blockquote), wrappingInputRule(/^\s*([-+*])\s$/, T.bullet_list), wrappingInputRule(/^(\d+)\.\s$/, T.ordered_list, (m) => ({ order: +m[1] }), (m, n) => n.childCount + n.attrs.order === +m[1]), wrappingInputRule(/^\s*\[( |x)?\]\s$/, T.task_list), textblockTypeInputRule(/^```$/, T.code_block),
    new InputRule(/^---$/, (state, m, start) => { const $ = state.doc.resolve(start); if ($.depth !== 1) return null; return state.tr.replaceWith($.before(), $.after(), [T.horizontal_rule.create(), T.paragraph.create()]); }),
    markRule(/(^|\s)\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, M.strong, 2), markRule(/(^|\s)\*([^*\s](?:[^*]*[^*\s])?)\*$/, M.em, 1), markRule(/(^|\s)`([^`\s](?:[^`]*[^`\s])?)`$/, M.code, 1), markRule(/(^|\s)==([^=\s](?:[^=]*[^=\s])?)==$/, M.highlight, 2), ...smartQuotes, ellipsis] });
}

export function createNotebook(mount, { json, onChange, onLink }) {
  let view, menuEl = null, mode = null, range = null, list = [], idx = 0;
  const run = (c) => { const r = c(view.state, view.dispatch, view); view.focus(); return r; };
  const cmd = {
    bold: () => run(toggleMark(M.strong)), italic: () => run(toggleMark(M.em)), underline: () => run(toggleMark(M.underline)), strike: () => run(toggleMark(M.strike)), code: () => run(toggleMark(M.code)), highlight: () => run(toggleMark(M.highlight)),
    paragraph: () => run(setBlockType(T.paragraph)), heading: (l) => { const p = view.state.selection.$from.parent; return run(p.type === T.heading && p.attrs.level === l ? setBlockType(T.paragraph) : setBlockType(T.heading, { level: l })); },
    bullet: () => run(wrapInList(T.bullet_list)), ordered: () => run(wrapInList(T.ordered_list)), tasks: () => run(wrapInList(T.task_list)), quote: () => run(wrapIn(T.blockquote)), codeBlock: () => run(setBlockType(T.code_block)),
    hr: () => { view.dispatch(view.state.tr.replaceSelectionWith(T.horizontal_rule.create())); view.focus(); }, undo: () => run(undo), redo: () => run(redo),
  };
  // ---- floating suggestion menu: "/" blocks and "[[" links
  const SLASH = [['Heading 1', () => cmd.heading(1), 'h1 heading'], ['Heading 2', () => cmd.heading(2), 'h2 heading'], ['Heading 3', () => cmd.heading(3), 'h3 heading'], ['Bulleted list', () => cmd.bullet(), 'list bullet'], ['Numbered list', () => cmd.ordered(), 'list number'], ['Checklist', () => cmd.tasks(), 'todo task check'], ['Quote', () => cmd.quote(), 'quote'], ['Code block', () => cmd.codeBlock(), 'code'], ['Divider', () => cmd.hr(), 'rule divider'], ['Link to…', () => insertText('[['), 'link']];
  const insertText = (t) => { view.dispatch(view.state.tr.insertText(t)); };
  function linkCandidates(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean); const hit = (t) => words.every((w) => t.toLowerCase().includes(w)); const out = [];
    view.state.doc.descendants((n, pos) => { if (out.filter((x) => x.group === 'In these notes').length >= 8) return false; if ((n.type === T.heading || n.type === T.paragraph || n.type === T.blockquote) && n.attrs.id && n.textContent.trim() && pos !== range?.blockPos && hit(n.textContent)) out.push({ group: 'In these notes', kind: 'note', target: n.attrs.id, label: n.textContent.trim().slice(0, 60), sub: n.type === T.heading ? 'Heading' : 'Block', heading: n.type === T.heading }); return true; });
    out.sort((a, b) => (b.heading ? 1 : 0) - (a.heading ? 1 : 0));
    const E = S.editor; if (E) { let c = 0; E.view.state.doc.descendants((n) => { if (c >= 8) return false; if ((n.type.name === 'heading' || n.type.name === 'figure' || n.type.name === 'table_block') && n.attrs.id) { const t = n.type.name === 'heading' ? n.textContent : n.textContent || n.type.name; if (t.trim() && hit(t)) { out.push({ group: 'In the paper', kind: 'paper', target: n.attrs.id, label: t.trim().slice(0, 60), sub: n.type.name === 'heading' ? 'Section' : n.type.name === 'figure' ? 'Figure' : 'Table' }); c++; } } return n.type.name !== 'paragraph'; }); }
    [...S.sources.values()].filter((s) => hit(`${s.title} ${namesDisplay(s.author)} ${yearOf(s)}`)).slice(0, 6).forEach((s) => out.push({ group: 'Sources', kind: 'source', target: s.id, label: shortCite(s), sub: s.title.slice(0, 50) }));
    const rank = (x) => (x.heading || x.group === 'In the paper' ? 0 : x.group === 'Sources' ? 1 : 2); return out.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map((o) => o.x);
  }
  const hideMenu = () => { mode = null; menuEl?.remove(); menuEl = null; };
  function drawMenu() {
    if (!mode) return; if (!menuEl) { menuEl = h('div.suggest', { role: 'listbox' }); document.body.append(menuEl); } clear(menuEl);
    if (!list.length) menuEl.append(h('div.suggest-empty', mode === 'slash' ? 'No matching block' : 'Nothing matches. Keep typing to search notes, paper sections and sources.'));
    let g = ''; list.forEach((it, i) => { if (mode === 'link' && it.group !== g) { g = it.group; menuEl.append(h('div.suggest-hint', g)); } menuEl.append(h('button.suggest-it' + (i === idx ? '.on' : ''), { role: 'option', 'aria-selected': String(i === idx), onmousedown: (e) => { e.preventDefault(); choose(i); }, onmousemove: () => { if (idx !== i) { idx = i; drawMenu(); } } }, h('span.suggest-b', h('span.suggest-t', mode === 'slash' ? it[0] : it.label), mode === 'link' && it.sub && h('span.suggest-d', it.sub)))); });
    const c = view.coordsAtPos(range.from); const w = menuEl.offsetWidth, hh = menuEl.offsetHeight; menuEl.style.left = Math.max(8, Math.min(c.left, innerWidth - w - 8)) + 'px'; menuEl.style.top = (c.bottom + hh + 12 > innerHeight && c.top > hh + 12 ? c.top - hh - 6 : c.bottom + 6) + 'px'; menuEl.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    const it = list[i]; if (!it) return; const m = mode; hideMenu(); view.dispatch(view.state.tr.delete(range.from, range.to));
    if (m === 'slash') it[1](); else { view.dispatch(view.state.tr.replaceSelectionWith(T.notelink.create({ kind: it.kind, target: it.target, label: it.label }), false).insertText(' ')); view.focus(); }
  }
  function detect(v) {
    const sel = v.state.selection; if (!sel.empty || !v.hasFocus()) return hideMenu(); const $f = sel.$from; if (!$f.parent.inlineContent || $f.parent.type === T.code_block) return hideMenu();
    const before = $f.parent.textBetween(0, $f.parentOffset, undefined, '\ufffc'); let m;
    if ($f.parent.type === T.paragraph && (m = /^\/([\w ]{0,14})$/.exec(before))) { mode = 'slash'; const q = m[1].toLowerCase().trim(); range = { from: $f.pos - m[0].length, to: $f.pos }; list = SLASH.filter((x) => !q || x[0].toLowerCase().includes(q) || x[2].includes(q)); }
    else if ((m = /\[\[([^\]\n]{0,40})$/.exec(before))) { mode = 'link'; range = { from: $f.pos - m[0].length, to: $f.pos, blockPos: $f.before() }; list = linkCandidates(m[1]); }
    else return hideMenu(); idx = Math.min(idx, Math.max(0, list.length - 1)); drawMenu();
  }
  const menuPlugin = new Plugin({ key: new PluginKey('nbmenu'), props: { handleKeyDown(v, e) { if (!mode) return false; if (e.key === 'ArrowDown') { idx = (idx + 1) % Math.max(1, list.length); drawMenu(); return true; } if (e.key === 'ArrowUp') { idx = (idx - 1 + list.length) % Math.max(1, list.length); drawMenu(); return true; } if ((e.key === 'Enter' || e.key === 'Tab') && list.length) { choose(idx); return true; } if (e.key === 'Escape') { hideMenu(); return true; } return false; },
    handlePaste(v, ev) { const t = ev.clipboardData?.getData('text/plain') || ''; const m = /^\[\[(note|paper|source):([^|\]]+)\|([^\]]*)\]\]$/.exec(t.trim()); if (m) { v.dispatch(v.state.tr.replaceSelectionWith(T.notelink.create({ kind: m[1], target: m[2], label: m[3] }), false)); return true; } return false; } },
    view: () => ({ update: (v, prev) => { if (prev.doc !== v.state.doc || !prev.selection.eq(v.state.selection)) detect(v); }, destroy: hideMenu }) });
  const flash = { pos: null };
  const decoPlugin = new Plugin({ props: { decorations(st) {
    const d = []; if (flash.pos != null) { const n = st.doc.nodeAt(flash.pos); if (n) d.push(Decoration.node(flash.pos, flash.pos + n.nodeSize, { class: 'flash' })); } const fs = findKey.getState(st); if (fs?.matches.length) fs.matches.forEach((m, i) => d.push(Decoration.inline(m.from, m.to, { class: 'find-hit' + (i === fs.idx ? ' current' : '') })));
    if (st.doc.childCount === 1 && !st.doc.firstChild.content.size && st.doc.firstChild.type === T.paragraph) d.push(Decoration.node(0, st.doc.firstChild.nodeSize, { class: 'is-empty', 'data-ph': 'Write anything. Type / for blocks, [[ to link to a section, a source or another note.' }));
    return DecorationSet.create(st.doc, d); } } });
  const tab = chainCommands(sinkListItem(T.list_item), sinkListItem(T.task_item)), untab = chainCommands(liftListItem(T.list_item), liftListItem(T.task_item));
  const state = EditorState.create({ schema: noteSchema, doc: PMNode.fromJSON(noteSchema, json || emptyNotebook()), plugins: [menuPlugin, idsPlugin, findPlugin, history(), rules(), keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo, 'Mod-b': toggleMark(M.strong), 'Mod-i': toggleMark(M.em), 'Mod-u': toggleMark(M.underline), 'Mod-e': toggleMark(M.code), 'Mod-Shift-h': toggleMark(M.highlight), 'Mod-Shift-x': toggleMark(M.strike), 'Mod-Alt-1': () => cmd.heading(1), 'Mod-Alt-2': () => cmd.heading(2), 'Mod-Alt-3': () => cmd.heading(3), Tab: tab, 'Shift-Tab': untab, Enter: chainCommands(splitListItem(T.list_item), splitListItem(T.task_item)) }), keymap(baseKeymap), dropCursor({ color: 'var(--accent)', width: 2 }), gapCursor(), decoPlugin] });
  view = new EditorView(mount, { state, nodeViews: { notelink: (n, v, g) => new NoteLinkView(n, v, g), task_item: paperViews.task_item }, attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Notes', spellcheck: 'true' },
    dispatchTransaction(tr) { view.updateState(view.state.apply(tr)); if (tr.docChanged) onChange?.(view.state.doc.toJSON()); onSel?.(); } });
  let onSel = null;
  const NB = {
    view, cmd, set onSelection(f) { onSel = f; }, getJSON: () => view.state.doc.toJSON(), focus: () => view.focus(), destroy() { hideMenu(); view.destroy(); },
    headings() { const out = []; view.state.doc.descendants((n, pos) => { if (n.type === T.heading) out.push({ id: n.attrs.id, level: n.attrs.level, text: n.textContent, pos }); return n.type !== T.paragraph; }); return out; },
    posOf(id) { let r = null; view.state.doc.descendants((n, pos) => { if (r == null && n.attrs?.id === id) r = pos; return r == null; }); return r; },
    scrollToId(id) { const p = NB.posOf(id); if (p == null) return false; NB.scrollTo(p); return true; },
    scrollTo(pos) {
      try { view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size))))); } catch { /* */ }
      const dom = view.nodeDOM(pos); const el = dom instanceof HTMLElement ? dom : view.domAtPos(pos + 1).node.parentElement; el?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      flash.pos = pos; view.dispatch(view.state.tr.setMeta('flash', 1)); clearTimeout(flash.t); flash.t = setTimeout(() => { flash.pos = null; try { view.dispatch(view.state.tr.setMeta('flash', 0)); } catch { /* */ } }, 1600);
    },
    append(blocks) { const end = view.state.doc.content.size; const last = view.state.doc.lastChild; const tr = view.state.tr; if (last && last.type === T.paragraph && !last.content.size) tr.replaceWith(end - last.nodeSize, end, blocks); else tr.insert(end, blocks); view.dispatch(tr.scrollIntoView()); },
    appendQuote(text, link) { const kids = [noteSchema.text(text.slice(0, 600))]; const para = T.paragraph.create({ id: uid('nb') }, kids); const src = T.paragraph.create({ id: uid('nb') }, [T.notelink.create(link), noteSchema.text(' ')]); NB.append([T.blockquote.create({ id: uid('nb') }, para), src, T.paragraph.create({ id: uid('nb') })]); },
    appendSource(sourceId, abstract = '') {
      const s = S.sources.get(sourceId); if (!s) return false;
      const lead = T.paragraph.create({ id: uid('nb') }, [
        T.notelink.create({ kind: 'source', target: s.id, label: shortCite(s) }),
        noteSchema.text(' — '),
        noteSchema.text((s.title || 'Untitled source').slice(0, 500), [M.strong.create()]),
      ]);
      const blocks = [lead];
      const abs = String(abstract || s.abstract || '').replace(/\s+/g, ' ').trim();
      if (abs) {
        const p = T.paragraph.create({ id: uid('nb') }, noteSchema.text(abs.slice(0, 1400)));
        blocks.push(T.blockquote.create({ id: uid('nb') }, p));
      }
      blocks.push(T.paragraph.create({ id: uid('nb') }));
      NB.append(blocks); return true;
    },
    copyLinkToBlock() { const $f = view.state.selection.$from; let d = $f.depth; while (d > 0 && !$f.node(d).attrs?.id) d--; const n = d > 0 ? $f.node(d) : null; if (!n) return null; const label = (n.textContent || 'Block').trim().slice(0, 60); const s = `[[note:${n.attrs.id}|${label}]]`; navigator.clipboard?.writeText(s).catch(() => {}); return s; },
    words() { return (view.state.doc.textBetween(0, view.state.doc.content.size, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length; },
    find: { set(q, i) { view.dispatch(view.state.tr.setMeta(findKey, { q, idx: i })); }, get: () => findKey.getState(view.state), step(d) { const s = findKey.getState(view.state); if (!s.matches.length) return; const i = (s.idx + d + s.matches.length) % s.matches.length; view.dispatch(view.state.tr.setMeta(findKey, { q: {}, idx: i })); const m = findKey.getState(view.state).matches[i]; view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView()); } },
  };
  view.dom.addEventListener('click', (e) => { const a = e.target.closest?.('a[href]'); if (a && (e.metaKey || e.ctrlKey)) window.open(a.href, '_blank', 'noopener'); });
  return NB;
}
