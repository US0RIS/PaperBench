import { EditorState, Plugin, PluginKey, TextSelection, NodeSelection, Selection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, chainCommands } from 'prosemirror-commands';
import { inputRules, wrappingInputRule, textblockTypeInputRule, InputRule, smartQuotes, ellipsis } from 'prosemirror-inputrules';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { tableEditing, columnResizing, goToNextCell } from 'prosemirror-tables';
import { Fragment, Node as PMNode } from 'prosemirror-model';
import { ReplaceStep } from 'prosemirror-transform';
import { schema } from './schema.js';
import { analyze } from './analyze.js';
import { nodeViews } from './nodeviews.js';
import { makeCommands, bodyStart, findNodeById, findMarkRanges } from './commands.js';
import { S } from './state.js';
import { uid, now, wordCount } from './model.js';
import { bus } from './ui.js';

const T = schema.nodes, M = schema.marks;
export const analysisKey = new PluginKey('analysis');
export const findKey = new PluginKey('find');
const decoKey = new PluginKey('decos');

// ---- block ids ---------------------------------------------------------------
const ID_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'callout', 'bullet_list', 'ordered_list', 'task_list', 'code_block', 'figure', 'table_block', 'math_block', 'footnote', 'citation']);
const idsPlugin = new Plugin({
  appendTransaction(trs, _o, state) {
    if (!trs.some((t) => t.docChanged) && _o.doc !== state.doc && !trs.some((t) => t.getMeta('ids'))) return null;
    const seen = new Set(); let tr = null;
    state.doc.descendants((n, pos) => {
      if (!ID_TYPES.has(n.type.name)) return;
      const id = n.attrs.id;
      if (!id || seen.has(id)) { tr = tr || state.tr; tr.setNodeMarkup(pos, null, { ...n.attrs, id: uid(n.type.name.slice(0, 3)) }); } else seen.add(id);
    });
    return tr ? tr.setMeta('addToHistory', false).setMeta('noSuggest', true) : null;
  },
});

// ---- analysis ----------------------------------------------------------------
const analysisPlugin = (flags) => new Plugin({
  key: analysisKey,
  state: {
    init: (_c, st) => ({ A: analyze(st.doc, flags()), flags: JSON.stringify(flags()) }),
    apply(tr, val, _o, st) {
      const f = JSON.stringify(flags());
      if (!tr.docChanged && !tr.getMeta('reanalyze') && f === val.flags) return val;
      return { A: analyze(st.doc, flags()), flags: f };
    },
  },
});

// ---- decorations -------------------------------------------------------------
export function claimStatus(claimId, hasCite) {
  const rec = S.P.claims.get(claimId);
  if (rec?.flag === 'verify') return 'needs-verification';
  if (hasCite) return 'citation-inserted';
  for (const e of S.P.evidences.values()) if (e.anchorId === claimId) return 'evidence-attached';
  return 'unsupported';
}
const hasCiteNode = (n) => { let f = false; n.descendants((c) => { if (c.type === T.citation) f = true; else if (c.type === T.footnote && JSON.stringify(c.attrs.content).includes('"citation"')) f = true; return !f; }); return f; };
const startsWithCite = (n) => { if (!n || !n.isTextblock) return false; let i = 0, f = false; n.forEach((c) => { if (i++ < 3 && c.type === T.citation) f = true; }); return f; };
export const activeComment = { id: null };
export const flashRef = { from: null, to: null };

