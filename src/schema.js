import { Schema } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

const id = { id: { default: null } };
const j = (v) => JSON.stringify(v);
const pj = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };

const tn = tableNodes({
  tableGroup: '', cellContent: 'paragraph+',
  cellAttributes: { align: { default: null, getFromDOM: (d) => d.style.textAlign || null, setDOM: (a, d) => { if (a.align) d.style.textAlign = a.align; } } },
});
tn.table_header.toDOM = (n) => { const a = { scope: 'col' }; if (n.attrs.colspan !== 1) a.colspan = n.attrs.colspan; if (n.attrs.rowspan !== 1) a.rowspan = n.attrs.rowspan; if (n.attrs.align) a.style = `text-align:${n.attrs.align}`; return ['th', a, 0]; };

const nodes = {
  doc: { content: 'title subtitle author abstract block+' },
  title: { content: 'inline*', marks: '', defining: true, parseDOM: [{ tag: 'h1.doc-title' }], toDOM: () => ['h1', { class: 'doc-title' }, 0] },
  subtitle: { content: 'inline*', marks: '', defining: true, parseDOM: [{ tag: 'p.doc-subtitle' }], toDOM: () => ['p', { class: 'doc-subtitle' }, 0] },
  author: { content: 'inline*', marks: '', defining: true, parseDOM: [{ tag: 'p.doc-author' }], toDOM: () => ['p', { class: 'doc-author' }, 0] },
  abstract: { content: 'paragraph+', defining: true, parseDOM: [{ tag: 'section.doc-abstract' }], toDOM: () => ['section', { class: 'doc-abstract' }, 0] },
  paragraph: { content: 'inline*', group: 'block', attrs: { ...id, align: { default: null } }, parseDOM: [{ tag: 'p', getAttrs: (d) => ({ align: d.style.textAlign || null }) }], toDOM: (n) => ['p', n.attrs.align ? { style: `text-align:${n.attrs.align}` } : {}, 0] },
  heading: {
    content: 'inline*', group: 'block', defining: true, marks: '_',
    attrs: { ...id, level: { default: 1 }, planning: { default: false } },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: 'h' + level, getAttrs: (d) => ({ level, planning: d.hasAttribute('data-planning') }) })),
    toDOM: (n) => ['h' + n.attrs.level, n.attrs.planning ? { 'data-planning': '' } : {}, 0],
  },
  blockquote: { content: 'block+', group: 'block', defining: true, attrs: id, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
  callout: { content: 'block+', group: 'block', defining: true, attrs: { ...id, kind: { default: 'note' } }, parseDOM: [{ tag: 'aside.callout' }], toDOM: () => ['aside', { class: 'callout' }, 0] },
  bullet_list: { content: 'list_item+', group: 'block', attrs: id, parseDOM: [{ tag: 'ul:not([data-tasks])' }], toDOM: () => ['ul', 0] },
  ordered_list: { content: 'list_item+', group: 'block', attrs: { ...id, order: { default: 1 } }, parseDOM: [{ tag: 'ol', getAttrs: (d) => ({ order: d.hasAttribute('start') ? +d.getAttribute('start') : 1 }) }], toDOM: (n) => (n.attrs.order === 1 ? ['ol', 0] : ['ol', { start: n.attrs.order }, 0]) },
  list_item: { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li:not([data-task])' }], toDOM: () => ['li', 0] },
  task_list: { content: 'task_item+', group: 'block', attrs: id, parseDOM: [{ tag: 'ul[data-tasks]' }], toDOM: () => ['ul', { 'data-tasks': '' }, 0] },
  task_item: { content: 'paragraph block*', defining: true, attrs: { checked: { default: false } }, parseDOM: [{ tag: 'li[data-task]', getAttrs: (d) => ({ checked: d.getAttribute('data-task') === 'true' }) }], toDOM: (n) => ['li', { 'data-task': String(n.attrs.checked) }, 0] },
  code_block: { content: 'text*', marks: '', group: 'block', code: true, defining: true, attrs: id, parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', ['code', 0]] },
  horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
  page_break: { group: 'block', parseDOM: [{ tag: 'div.page-break' }], toDOM: () => ['div', { class: 'page-break' }] },
  figure: {
    group: 'block', content: 'figcaption', isolating: true, draggable: true,
    attrs: { ...id, assetId: { default: null }, src: { default: null }, alt: { default: '' }, width: { default: 70 }, align: { default: 'center' }, credit: { default: '' }, numbered: { default: true } },
    parseDOM: [{ tag: 'figure[data-fig]', contentElement: 'figcaption', getAttrs: (d) => ({ id: d.getAttribute('data-id'), assetId: d.getAttribute('data-asset'), src: d.querySelector('img')?.getAttribute('src') || null, alt: d.querySelector('img')?.getAttribute('alt') || '', width: +(d.getAttribute('data-width') || 70), align: d.getAttribute('data-align') || 'center', credit: d.getAttribute('data-credit') || '', numbered: d.getAttribute('data-numbered') !== 'false' }) }],
    toDOM: (n) => ['figure', { 'data-fig': '', 'data-id': n.attrs.id || '', 'data-asset': n.attrs.assetId || '', 'data-width': n.attrs.width, 'data-align': n.attrs.align, 'data-credit': n.attrs.credit, 'data-numbered': String(n.attrs.numbered) }, ['img', { src: n.attrs.src || '', alt: n.attrs.alt }], ['figcaption', 0]],
  },
  figcaption: { content: 'inline*', parseDOM: [{ tag: 'figcaption' }], toDOM: () => ['figcaption', 0] },
  table_block: { group: 'block', content: 'table_caption table table_note', isolating: true, draggable: true, attrs: id, parseDOM: [{ tag: 'div.table-block' }], toDOM: () => ['div', { class: 'table-block' }, 0] },
  table_caption: { content: 'inline*', parseDOM: [{ tag: 'div.table-caption' }], toDOM: () => ['div', { class: 'table-caption' }, 0] },
  table_note: { content: 'inline*', parseDOM: [{ tag: 'div.table-note' }], toDOM: () => ['div', { class: 'table-note' }, 0] },
  ...tn,
  math_block: { group: 'block', atom: true, draggable: true, attrs: { ...id, latex: { default: '' }, numbered: { default: true } }, parseDOM: [{ tag: 'div[data-math-block]', getAttrs: (d) => ({ latex: d.getAttribute('data-latex') || '', numbered: d.getAttribute('data-numbered') !== 'false', id: d.getAttribute('data-id') }) }], toDOM: (n) => ['div', { 'data-math-block': '', 'data-latex': n.attrs.latex, 'data-numbered': String(n.attrs.numbered), 'data-id': n.attrs.id || '' }, n.attrs.latex] },
  text: { group: 'inline' },
  hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  math_inline: { inline: true, group: 'inline', atom: true, attrs: { latex: { default: '' } }, parseDOM: [{ tag: 'span[data-math]', getAttrs: (d) => ({ latex: d.getAttribute('data-latex') || d.textContent }) }], toDOM: (n) => ['span', { 'data-math': '', 'data-latex': n.attrs.latex }, n.attrs.latex] },
  citation: {
    inline: true, group: 'inline', atom: true, selectable: true,
    attrs: { id: { default: null }, items: { default: [] }, mode: { default: 'parenthetical' } },
    parseDOM: [{ tag: 'span[data-citation]', getAttrs: (d) => ({ id: d.getAttribute('data-id'), items: pj(d.getAttribute('data-items'), []), mode: d.getAttribute('data-mode') || 'parenthetical' }) }],
    toDOM: (n) => ['span', { 'data-citation': '', 'data-id': n.attrs.id || '', 'data-items': j(n.attrs.items), 'data-mode': n.attrs.mode }, '(citation)'],
  },
  footnote: {
    inline: true, group: 'inline', atom: true, selectable: true,
    attrs: { id: { default: null }, content: { default: [] } },
    parseDOM: [{ tag: 'span[data-footnote]', getAttrs: (d) => ({ id: d.getAttribute('data-id'), content: pj(d.getAttribute('data-content'), []) }) }],
    toDOM: (n) => ['span', { 'data-footnote': '', 'data-id': n.attrs.id || '', 'data-content': j(n.attrs.content) }, '*'],
  },
  crossref: {
    inline: true, group: 'inline', atom: true, selectable: true,
    attrs: { target: { default: null }, kind: { default: 'figure' }, form: { default: 'full' } },
    parseDOM: [{ tag: 'span[data-xref]', getAttrs: (d) => ({ target: d.getAttribute('data-target'), kind: d.getAttribute('data-kind'), form: d.getAttribute('data-form') || 'full' }) }],
    toDOM: (n) => ['span', { 'data-xref': '', 'data-target': n.attrs.target || '', 'data-kind': n.attrs.kind, 'data-form': n.attrs.form }, '?'],
  },
};

const marks = {
  link: { attrs: { href: {}, title: { default: null } }, inclusive: false, parseDOM: [{ tag: 'a[href]', getAttrs: (d) => ({ href: d.getAttribute('href'), title: d.getAttribute('title') }) }], toDOM: (m) => ['a', { href: m.attrs.href, title: m.attrs.title, rel: 'noopener noreferrer' }, 0] },
  em: { parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
  strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: (d) => d.style.fontWeight !== 'normal' && null }, { style: 'font-weight=700' }], toDOM: () => ['strong', 0] },
  underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
  strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }], toDOM: () => ['s', 0] },
  sup: { excludes: 'sub', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
  sub: { excludes: 'sup', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
  code: { excludes: '_', parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
  comment: { attrs: { commentId: {} }, inclusive: false, excludes: '', parseDOM: [{ tag: 'span[data-comment]', getAttrs: (d) => ({ commentId: d.getAttribute('data-comment') }) }], toDOM: (m) => ['span', { 'data-comment': m.attrs.commentId, class: 'mk-comment' }, 0] },
  claim: { attrs: { claimId: {} }, inclusive: false, excludes: '', parseDOM: [{ tag: 'span[data-claim]', getAttrs: (d) => ({ claimId: d.getAttribute('data-claim') }) }], toDOM: (m) => ['span', { 'data-claim': m.attrs.claimId, class: 'mk-claim' }, 0] },
  quote: { attrs: { quoteId: { default: null }, sourceId: { default: null }, page: { default: '' }, noteId: { default: null } }, inclusive: false, parseDOM: [{ tag: 'span[data-quote]', getAttrs: (d) => ({ quoteId: d.getAttribute('data-quote'), sourceId: d.getAttribute('data-source'), page: d.getAttribute('data-page') || '', noteId: d.getAttribute('data-note') }) }], toDOM: (m) => ['span', { 'data-quote': m.attrs.quoteId || '', 'data-source': m.attrs.sourceId || '', 'data-page': m.attrs.page, 'data-note': m.attrs.noteId || '', class: 'mk-quote' }, 0] },
  ins: { attrs: { sid: {}, author: { default: '' }, time: { default: 0 } }, inclusive: false, excludes: '', parseDOM: [{ tag: 'ins[data-sid]', getAttrs: (d) => ({ sid: d.getAttribute('data-sid'), author: d.getAttribute('data-author') || '', time: +(d.getAttribute('data-time') || 0) }) }], toDOM: (m) => ['ins', { 'data-sid': m.attrs.sid, 'data-author': m.attrs.author, 'data-time': m.attrs.time }, 0] },
  del: { attrs: { sid: {}, author: { default: '' }, time: { default: 0 } }, inclusive: false, excludes: '', parseDOM: [{ tag: 'del[data-sid]', getAttrs: (d) => ({ sid: d.getAttribute('data-sid'), author: d.getAttribute('data-author') || '', time: +(d.getAttribute('data-time') || 0) }) }], toDOM: (m) => ['del', { 'data-sid': m.attrs.sid, 'data-author': m.attrs.author, 'data-time': m.attrs.time }, 0] },
};

export const schema = new Schema({ nodes, marks });

// Smaller schema for editing footnote bodies: same node/mark names so JSON is interchangeable.
export const fnSchema = new Schema({
  nodes: { doc: { content: 'paragraph' }, paragraph: { content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] }, text: { group: 'inline' }, math_inline: nodes.math_inline, citation: nodes.citation, hard_break: nodes.hard_break },
  marks: { link: marks.link, em: marks.em, strong: marks.strong, sup: marks.sup, sub: marks.sub, code: marks.code },
});

export function emptyDoc(meta = {}) {
  const t = (s) => (s ? [{ type: 'text', text: s }] : []);
  return {
    type: 'doc', content: [
      { type: 'title', content: t(meta.title) }, { type: 'subtitle', content: t(meta.subtitle) }, { type: 'author', content: t(meta.author) },
      { type: 'abstract', content: [{ type: 'paragraph' }] }, { type: 'paragraph' },
    ],
  };
}
export const textOf = (node) => node.textBetween(0, node.content.size, ' ', ' ');
