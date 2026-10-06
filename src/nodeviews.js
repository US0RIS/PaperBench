import katex from 'katex';
import { NodeSelection } from 'prosemirror-state';
import { S, assetURL } from './state.js';
import { h, bus } from './ui.js';
import { stripTags, escapeHtml } from './model.js';

const live = new Set();
export const refreshNodeViews = () => live.forEach((v) => v.render?.());
bus.on('derived', refreshNodeViews);

export function renderMath(latex, display) {
  try { return katex.renderToString(latex || '\\;', { displayMode: !!display, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore', trust: false }); }
  catch (e) { return `<span class="math-err">${escapeHtml(latex)}</span>`; }
}
const labelOf = (id) => S.derived?.A?.labels.get(id);
const selectOnClick = (el, view, getPos) => el.addEventListener('mousedown', (e) => { if (e.button !== 0) return; e.preventDefault(); view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, getPos())).scrollIntoView()); view.focus(); });

class Base {
  constructor(node, view, getPos) { this.node = node; this.view = view; this.getPos = getPos; live.add(this); }
  update(node) { if (node.type !== this.node.type) return false; this.node = node; this.render(); return true; }
  destroy() { live.delete(this); }
  selectNode() { this.dom.classList.add('is-selected'); }
  deselectNode() { this.dom.classList.remove('is-selected'); }
  stopEvent() { return false; }
  ignoreMutation() { return true; }
}

export class MathInline extends Base {
  constructor(...a) { super(...a); this.dom = h('span.math-inline', { 'data-math': '' }); selectOnClick(this.dom, this.view, this.getPos); this.render(); }
  render() { const k = this.node.attrs.latex; if (this.last !== k) { this.dom.innerHTML = renderMath(k, false); this.last = k; } this.dom.title = k; }
}
export class MathBlock extends Base {
  constructor(...a) { super(...a); this.body = h('div.math-body'); this.num = h('span.eq-num'); this.dom = h('div.math-block', this.body, this.num); selectOnClick(this.dom, this.view, this.getPos); this.render(); }
  render() {
    const { latex, numbered, id } = this.node.attrs;
    if (this.last !== latex) { this.body.innerHTML = renderMath(latex, true); this.last = latex; }
    this.num.textContent = numbered ? (labelOf(id)?.short || '') : ''; this.dom.classList.toggle('empty', !latex);
    this.dom.setAttribute('aria-label', 'Equation ' + (labelOf(id)?.short || '')); this.dom.setAttribute('role', 'group');
  }
}
export class CitationView extends Base {
  constructor(...a) { super(...a); this.dom = h('span.cite', { role: 'button', tabindex: '-1' }); selectOnClick(this.dom, this.view, this.getPos); this.render(); }
  render() {
    const D = S.derived, id = this.node.attrs.id; const html = D?.cites.get(id); const missing = this.node.attrs.items.some((i) => !S.sources.has(i.sourceId));
    const asNote = D?.noteOf?.get(id);
    if (asNote) { this.dom.innerHTML = `<sup class="fn-ref">${asNote}</sup>`; this.dom.classList.add('as-note'); this.dom.title = stripTags(html || ''); }
    else { this.dom.classList.remove('as-note'); this.dom.innerHTML = html || (missing ? '(missing source)' : '(…)'); this.dom.removeAttribute('title'); }
    this.dom.classList.toggle('missing', missing || !html);
    this.dom.setAttribute('aria-label', 'Citation: ' + stripTags(html || 'unresolved'));
  }
}
export class FootnoteView extends Base {
  constructor(...a) { super(...a); this.dom = h('sup.fn-ref', { role: 'button', tabindex: '-1' }); selectOnClick(this.dom, this.view, this.getPos); this.render(); }
  render() {
    const l = labelOf(this.node.attrs.id); this.dom.textContent = l ? l.n : '·';
    const txt = (function walk(n) { return (n || []).map((x) => (x.text || (x.type === 'citation' ? '(citation)' : walk(x.content)))).join(''); })(this.node.attrs.content);
    this.dom.title = txt || 'Empty note'; this.dom.setAttribute('aria-label', `Note ${l ? l.n : ''}: ${txt || 'empty'}`);
  }
}
export class CrossrefView extends Base {
  constructor(...a) { super(...a); this.dom = h('span.xref', { role: 'link' }); selectOnClick(this.dom, this.view, this.getPos); this.render(); }
  render() {
    const { target, form } = this.node.attrs; const l = labelOf(target);
    const txt = !l ? '??' : form === 'number' ? (l.kind === 'equation' ? l.short : String(l.n ?? l.label)) : l.label;
    this.dom.textContent = txt; this.dom.classList.toggle('missing', !l); this.dom.title = l ? (l.text || l.label) : 'Target no longer exists';
  }
}
export class FigureView extends Base {
  constructor(...a) {
    super(...a);
    this.img = h('img', { draggable: 'false' }); this.media = h('div.fig-media', { contenteditable: 'false' }, this.img);
    this.contentDOM = h('div.fig-cap'); this.credit = h('div.fig-credit', { contenteditable: 'false' });
    this.dom = h('figure.fig', this.media, this.contentDOM, this.credit);
    selectOnClick(this.media, this.view, this.getPos); this.render();
  }
  async render() {
    const a = this.node.attrs; this.dom.dataset.align = a.align; this.media.style.width = a.width + '%';
    this.img.alt = a.alt || ''; this.credit.textContent = a.credit || ''; this.credit.hidden = !a.credit;
    const key = a.assetId || a.src;
    if (this.key !== key) { this.key = key; const u = a.assetId ? await assetURL(a.assetId) : a.src; if (this.key === key && u) this.img.src = u; this.dom.classList.toggle('no-img', !u); }
    this.dom.classList.toggle('no-alt', !a.alt);
  }
}
export class TaskItemView extends Base {
  constructor(...a) {
    super(...a);
    this.cb = h('input', { type: 'checkbox', 'aria-label': 'Done', onchange: () => { const p = this.getPos(); this.view.dispatch(this.view.state.tr.setNodeMarkup(p, null, { checked: this.cb.checked })); } });
    this.contentDOM = h('div.task-body'); this.dom = h('li.task', h('span.task-cb', { contenteditable: 'false' }, this.cb), this.contentDOM); this.render();
  }
  render() { this.cb.checked = !!this.node.attrs.checked; this.dom.classList.toggle('done', !!this.node.attrs.checked); }
  ignoreMutation(m) { return !this.contentDOM.contains(m.target); }
}
export const nodeViews = {
  math_inline: (n, v, g) => new MathInline(n, v, g), math_block: (n, v, g) => new MathBlock(n, v, g), citation: (n, v, g) => new CitationView(n, v, g),
  footnote: (n, v, g) => new FootnoteView(n, v, g), crossref: (n, v, g) => new CrossrefView(n, v, g), figure: (n, v, g) => new FigureView(n, v, g), task_item: (n, v, g) => new TaskItemView(n, v, g),
};