const decoPlugin = (flags) => new Plugin({
  key: decoKey,
  props: {
    decorations(state) {
      const { A } = analysisKey.getState(state); const decos = []; const doc = state.doc; const f = flags();
      A.headings.forEach((h) => { const attrs = {}; if (h.planning) attrs.class = 'planning'; if (f.numberHeadings && h.num) attrs['data-num'] = h.num; if (Object.keys(attrs).length) decos.push(Decoration.node(h.pos, h.end, attrs)); });
      A.figures.forEach((fg) => { const n = doc.nodeAt(fg.pos); const cap = n.firstChild; decos.push(Decoration.node(fg.pos + 1, fg.pos + 1 + cap.nodeSize, { 'data-label': fg.n ? `Figure ${fg.n}.` : '' })); });
      A.tables.forEach((tb) => { const n = doc.nodeAt(tb.pos); decos.push(Decoration.node(tb.pos + 1, tb.pos + 1 + n.firstChild.nodeSize, { 'data-label': `Table ${tb.n}.` })); });
      // placeholders
      const ph = ['Title', 'Subtitle (optional)', 'Author'];
      let p = 0; for (let i = 0; i < 3; i++) { const c = doc.child(i); if (!c.content.size) decoPush(decos, p, c, ph[i]); p += c.nodeSize; }
      const ab = doc.child(3); if (ab.childCount === 1 && !ab.firstChild.content.size) decoPush(decos, p + 1, ab.firstChild, 'Abstract');
      const { $from } = state.selection;
      if (state.selection.empty && $from.parent.type === T.paragraph && !$from.parent.content.size && $from.depth >= 1 && $from.before() >= bodyStart(doc)) decos.push(Decoration.node($from.before(), $from.after(), { class: 'is-empty', 'data-ph': $from.depth === 1 ? 'Write, or type / for commands and @ to cite' : '' }));
      // evidence mode claims + quote warnings
      doc.descendants((node, pos) => {
        if (node.isTextblock) {
          const cited = hasCiteNode(node);
          node.forEach((child, off) => {
            if (!child.isText) return; const from = pos + 1 + off, to = from + child.nodeSize;
            child.marks.forEach((m) => {
              if (m.type === M.claim && f.evidenceMode) decos.push(Decoration.inline(from, to, { class: 'claim claim-' + claimStatus(m.attrs.claimId, cited), 'data-claim-status': claimStatus(m.attrs.claimId, cited).replace('-', ' ') }, { inclusiveEnd: false }));
              if (m.type === M.quote && !cited) decos.push(Decoration.inline(from, to, { class: 'warn-quote', title: 'Quotation without a citation' }));
              if (m.type === M.comment && m.attrs.commentId === activeComment.id) decos.push(Decoration.inline(from, to, { class: 'comment-active' }));
            });
          });
          return false;
        }
        if (node.type === T.blockquote) {
          const next = doc.resolve(pos + node.nodeSize).nodeAfter; if (!hasCiteNode(node) && !startsWithCite(next)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'warn-quote' }));
        }
        return true;
      });
      if (flashRef.from != null && flashRef.to <= doc.content.size) decos.push(Decoration.node(flashRef.from, flashRef.to, { class: 'flash' }));
      const fs = findKey.getState(state);
      if (fs?.matches.length) fs.matches.forEach((m, i) => decos.push(Decoration.inline(m.from, m.to, { class: 'find-hit' + (i === fs.idx ? ' current' : '') })));
      return DecorationSet.create(doc, decos);
    },
  },
});
function decoPush(decos, pos, node, text) { decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'is-empty', 'data-ph': text })); }

// ---- find / replace ----------------------------------------------------------
export function computeMatches(doc, q) {
  const out = []; if (!q.text) return out;
  const needle = q.cs ? q.text : q.text.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let str = ''; node.forEach((c) => { str += c.isText ? c.text : '\ufffc'; });
    const hay = q.cs ? str : str.toLowerCase(); let i = 0;
    while ((i = hay.indexOf(needle, i)) >= 0) {
      const a = i, b = i + needle.length;
      const ok = !q.ww || (!/[\p{L}\p{N}_]/u.test(hay[a - 1] || ' ') && !/[\p{L}\p{N}_]/u.test(hay[b] || ' '));
      if (ok) out.push({ from: pos + 1 + a, to: pos + 1 + b }); i = b || i + 1;
    }
    return false;
  });
  return out;
}
export const findPlugin = new Plugin({
  key: findKey,
  state: {
    init: () => ({ q: { text: '', cs: false, ww: false }, matches: [], idx: 0 }),
    apply(tr, v) {
      const m = tr.getMeta(findKey);
      if (m) { const q = { ...v.q, ...m.q }; const matches = computeMatches(tr.doc, q); const idx = m.idx != null ? m.idx : Math.min(v.idx, Math.max(0, matches.length - 1)); return { q, matches, idx }; }
      if (tr.docChanged && v.q.text) { const matches = computeMatches(tr.doc, v.q); return { ...v, matches, idx: Math.min(v.idx, Math.max(0, matches.length - 1)) }; }
      return v;
    },
  },
});

