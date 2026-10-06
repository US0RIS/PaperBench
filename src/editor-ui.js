// Floating editor UI: slash menu, @-citation menu, selection toolbar, block handle.
import { Plugin, PluginKey, NodeSelection, TextSelection } from 'prosemirror-state';
import { schema } from './schema.js';
import { S } from './state.js';
import { h, icon, $, clear, menu, kbd } from './ui.js';
import { shortCite, namesDisplay, yearOf, typeLabel, kindOf, KIND_LABEL } from './model.js';
import { bodyStart, isMarkActive, linkAt } from './commands.js';

const T = schema.nodes, M = schema.marks;

export function slashItems(E, api) {
  const c = E.cmd;
  return [
    { id: 'h1', label: 'Heading 1', desc: 'Major section', icon: 'heading', kw: 'heading title section h1', run: () => c.heading(1) },
    { id: 'h2', label: 'Heading 2', desc: 'Subsection', icon: 'heading', kw: 'heading subsection h2', run: () => c.heading(2) },
    { id: 'h3', label: 'Heading 3', desc: 'Sub-subsection', icon: 'heading', kw: 'heading h3', run: () => c.heading(3) },
    { id: 'plan', label: 'Planning heading', desc: 'Outline-only; excluded from export', icon: 'bookmark', kw: 'plan outline planning', run: () => c.planningHeading() },
    { id: 'quote', label: 'Block quote', desc: 'Set off a long quotation', icon: 'quote', kw: 'quote blockquote quotation', run: () => c.blockquote() },
    { id: 'bullets', label: 'Bulleted list', icon: 'list', kw: 'list bullet unordered', run: () => c.bullet() },
    { id: 'numbers', label: 'Numbered list', icon: 'olist', kw: 'list number ordered', run: () => c.ordered() },
    { id: 'tasks', label: 'Checklist', desc: 'Drafting to-dos', icon: 'tasks', kw: 'checklist todo task', run: () => c.tasks() },
    { id: 'eq', label: 'Equation', desc: 'Numbered display equation (LaTeX)', icon: 'sigma', kw: 'equation math latex display formula', run: () => c.mathBlock() },
    { id: 'ieq', label: 'Inline equation', icon: 'sigma', kw: 'inline math latex', run: () => c.mathInline() },
    { id: 'table', label: 'Table', desc: 'With caption and note', icon: 'table', kw: 'table grid', run: () => api.insertTable() },
    { id: 'image', label: 'Image', desc: 'Unnumbered image', icon: 'image', kw: 'image picture photo', run: () => api.insertImage(false) },
    { id: 'figure', label: 'Figure', desc: 'Numbered figure with caption', icon: 'image', kw: 'figure caption', run: () => api.insertImage(true) },
    { id: 'fn', label: 'Footnote', icon: 'footnote', kw: 'footnote endnote note', run: () => c.footnote() },
    { id: 'cite', label: 'Citation', desc: 'Insert from library', icon: 'book', kw: 'citation cite source reference', run: () => api.pickCitation() },
    { id: 'xref', label: 'Cross-reference', desc: 'Link to a figure, table, equation or section', icon: 'link', kw: 'cross reference xref see figure table', run: () => api.pickCrossref() },
    { id: 'callout', label: 'Drafting note', desc: 'Callout; excluded from export', icon: 'note', kw: 'callout note drafting aside', run: () => c.callout() },
    { id: 'code', label: 'Code block', icon: 'code', kw: 'code pre', run: () => c.codeBlock() },
    { id: 'hr', label: 'Divider', icon: 'minus', kw: 'rule divider hr line', run: () => c.hr() },
    { id: 'pb', label: 'Page break', desc: 'For export', icon: 'hr', kw: 'page break', run: () => c.pageBreak() },
    { id: 'sym', label: 'Special character', icon: 'hash', kw: 'symbol special character greek', run: () => api.specialChars() },
  ];
}

