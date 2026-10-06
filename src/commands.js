// Editor commands: formatting, structure, insertion. All operate on an EditorView and return booleans.
import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { TextSelection, NodeSelection, Selection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { addRowAfter, addRowBefore, addColumnAfter, addColumnBefore, deleteRow, deleteColumn, deleteTable, toggleHeaderRow, toggleHeaderColumn, setCellAttr, isInTable } from 'prosemirror-tables';
import { schema } from './schema.js';
import { uid, now } from './model.js';

const T = schema.nodes, M = schema.marks;
export const bodyStart = (doc) => { let p = 0; for (let i = 0; i < 4; i++) p += doc.child(i).nodeSize; return p; };
export const inFront = (state, pos = state.selection.from) => pos < bodyStart(state.doc);

export function insertPosAfterBlock(state) {
  const sel = state.selection; let pos;
  if (sel instanceof NodeSelection && sel.$from.depth === 0) pos = sel.to;
  else if (sel.$from.depth >= 1) pos = sel.$from.after(1); else pos = sel.to;
  return Math.max(pos, bodyStart(state.doc));
}
function emptyTopParagraph(state) {
  const { $from } = state.selection;
  if ($from.depth === 1 && $from.parent.type === T.paragraph && $from.parent.content.size === 0 && $from.before(1) >= bodyStart(state.doc)) return { from: $from.before(1), to: $from.after(1) };
  return null;
}
export function insertBlock(view, node, { select = 'after' } = {}) {
  const { state } = view; const e = emptyTopParagraph(state); let tr = state.tr, pos;
  if (e) { tr = tr.replaceWith(e.from, e.to, node); pos = e.from; } else { pos = insertPosAfterBlock(state); tr = tr.insert(pos, node); }
  const end = pos + node.nodeSize;
  if (select === 'inside') { const r = tr.doc.resolve(pos + 1); tr.setSelection(Selection.near(r, 1)); }
  else if (select === 'node') tr.setSelection(NodeSelection.create(tr.doc, pos));
  else { if (end >= tr.doc.content.size || tr.doc.nodeAt(end)?.isTextblock === false) tr.insert(end, T.paragraph.create()); tr.setSelection(Selection.near(tr.doc.resolve(end), 1)); }
  view.dispatch(tr.scrollIntoView()); view.focus(); return pos;
}

const markActive = (state, type) => { const { from, $from, to, empty } = state.selection; return empty ? !!type.isInSet(state.storedMarks || $from.marks()) : state.doc.rangeHasMark(from, to, type); };
export const isMarkActive = markActive;

export function setLink(view, href) {
  const { state } = view, { from, to, empty } = state.selection; if (empty) return false;
  const tr = state.tr.removeMark(from, to, M.link); if (href) tr.addMark(from, to, M.link.create({ href })); view.dispatch(tr); view.focus(); return true;
}
export function linkAt(state) { const { $from, empty, from, to } = state.selection; const m = (empty ? $from.marks() : (state.doc.nodeAt(from)?.marks || [])).find((x) => x.type === M.link); return m || (!empty && state.doc.rangeHasMark(from, to, M.link) ? state.doc.nodeAt(from)?.marks.find((x) => x.type === M.link) : null); }

// Insert an inline node at the selection; if a whole block is selected, put it in a new paragraph after the block instead of replacing it.
function insertInlineNode(view, node, { replace = false } = {}) {
  const { state } = view, sel = state.selection;
  if (sel instanceof NodeSelection && !sel.node.isInline) return insertBlock(view, T.paragraph.create({ id: uid('par') }, node), { select: 'after' });
  const pos = replace || sel.empty ? sel.from : sel.to; const tr = replace ? state.tr.replaceSelectionWith(node, false) : state.tr.insert(pos, node);
  view.dispatch(tr.scrollIntoView()); view.focus(); return pos;
}
export function makeCommands(getView, hooks = {}) {
  const V = () => getView();
  const run = (cmd) => { const v = V(); const r = cmd(v.state, v.dispatch, v); v.focus(); return r; };
  const c = {};
  for (const [k, m] of Object.entries({ bold: M.strong, italic: M.em, underline: M.underline, strike: M.strike, sup: M.sup, sub: M.sub, code: M.code })) c[k] = () => run(toggleMark(m));
  c.paragraph = () => run(setBlockType(T.paragraph));
  c.heading = (level) => { const v = V(); const { $from } = v.state.selection; const same = $from.parent.type === T.heading && $from.parent.attrs.level === level; return run(same ? setBlockType(T.paragraph) : setBlockType(T.heading, { level })); };
  c.planningHeading = () => { const v = V(); const { $from } = v.state.selection; const lvl = $from.parent.type === T.heading ? $from.parent.attrs.level : 2; return run(setBlockType(T.heading, { level: lvl, planning: true })); };
  c.blockquote = () => run(wrapIn(T.blockquote));
  c.callout = () => run(wrapIn(T.callout));
  c.bullet = () => run(wrapInList(T.bullet_list)); c.ordered = () => run(wrapInList(T.ordered_list)); c.tasks = () => run((s, d) => wrapInList(T.task_list)(s, d));
  c.codeBlock = () => run(setBlockType(T.code_block));
  c.indent = () => run(sinkListItem(T.list_item)) || run(sinkListItem(T.task_item));
  c.outdent = () => run(liftListItem(T.list_item)) || run(liftListItem(T.task_item)) || run(lift);
  c.align = (a) => { const v = V(); const { from, to } = v.state.selection; const tr = v.state.tr; v.state.doc.nodesBetween(from, to, (n, p) => { if (n.type === T.paragraph) tr.setNodeMarkup(p, null, { ...n.attrs, align: a === 'left' ? null : a }); }); v.dispatch(tr); v.focus(); return true; };
  c.undo = () => { const v = V(); import('prosemirror-history').then(({ undo }) => { undo(v.state, v.dispatch); v.focus(); }); };
  c.redo = () => { const v = V(); import('prosemirror-history').then(({ redo }) => { redo(v.state, v.dispatch); v.focus(); }); };
  c.hr = () => insertBlock(V(), T.horizontal_rule.create());
  c.pageBreak = () => insertBlock(V(), T.page_break.create());
  c.table = (rows = 3, cols = 3) => {
    const cell = (hd) => (hd ? T.table_header : T.table_cell).create(null, T.paragraph.create());
    const trs = []; for (let r = 0; r < rows; r++) trs.push(T.table_row.create(null, Array.from({ length: cols }, () => cell(r === 0))));
    const node = T.table_block.create({ id: uid('tbl') }, [T.table_caption.create(), T.table.create(null, trs), T.table_note.create()]);
    const pos = insertBlock(V(), node, { select: 'inside' }); return pos;
  };
  c.figure = ({ assetId, src, alt = '', numbered = true } = {}) => insertBlock(V(), T.figure.create({ id: uid('fig'), assetId, src, alt, numbered }, T.figcaption.create()), { select: 'inside' });
  c.mathBlock = (latex = '') => { const pos = insertBlock(V(), T.math_block.create({ id: uid('eq'), latex, numbered: true }), { select: 'node' }); hooks.editMath?.(pos); return pos; };
  c.mathInline = (latex = '') => { const v = V(); const { from, to } = v.state.selection; const sel = v.state.selection instanceof NodeSelection ? '' : v.state.doc.textBetween(from, to); const at = insertInlineNode(v, T.math_inline.create({ latex: latex || sel }), { replace: !(v.state.selection instanceof NodeSelection) }); const pos = v.state.doc.nodeAt(at)?.type === T.math_inline ? at : (at ?? 0); hooks.editMath?.(typeof at === 'number' && v.state.doc.nodeAt(at)?.type === T.math_inline ? at : pos); };
  c.footnote = () => {
    const v = V(); if (inFront(v.state)) return false;
    const node = T.footnote.create({ id: uid('fn'), content: [] }); const at = insertInlineNode(v, node, { replace: true }); let pos = at; if (v.state.doc.nodeAt(pos)?.type !== T.footnote) { v.state.doc.descendants((n, p) => { if (n === undefined) return; if (n.type === T.footnote && n.attrs.id === node.attrs.id) pos = p; }); } hooks.editFootnote?.(pos); return true;
  };
  c.citation = (items, mode = 'parenthetical') => {
    const v = V(); if (inFront(v.state) && !hooks.allowFront) return false;
    const node = T.citation.create({ id: uid('cit'), items, mode }); const { state } = v;
    let pos = insertInlineNode(v, node); if (v.state.doc.nodeAt(pos)?.type !== T.citation) { v.state.doc.descendants((n, p) => { if (n.type === T.citation && n.attrs.id === node.attrs.id) pos = p; }); } hooks.citationInserted?.(pos, node); return pos;
  };
  c.crossref = (target, kind, form = 'full') => { const v = V(); insertInlineNode(v, T.crossref.create({ target, kind, form }), { replace: true }); };
  c.text = (t) => { const v = V(); v.dispatch(v.state.tr.insertText(t)); v.focus(); };
  c.removeFormatting = () => { const v = V(); const { from, to } = v.state.selection; const tr = v.state.tr; for (const m of [M.strong, M.em, M.underline, M.strike, M.sup, M.sub, M.code]) tr.removeMark(from, to, m); v.dispatch(tr); v.focus(); };
  // table operations
  c.tableOp = (name) => { const ops = { addRowAfter, addRowBefore, addColumnAfter, addColumnBefore, deleteRow, deleteColumn, toggleHeaderRow, toggleHeaderColumn, deleteTable: (s, d) => { const { $from } = s.selection; for (let i = $from.depth; i > 0; i--) if ($from.node(i).type === T.table_block) { d?.(s.tr.delete($from.before(i), $from.after(i))); return true; } return deleteTable(s, d); } }; return run(ops[name]); };
  c.cellAlign = (a) => run(setCellAttr('align', a === 'left' ? null : a));
  c.inTable = () => isInTable(V().state);
  c.clearBlock = () => run(setBlockType(T.paragraph));
  return c;
}

export function addMarkTo(view, type, attrs, from, to) { view.dispatch(view.state.tr.addMark(from ?? view.state.selection.from, to ?? view.state.selection.to, type.create(attrs))); }
export function findNodeById(doc, id) { let found = null; doc.descendants((n, p) => { if (found) return false; if (n.attrs && n.attrs.id === id) { found = { node: n, pos: p }; return false; } return true; }); return found; }
export function marksInRange(doc, from, to, type) { const out = []; doc.nodesBetween(from, to, (n, p) => { if (n.isText) n.marks.forEach((m) => { if (m.type === type) out.push({ mark: m, from: p, to: p + n.nodeSize }); }); }); return out; }
export function findMarkRanges(doc, type, pred) { const out = []; doc.descendants((n, p) => { if (n.isText) n.marks.forEach((m) => { if (m.type === type && (!pred || pred(m))) { const l = out[out.length - 1]; if (l && l.to === p && l.mark.eq(m)) l.to = p + n.nodeSize; else out.push({ mark: m, from: p, to: p + n.nodeSize }); } }); }); return out; }
export { now };