// ---- suggestion mode (tracked changes) ---------------------------------------
export function suggestTransform(state, tr, author) {
  if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return null;
  const step = tr.steps[0], { slice } = step; let df = step.from, dt = step.to, ins = slice;
  const $f = state.doc.resolve(df), $t = state.doc.resolve(dt);
  if (!$f.parent.inlineContent || !$t.parent.inlineContent) return null;
  const closedInline = !slice.openStart && !slice.openEnd && (() => { let ok = true; slice.content.forEach((n) => { if (!n.isInline) ok = false; }); return ok; })();
  if ($f.parent !== $t.parent) {
    // Deleting across paragraphs: ProseMirror emits a joining step. Track the user's selected text and keep the paragraph structure.
    const sel = state.selection; if (sel.empty || sel.from < df || sel.to > dt) return null;
    df = sel.from; dt = sel.to; ins = closedInline ? slice : null;
  } else if (!closedInline && slice.size) return null;
  const near = [state.doc.resolve(df).nodeBefore, state.doc.resolve(dt).nodeAfter].filter(Boolean);
  const adj = near.flatMap((n) => n.marks).find((m) => (m.type === M.ins || m.type === M.del) && m.attrs.author === author && now() - m.attrs.time < 90000);
  const sid = adj ? adj.attrs.sid : uid('s'), time = adj ? adj.attrs.time : now();
  const insM = M.ins.create({ sid, author, time }), delM = M.del.create({ sid, author, time });
  const nt = state.tr, own = [];
  if (dt > df) state.doc.nodesBetween(df, dt, (n, p) => {
    if (!n.isInline) return;
    const a = Math.max(p, df), b = Math.min(p + n.nodeSize, dt);
    if (n.marks.some((m) => m.type === M.ins && m.attrs.author === author)) own.push([a, b]);
    else if (!n.marks.some((m) => m.type === M.del)) nt.addMark(a, b, delM);
  });
  const insSize = ins ? ins.size : 0;
  if (insSize) { const nodes = []; ins.content.forEach((n) => nodes.push(n.mark(insM.addToSet(n.marks)))); nt.insert(dt, Fragment.from(nodes)); }
  own.reverse().forEach(([a, b]) => nt.delete(a, b));
  const cursor = insSize ? nt.mapping.map(dt, 1) : nt.mapping.map(df, -1);
  nt.setSelection(TextSelection.create(nt.doc, Math.min(cursor, nt.doc.content.size)));
  nt.setMeta('addToHistory', tr.getMeta('addToHistory')); nt.scrollIntoView();
  return nt;
}
export function resolveSuggestions(view, pred, accept) {
  const ranges = [];
  view.state.doc.descendants((n, p) => { if (n.isInline) n.marks.forEach((m) => { if ((m.type === M.ins || m.type === M.del) && pred(m)) ranges.push({ from: p, to: p + n.nodeSize, m }); }); });
  const tr = view.state.tr; ranges.sort((a, b) => b.from - a.from);
  for (const r of ranges) { const remove = (accept && r.m.type === M.del) || (!accept && r.m.type === M.ins); if (remove) tr.delete(r.from, r.to); else tr.removeMark(r.from, r.to, r.m); }
  tr.setMeta('noSuggest', true); view.dispatch(tr);
  return ranges.length;
}
export function listSuggestions(doc) {
  const map = new Map();
  doc.descendants((n, p) => { if (n.isInline) n.marks.forEach((m) => { if (m.type === M.ins || m.type === M.del) { const k = m.attrs.sid; const e = map.get(k) || { sid: k, author: m.attrs.author, time: m.attrs.time, ins: '', del: '', pos: p }; const t = n.isText ? n.text : ' [' + n.type.name + '] '; if (m.type === M.ins) e.ins += t; else e.del += t; map.set(k, e); } }); });
  return [...map.values()].sort((a, b) => a.pos - b.pos);
}