export function installEditorUI(E, api) {
  const view = E.view, items = slashItems(E, api);
  let mode = null, range = null, query = '', list = [], idx = 0, host = null;
  const hide = () => { mode = null; if (host) { host.remove(); host = null; } };
  const coords = () => view.coordsAtPos(range.from);
  const mentionList = (q) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return [...S.sources.values()].filter((s) => { const hay = `${s.title} ${namesDisplay(s.author)} ${yearOf(s)} ${(s._tags || []).join(' ')} ${s['container-title'] || ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
      .sort((a, b) => (b._fav - a._fav) || ((S.derived?.used.includes(b.id) ? 1 : 0) - (S.derived?.used.includes(a.id) ? 1 : 0)) || (b._added - a._added)).slice(0, 8);
  };
  function render() {
    if (!mode) return;
    if (!host) { host = h('div.suggest', { role: 'listbox', 'aria-label': mode === 'slash' ? 'Commands' : 'Sources' }); document.body.append(host); }
    clear(host);
    if (!list.length) host.append(h('div.suggest-empty', mode === 'slash' ? 'No matching command' : 'No matching source'), mode === 'mention' && h('button.suggest-it', { onmousedown: (e) => { e.preventDefault(); const q = query; hide(); deleteRange(); api.addSource(q); } }, h('span.suggest-t', 'Add a source…')));
    list.forEach((it, i) => {
      const body = mode === 'slash'
        ? [icon(it.icon, 16), h('span.suggest-b', h('span.suggest-t', it.label), it.desc && h('span.suggest-d', it.desc))]
        : [h('span.suggest-b', h('span.suggest-t', shortCite(it)), h('span.suggest-d', it.title))];
      host.append(h('button.suggest-it' + (i === idx ? '.on' : ''), { role: 'option', 'aria-selected': String(i === idx), onmousedown: (e) => { e.preventDefault(); choose(i, false); }, onmousemove: () => { if (idx !== i) { idx = i; render(); } } }, ...body));
    });
    if (mode === 'mention' && list.length) host.append(h('div.suggest-hint', h('span.kbd', '↵'), ' cite  ', h('span.kbd', 'Tab'), ' cite with page'));
    const c = coords(); const w = host.offsetWidth, hh = host.offsetHeight;
    host.style.left = Math.max(8, Math.min(c.left, innerWidth - w - 8)) + 'px';
    host.style.top = (c.bottom + hh + 12 > innerHeight && c.top > hh + 12 ? c.top - hh - 6 : c.bottom + 6) + 'px';
    host.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  const deleteRange = () => { view.dispatch(view.state.tr.delete(range.from, range.to).setMeta('noSuggest', false)); };
  function choose(i, withPage) {
    const it = list[i]; if (!it) return; const m = mode; hide();
    deleteRange();
    if (m === 'slash') it.run();
    else { const pos = E.cmd.citation([{ sourceId: it.id }]); if (withPage && pos != null) setTimeout(() => api.editCitationAt(pos), 0); }
  }
  function detect(v) {
    const { selection } = v.state; if (!selection.empty || !v.hasFocus()) return hide();
    const $f = selection.$from, par = $f.parent; if (!par.inlineContent || par.type.spec.marks === '') return hide();
    if ($f.before($f.depth) < bodyStart(v.state.doc) && par.type !== T.paragraph) return hide();
    const before = par.textBetween(0, $f.parentOffset, undefined, '\ufffc');
    let m;
    if (par.type === T.paragraph && (m = /^\/([\w\- ]{0,18})$/.exec(before)) && !v.state.doc.resolve($f.before()).parent.type.spec.code) { mode = 'slash'; query = m[1]; range = { from: $f.pos - m[0].length, to: $f.pos }; const q = query.toLowerCase().trim(); list = items.filter((it) => !q || it.label.toLowerCase().includes(q) || it.kw.includes(q)).slice(0, 9); }
    else if ((m = /(?:^|[\s(\[])@([^@\n]{0,38})$/.exec(before)) && m[1].split(' ').length <= 4 && !/\s\s/.test(m[1])) { mode = 'mention'; query = m[1]; const full = m[0]; const at = full.lastIndexOf('@'); range = { from: $f.pos - (full.length - at), to: $f.pos }; list = mentionList(query); }
    else return hide();
    idx = Math.min(idx, Math.max(0, list.length - 1)); render();
  }
  const slashPlugin = new Plugin({
    key: new PluginKey('suggest'),
    props: {
      handleKeyDown(v, e) {
        if (!mode) return false;
        if (e.key === 'ArrowDown') { idx = (idx + 1) % Math.max(1, list.length); render(); return true; }
        if (e.key === 'ArrowUp') { idx = (idx - 1 + list.length) % Math.max(1, list.length); render(); return true; }
        if ((e.key === 'Enter' || e.key === 'Tab') && list.length) { choose(idx, e.key === 'Tab' && mode === 'mention'); return true; }
        if (e.key === 'Escape') { hide(); return true; }
        return false;
      },
    },
    view: () => ({ update: (v, prev) => { if (prev.doc !== v.state.doc || !prev.selection.eq(v.state.selection)) detect(v); }, destroy: hide }),
  });

  // ---- selection toolbar
  let bar = null, down = false;
  const barBtn = (ic, label, run, active) => h('button.tb' + (active ? '.on' : ''), { 'aria-label': label, title: label, 'aria-pressed': active != null ? String(!!active) : null, onmousedown: (e) => { e.preventDefault(); run(e); } }, typeof ic === 'string' && ic.length < 3 && !/[a-z]{3}/.test(ic) ? ic : icon(ic, 15));
  function showBar(v) {
    const { selection } = v.state;
    if (selection.empty || !(selection instanceof TextSelection) || !selection.$from.parent.inlineContent || selection.$from.parent.type.spec.marks === '' || down || !v.hasFocus() || document.querySelector('dialog[open]')) return hideBar();
    if (!bar) { bar = h('div.bubble', { role: 'toolbar', 'aria-label': 'Format selection' }); document.body.append(bar); }
    const st = v.state; const lk = linkAt(st);
    clear(bar).append(
      barBtn('bold', 'Bold', () => E.cmd.bold(), isMarkActive(st, M.strong)), barBtn('italic', 'Italic', () => E.cmd.italic(), isMarkActive(st, M.em)), barBtn('underline', 'Underline', () => E.cmd.underline(), isMarkActive(st, M.underline)),
      barBtn('link', 'Link', () => api.editLink(bar), !!lk), h('span.tb-sep'),
      barBtn('book', 'Cite selection', () => api.pickCitation()), barBtn('commentAdd', 'Comment', () => api.addComment()), barBtn('dict', 'Define', () => api.define()),
      h('span.tb-sep'), barBtn('more', 'More actions', () => api.moreMenu(bar.getBoundingClientRect())));
    const a = v.coordsAtPos(selection.from), b = v.coordsAtPos(selection.to); const w = bar.offsetWidth, hh = bar.offsetHeight;
    const cx = (a.left + b.right) / 2; let top = Math.min(a.top, b.top) - hh - 8; if (top < 8) top = Math.max(a.bottom, b.bottom) + 8;
    bar.style.left = Math.max(8, Math.min(cx - w / 2, innerWidth - w - 8)) + 'px'; bar.style.top = top + 'px';
  }
  const hideBar = () => { if (bar) { bar.remove(); bar = null; } };
  const barPlugin = new Plugin({
    key: new PluginKey('bubble'),
    props: { handleDOMEvents: { mousedown: () => { down = true; hideBar(); return false; }, blur: () => { setTimeout(() => { if (!view.hasFocus() && !document.activeElement?.closest('.bubble, .menu, .popover')) hideBar(); }, 120); return false; } }, },
    view: () => ({ update: (v, prev) => { if (prev.doc !== v.state.doc || !prev.selection.eq(v.state.selection)) showBar(v); }, destroy: hideBar }),
  });
  document.addEventListener('mouseup', () => { if (down) { down = false; setTimeout(() => showBar(view), 0); } });
  view.dom.addEventListener('scroll', hideBar, true);

  // ---- block handle (drag + menu)
  const handle = h('button.block-handle', { draggable: 'true', 'aria-label': 'Block actions: drag to move, click for menu', title: 'Drag to move · click for menu', tabindex: '-1' }, icon('grip', 15));
  view.dom.parentElement.append(handle); let hp = null;
  const blockAt = (y) => {
    const r = view.dom.getBoundingClientRect(); const at = view.posAtCoords({ left: r.left + 24, top: y }); if (!at) return null;
    const $p = view.state.doc.resolve(at.inside >= 0 ? at.inside : at.pos); const d = $p.depth >= 1 ? 1 : 0; if (!d) return null;
    const pos = $p.before(1); if (pos < bodyStart(view.state.doc)) return null; return pos;
  };
  view.dom.addEventListener('mousemove', (e) => {
    const pos = blockAt(e.clientY); if (pos == null) { handle.style.opacity = 0; return; } hp = pos;
    const dom = view.nodeDOM(pos); if (!(dom instanceof HTMLElement)) return; const r = dom.getBoundingClientRect(), pr = view.dom.parentElement.getBoundingClientRect();
    handle.style.opacity = 1; handle.style.top = (r.top - pr.top + view.dom.parentElement.scrollTop + 2) + 'px'; handle.style.left = (r.left - pr.left - 30) + 'px';
  });
  view.dom.parentElement.addEventListener('mouseleave', () => { handle.style.opacity = 0; });
  handle.addEventListener('dragstart', (e) => {
    if (hp == null) return e.preventDefault(); const sel = NodeSelection.create(view.state.doc, hp);
    view.dispatch(view.state.tr.setSelection(sel)); view.dragging = { slice: sel.content(), move: true };
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ' '); const dom = view.nodeDOM(hp); if (dom) e.dataTransfer.setDragImage(dom, 0, 0);
  });
  const moveBlock = (pos, dir) => {
    const doc = view.state.doc, n = doc.nodeAt(pos); if (!n) return; const $p = doc.resolve(pos); const idx = $p.index(0);
    const target = idx + dir; if (target < 4 || target >= doc.childCount) return;
    let tpos = 0; for (let i = 0; i < (dir < 0 ? target : target + 1); i++) tpos += doc.child(i).nodeSize;
    const tr = view.state.tr.delete(pos, pos + n.nodeSize); const ins = dir < 0 ? tpos : tpos - n.nodeSize; tr.insert(ins, n);
    tr.setSelection(NodeSelection.create(tr.doc, ins)).setMeta('noSuggest', true).scrollIntoView(); view.dispatch(tr);
  };
  handle.addEventListener('click', () => {
    if (hp == null) return; const pos = hp; const n = view.state.doc.nodeAt(pos);
    menu(handle, [
      { label: 'Move up', icon: 'up', kbd: 'Alt-↑', action: () => moveBlock(pos, -1) }, { label: 'Move down', icon: 'down', kbd: 'Alt-↓', action: () => moveBlock(pos, 1) },
      { label: 'Duplicate', icon: 'copy', action: () => { view.dispatch(view.state.tr.insert(pos + n.nodeSize, n.copy(n.content)).setMeta('ids', true)); } },
      { divider: true }, { label: 'Delete block', icon: 'trash', action: () => view.dispatch(view.state.tr.delete(pos, pos + n.nodeSize)) },
    ], { label: 'Block actions' });
  });
  const keyPlugin = new Plugin({ props: { handleKeyDown(v, e) { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !(e.metaKey || e.ctrlKey)) { const $f = v.state.selection.$from; if ($f.depth >= 1) { moveBlock($f.before(1), e.key === 'ArrowUp' ? -1 : 1); return true; } } return false; } } });

  view.updateState(view.state.reconfigure({ plugins: [slashPlugin, keyPlugin, barPlugin, ...view.state.plugins] }));
  return { moveBlock, hideBar };
}