// ---- input rules -------------------------------------------------------------
function markRule(re, type, delim) {
  return new InputRule(re, (state, match, start, end) => {
    const $ = state.doc.resolve(start); if (!$.parent.type.allowsMarkType(type)) return null;
    const lead = match[1].length, inner = match[2], s = start + lead; const tr = state.tr;
    tr.delete(end - (delim - 1), end); tr.delete(s, s + delim); tr.addMark(s, s + inner.length, type.create()); tr.removeStoredMark(type); return tr;
  });
}
function rules(hooks) {
  const r = [
    textblockTypeInputRule(/^(#{1,6})\s$/, T.heading, (m) => ({ level: m[1].length })),
    wrappingInputRule(/^\s*>\s$/, T.blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, T.bullet_list),
    wrappingInputRule(/^(\d+)\.\s$/, T.ordered_list, (m) => ({ order: +m[1] }), (m, n) => n.childCount + n.attrs.order === +m[1]),
    wrappingInputRule(/^\s*\[( |x)?\]\s$/, T.task_list),
    textblockTypeInputRule(/^```$/, T.code_block),
    new InputRule(/^---$/, (state, m, start, end) => { const $ = state.doc.resolve(start); if ($.depth !== 1 || $.before() < bodyStart(state.doc)) return null; return state.tr.replaceWith($.before(), $.after(), [T.horizontal_rule.create(), T.paragraph.create()]).setSelection(TextSelection.create(state.tr.doc, $.before() + 2)).scrollIntoView(); }),
    markRule(/(^|\s)\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, M.strong, 2), markRule(/(^|\s)__([^_\s](?:[^_]*[^_\s])?)__$/, M.strong, 2),
    markRule(/(^|\s)\*([^*\s](?:[^*]*[^*\s])?)\*$/, M.em, 1), markRule(/(^|\s)_([^_\s](?:[^_]*[^_\s])?)_$/, M.em, 1),
    markRule(/(^|\s)~~([^~\s](?:[^~]*[^~\s])?)~~$/, M.strike, 2), markRule(/(^|\s)`([^`\s](?:[^`]*[^`\s])?)`$/, M.code, 1),
    new InputRule(/(^|[^$\\\w])\$([^$\s](?:[^$]*[^$\s])?)\$$/, (state, m, start, end) => { const $ = state.doc.resolve(start); if (!$.parent.inlineContent || $.parent.type.spec.marks === '') return null; const s = start + m[1].length; return state.tr.replaceWith(s, end, T.math_inline.create({ latex: m[2] })); }),
    new InputRule(/^\$\$\s$/, (state, m, start) => { const $ = state.doc.resolve(start); if ($.depth !== 1 || $.before() < bodyStart(state.doc) || $.parent.type !== T.paragraph) return null; const pos = $.before(); setTimeout(() => hooks.editMath?.(pos), 0); return state.tr.replaceWith($.before(), $.after(), T.math_block.create({ id: uid('eq'), latex: '', numbered: true })); }),
    ...smartQuotes, ellipsis,
    new InputRule(/->$/, (s, m, a, b) => s.tr.insertText('→', a, b)), new InputRule(/<-$/, (s, m, a, b) => s.tr.insertText('←', a, b)), new InputRule(/\(c\)$/i, (s, m, a, b) => s.tr.insertText('©', a, b)), new InputRule(/\+-$/, (s, m, a, b) => s.tr.insertText('±', a, b)), new InputRule(/!=$/, (s, m, a, b) => s.tr.insertText('≠', a, b)),
  ];
  return inputRules({ rules: r });
}

// ---- keymap ------------------------------------------------------------------
function frontEnter(state, dispatch) {
  const { $from } = state.selection; if ($from.depth < 1 || $from.before(1) >= bodyStart(state.doc) - state.doc.child(3).nodeSize + 0 && $from.parent.type.name !== 'title' && $from.parent.type.name !== 'subtitle' && $from.parent.type.name !== 'author') return false;
  const n = $from.node(1).type.name; if (!['title', 'subtitle', 'author'].includes(n)) return false;
  if (dispatch) dispatch(state.tr.setSelection(Selection.near(state.doc.resolve($from.after(1) + 1), 1)).scrollIntoView());
  return true;
}
function buildKeymap(cmd, hooks) {
  const tabNext = chainCommands(goToNextCell(1), sinkListItem(T.list_item), sinkListItem(T.task_item));
  const tabPrev = chainCommands(goToNextCell(-1), liftListItem(T.list_item), liftListItem(T.task_item));
  return keymap({
    'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo,
    'Mod-b': toggleMark(M.strong), 'Mod-i': toggleMark(M.em), 'Mod-u': toggleMark(M.underline), 'Mod-Shift-x': toggleMark(M.strike), 'Mod-.': toggleMark(M.sup), 'Mod-,': toggleMark(M.sub), 'Mod-e': toggleMark(M.code),
    'Mod-Alt-1': () => cmd.heading(1), 'Mod-Alt-2': () => cmd.heading(2), 'Mod-Alt-3': () => cmd.heading(3), 'Mod-Alt-0': () => cmd.paragraph(),
    'Mod-Shift-8': () => cmd.bullet(), 'Mod-Shift-7': () => cmd.ordered(), 'Mod-Shift-9': () => cmd.blockquote(),
    'Mod-Alt-f': () => cmd.footnote(), 'Mod-Alt-e': () => { cmd.mathInline(); return true; },
    Tab: tabNext, 'Shift-Tab': tabPrev, Enter: chainCommands(frontEnter, splitListItem(T.list_item), splitListItem(T.task_item)),
  });
}

// ---- DOM clipboard/paste/drop -------------------------------------------------
const norm = (s) => s.replace(/\s+/g, ' ').trim();
function pasteDrop(hooks) {
  return {
    handlePaste(view, event) {
      const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { hooks.imageFiles?.(files); return true; }
      const text = event.clipboardData?.getData('text/plain') || '';
      const cap = S.lastCapture;
      if (cap && text && norm(text) === norm(cap.text) && now() - cap.t < 15 * 60 * 1000) { hooks.pasteCapture?.(view, cap, text); return true; }
      return false;
    },
    handleDrop(view, event) {
      const nid = event.dataTransfer?.getData('application/x-note'); const files = [...(event.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
      const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (nid && at) { event.preventDefault(); hooks.dropNote?.(nid, at.pos); return true; }
      if (files.length) { event.preventDefault(); hooks.imageFiles?.(files, at?.pos); return true; }
      return false;
    },
  };
}

// ---- factory -----------------------------------------------------------------
export function createEditor(mount, { doc, flags, hooks = {}, onDoc, onSelection, spell = 'en-US' }) {
  let view; const getView = () => view;
  const cmd = makeCommands(getView, hooks);
  const plugins = (extra = []) => [
    idsPlugin, analysisPlugin(flags), decoPlugin(flags), findPlugin, history({ newGroupDelay: 600 }), rules(hooks), buildKeymap(cmd, hooks), keymap(baseKeymap),
    dropCursor({ color: 'var(--accent)', width: 2 }), gapCursor(), columnResizing({ cellMinWidth: 60 }), tableEditing(), ...extra,
  ];
  const E = {
    cmd, hooks, plugins,
    get view() { return view; },
    analysis: () => analysisKey.getState(view.state).A,
    getJSON: () => view.state.doc.toJSON(),
    focus: () => view.focus(),
    setDoc(json) { const d = PMNode.fromJSON(schema, json); view.updateState(EditorState.create({ schema, doc: d, plugins: view.state.plugins })); view.dispatch(view.state.tr.setMeta('ids', true).setMeta('addToHistory', false)); onDoc?.(false); },
    replaceDoc(json) { const d = PMNode.fromJSON(schema, json); const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, d.content).setMeta('noSuggest', true); view.dispatch(tr); },
    reanalyze() { view.dispatch(view.state.tr.setMeta('reanalyze', true).setMeta('addToHistory', false)); },
    suggesting: false, author: 'You',
    posOf(id) { return findNodeById(view.state.doc, id)?.pos ?? null; },
    scrollTo(pos, { flash = true, select = false } = {}) {
      pos = Math.max(0, Math.min(pos, view.state.doc.content.size));
      const tr = view.state.tr; try { tr.setSelection(select ? NodeSelection.create(view.state.doc, pos) : Selection.near(view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size)), 1)); } catch { /* */ }
      view.dispatch(tr.setMeta('scroll', true));
      const dom = view.domAtPos(Math.min(pos + 1, view.state.doc.content.size)).node; const el = dom.nodeType === 1 ? dom : dom.parentElement;
      el?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (flash) {
        const $p = view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size)); const top = $p.depth >= 1 ? $p.node(1) : null;
        if (top) { flashRef.from = $p.before(1); flashRef.to = flashRef.from + top.nodeSize; view.dispatch(view.state.tr.setMeta('flash', 1).setMeta('addToHistory', false)); clearTimeout(flashRef.t); flashRef.t = setTimeout(() => { flashRef.from = flashRef.to = null; try { view.dispatch(view.state.tr.setMeta('flash', 0).setMeta('addToHistory', false)); } catch { /* */ } }, 1600); }
      }
    },
    scrollToId(id) { const p = E.posOf(id); if (p != null) E.scrollTo(p); return p != null; },
    setAttrs(pos, attrs, meta = {}) { const n = view.state.doc.nodeAt(pos); if (!n) return; const tr = view.state.tr.setNodeMarkup(pos, null, { ...n.attrs, ...attrs }); Object.entries(meta).forEach(([k, v]) => tr.setMeta(k, v)); view.dispatch(tr); },
    selectionText() { const { from, to } = view.state.selection; return view.state.doc.textBetween(from, to, ' '); },
    blockAt(pos) { const $p = view.state.doc.resolve(pos); for (let d = $p.depth; d > 0; d--) if ($p.node(d).isTextblock || $p.node(d).attrs?.id) { const n = $p.node(d); if (n.attrs?.id) return { node: n, pos: $p.before(d) }; } return null; },
    sentenceAround(pos) { const b = E.blockAt(pos); if (!b) return null; const txt = b.node.textContent; return { text: txt, block: b }; },
    rewriteSourceRefs(oldId, newId) {
      const tr = view.state.tr; const fix = (items) => items.map((i) => (i.sourceId === oldId ? { ...i, sourceId: newId } : i));
      view.state.doc.descendants((n, p) => {
        if (n.type === T.citation && n.attrs.items.some((i) => i.sourceId === oldId)) tr.setNodeMarkup(p, null, { ...n.attrs, items: fix(n.attrs.items) });
        if (n.type === T.footnote && JSON.stringify(n.attrs.content).includes(oldId)) tr.setNodeMarkup(p, null, { ...n.attrs, content: JSON.parse(JSON.stringify(n.attrs.content).split(oldId).join(newId)) });
      });
      if (tr.docChanged) view.dispatch(tr.setMeta('noSuggest', true));
    },
    moveSection(hIdx, targetPos) {
      const A = E.analysis(); const h = A.headings[hIdx]; if (!h) return; const from = h.pos, to = h.sectionEnd;
      if (targetPos >= from && targetPos <= to) return;
      const slice = view.state.doc.slice(from, to); const tr = view.state.tr;
      const target = targetPos > to ? targetPos - (to - from) : targetPos;
      tr.delete(from, to); tr.insert(target, slice.content); tr.setMeta('noSuggest', true); view.dispatch(tr);
    },
    insertHeadingAfterSection(idx, { level = 2, planning = true, text = '' } = {}) {
      const A = E.analysis(); const h = A.headings[idx]; const pos = h ? h.sectionEnd : view.state.doc.content.size;
      const node = T.heading.create({ level: h ? h.level : level, planning, id: uid('hd') }, text ? schema.text(text) : null);
      view.dispatch(view.state.tr.insert(pos, node).setMeta('noSuggest', true)); return pos;
    },
    find: {
      set(q, idx) { view.dispatch(view.state.tr.setMeta(findKey, { q, idx }).setMeta('addToHistory', false)); },
      get: () => findKey.getState(view.state),
      step(dir) { const s = findKey.getState(view.state); if (!s.matches.length) return; const idx = (s.idx + dir + s.matches.length) % s.matches.length; view.dispatch(view.state.tr.setMeta(findKey, { q: {}, idx }).setMeta('addToHistory', false)); const m = s.matches[idx]; E.scrollTo(m.from, { flash: false }); view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView()); },
      replace(text) { const s = findKey.getState(view.state); const m = s.matches[s.idx]; if (!m) return; view.dispatch(view.state.tr.insertText(text, m.from, m.to)); },
      replaceAll(text) { const s = findKey.getState(view.state); if (!s.matches.length) return 0; const tr = view.state.tr; [...s.matches].reverse().forEach((m) => tr.insertText(text, m.from, m.to)); view.dispatch(tr); return s.matches.length; },
    },
  };
  const state = EditorState.create({ schema, doc: PMNode.fromJSON(schema, doc), plugins: plugins() });
  view = new EditorView(mount, {
    state, nodeViews, ...pasteDrop(hooks),
    attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Paper', spellcheck: 'true', lang: spell.split('-')[0] },
    handleClickOn(v, pos, node, nodePos, event) { hooks.clickNode?.(node, nodePos, event); return false; },
    handleDOMEvents: { contextmenu: (v, e) => { if (!v.state.selection.empty) { e.preventDefault(); hooks.contextMenu?.(e); return true; } return false; } },
    dispatchTransaction(tr) {
      const st = view.state;
      if (E.suggesting && tr.docChanged && !tr.getMeta('noSuggest')) {
        const nt = view.composing ? null : suggestTransform(st, tr, E.author);
        if (nt) tr = nt; else if (tr.steps.some((x) => x instanceof ReplaceStep)) hooks.untracked?.(view.composing ? 'composition' : 'structure');
      }
      const ns = st.apply(tr); view.updateState(ns);
      if (tr.docChanged) onDoc?.(true, tr);
      if (tr.selectionSet || tr.docChanged) onSelection?.(ns);
    },
  });
  E.destroy = () => view.destroy();
  return E;
}
export const T_ = T;
export { wordCount };
