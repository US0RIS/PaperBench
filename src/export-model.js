// Builds a format-neutral model of the paper (citations rendered, notes numbered) for all exporters.
import katex from 'katex';
import { S, refreshDerived, assetURL } from './state.js';
import * as DB from './db.js';
import { schema } from './schema.js';
import { bibInner, isNoteStyle } from './csl.js';
import { stripTags } from './model.js';

const T = schema.nodes;
export function htmlToRuns(html) {
  const d = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html'); const out = [];
  (function walk(n, st) { n.childNodes.forEach((c) => { if (c.nodeType === 3) { if (c.data) out.push({ text: c.data, ...st }); } else if (c.nodeType === 1) { const t = c.tagName.toLowerCase(); const s2 = { ...st }; if (t === 'i' || t === 'em') s2.i = 1; if (t === 'b' || t === 'strong') s2.b = 1; if (t === 'sup') s2.sup = 1; if (t === 'sub') s2.sub = 1; if (t === 'a') s2.link = c.getAttribute('href'); if (/italic/.test(c.getAttribute('style') || '')) s2.i = 1; walk(c, s2); } }); })(d.body.firstChild, {});
  return out.map((r) => ({ ...r, text: r.text.replace(/&#38;/g, '&') }));
}
const markFlags = (marks) => { const r = {}; let del = false; marks.forEach((m) => { const n = m.type.name; if (n === 'strong') r.b = 1; else if (n === 'em') r.i = 1; else if (n === 'underline') r.u = 1; else if (n === 'strike') r.s = 1; else if (n === 'sup') r.sup = 1; else if (n === 'sub') r.sub = 1; else if (n === 'code') r.code = 1; else if (n === 'link') r.link = m.attrs.href; else if (n === 'quote') r.quote = 1; else if (n === 'del') del = true; }); return del ? null : r; };

export async function buildModel() {
  refreshDerived(); const E = S.editor; const doc = E.view.state.doc; const D = S.derived; const A = D.A; const st = S.settings; const notes = []; const noteStyle = D.noteStyle;
  const labelOf = (id) => A.labels.get(id);
  const fnRuns = (content, fid) => { let ci = 0; const cites = D.fnCites.get(fid) || []; const out = []; (function walk(arr) { (arr || []).forEach((x) => { if (x.type === 'text') { const f = markFlags((x.marks || []).map((m) => ({ type: { name: m.type }, attrs: m.attrs || {} }))); if (f) out.push({ text: x.text, ...f }); } else if (x.type === 'citation') out.push(...htmlToRuns(cites[ci++] || '')); else if (x.type === 'math_inline') out.push({ math: x.attrs.latex }); else if (x.type === 'hard_break') out.push({ br: 1 }); else if (x.content) walk(x.content); }); })(content); return out; };
  const runs = (node) => {
    const out = [];
    node.forEach((ch) => {
      if (ch.isText) { const f = markFlags(ch.marks); if (f) out.push({ text: ch.text, ...f }); return; }
      switch (ch.type.name) {
        case 'hard_break': out.push({ br: 1 }); break;
        case 'math_inline': out.push({ math: ch.attrs.latex }); break;
        case 'citation': { const n = D.noteOf?.get(ch.attrs.id); const rr = htmlToRuns(D.cites.get(ch.attrs.id) || ''); if (n) { notes.push({ n, runs: rr, cite: ch.attrs }); out.push({ note: n }); } else out.push({ cite: ch.attrs, runs: rr }); break; }
        case 'footnote': { const l = labelOf(ch.attrs.id); const n = l?.n; notes.push({ n, runs: fnRuns(ch.attrs.content, ch.attrs.id), fn: ch.attrs }); out.push({ note: n }); break; }
        case 'crossref': { const l = labelOf(ch.attrs.target); const txt = !l ? '??' : ch.attrs.form === 'number' ? (l.kind === 'equation' ? l.short : String(l.n ?? l.label)) : l.label; out.push({ text: txt, xref: ch.attrs.target, xkind: l?.kind, xform: ch.attrs.form }); break; }
        default: break;
      }
    });
    return out;
  };
  const block = (n) => {
    switch (n.type.name) {
      case 'paragraph': return { t: 'p', runs: runs(n), align: n.attrs.align };
      case 'heading': if (n.attrs.planning) return null; return { t: 'h', level: n.attrs.level, runs: runs(n), id: n.attrs.id, num: S.settings.numberHeadings ? A.headings.find((h) => h.id === n.attrs.id)?.num : '' };
      case 'blockquote': return { t: 'quote', blocks: kids(n) };
      case 'callout': return null;
      case 'bullet_list': case 'ordered_list': case 'task_list': { const items = []; n.forEach((li) => items.push({ blocks: kids(li), checked: li.attrs.checked })); return { t: 'list', ordered: n.type.name === 'ordered_list', task: n.type.name === 'task_list', start: n.attrs.order || 1, items }; }
      case 'code_block': return { t: 'code', text: n.textContent };
      case 'horizontal_rule': return { t: 'hr' };
      case 'page_break': return { t: 'pb' };
      case 'math_block': { const l = labelOf(n.attrs.id); return { t: 'math', latex: n.attrs.latex, n: n.attrs.numbered ? l?.n : null, id: n.attrs.id }; }
      case 'figure': { const l = labelOf(n.attrs.id); return { t: 'fig', n: n.attrs.numbered ? l?.n : null, id: n.attrs.id, caption: runs(n.firstChild), assetId: n.attrs.assetId, src: n.attrs.src, alt: n.attrs.alt, width: n.attrs.width, align: n.attrs.align, credit: n.attrs.credit }; }
      case 'table_block': {
        const l = labelOf(n.attrs.id); const tbl = n.child(1); const rows = []; tbl.forEach((r) => { const cells = []; r.forEach((c) => cells.push({ blocks: kids(c), header: c.type.name === 'table_header', align: c.attrs.align, colspan: c.attrs.colspan, rowspan: c.attrs.rowspan })); rows.push(cells); });
        return { t: 'table', n: l?.n, id: n.attrs.id, caption: runs(n.child(0)), rows, note: runs(n.child(2)) };
      }
      default: return null;
    }
  };
  const kids = (n) => { const o = []; n.forEach((c) => { const b = block(c); if (b) o.push(b); }); return o; };
  const body = []; doc.forEach((n, _o, i) => { if (i >= 4) { const b = block(n); if (b) body.push(b); } });
  notes.sort((a, b) => a.n - b.n);
  const bib = D.bib.entries.map((e) => { const inner = bibInner(e.html); const m = /<div class="csl-left-margin">([\s\S]*?)<\/div>\s*<div class="csl-right-inline">([\s\S]*?)<\/div>/.exec(inner); return { sourceId: e.sourceId, runs: htmlToRuns(m ? m[1] + ' ' + m[2] : inner), label: m ? stripTags(m[1]) : null }; });
  const styleId = st.citationStyle; const bibTitle = { apa: 'References', mla: 'Works Cited', 'chicago-nb': 'Bibliography', 'chicago-ad': 'References', harvard: 'Reference list', ieee: 'References' }[styleId] || 'References';
  return { title: doc.child(0).textContent, subtitle: doc.child(1).textContent, author: doc.child(2).textContent || st.author, abstract: runsList(doc.child(3), runs), body, notes, bib, bibTitle, styleId, noteStyle, noteMode: st.noteMode, settings: st, hangingIndent: !!D.bib.params?.hangingindent, numericBib: bib.some((b) => b.label), sources: S.sources, derived: D };
}
const runsList = (abs, runs) => { const o = []; abs.forEach((p) => o.push(runs(p))); return o; };

// ---- assets ---------------------------------------------------------------------
export async function loadImage(fig) {
  let blob = null; if (fig.assetId) blob = await DB.getBlob(S.id, fig.assetId); else if (fig.src) { try { blob = await (await fetch(fig.src)).blob(); } catch { /* */ } }
  if (!blob) return null; const type = blob.type || 'image/png'; const url = URL.createObjectURL(blob);
  const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; }); if (!img) { URL.revokeObjectURL(url); return null; }
  const w = img.naturalWidth || 640, hgt = img.naturalHeight || 360; let outBlob = blob, ext = type.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'png');
  if (!['image/png', 'image/jpeg', 'image/gif'].includes(type)) { const cv = document.createElement('canvas'); const sc = type === 'image/svg+xml' ? 2 : 1; cv.width = w * sc; cv.height = hgt * sc; const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height); outBlob = await new Promise((r) => cv.toBlob(r, 'image/png')); ext = 'png'; }
  URL.revokeObjectURL(url); const data = new Uint8Array(await outBlob.arrayBuffer());
  return { data, ext: ext === 'jpg' ? 'jpg' : ext, mime: outBlob.type, w, h: hgt, blob: outBlob };
}
export const dataURL = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });

// ---- MathML -> OMML -----------------------------------------------------------
const NARY = new Set(['∑', '∏', '∫', '∬', '∭', '∮', '⋃', '⋂', '⨁', '⨂', '∐']);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KNOWN_FN = /^(sin|cos|tan|cot|sec|csc|log|ln|exp|lim|max|min|sup|inf|det|dim|arg|deg|gcd|Pr|mod|sinh|cosh|tanh)$/;
export function latexToOMML(latex, display) {
  const mml = katex.renderToString(latex || ' ', { output: 'mathml', displayMode: !!display, throwOnError: true, strict: 'ignore' });
  const d = new DOMParser().parseFromString(mml.match(/<math[\s\S]*<\/math>/)[0], 'text/xml'); const root = d.documentElement; const kids = (el) => [...el.children];
  const run = (t, plain) => `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<m:t xml:space="preserve">${esc(t)}</m:t></m:r>`;
  const arg = (tag, el) => `<m:${tag}>${seq(el ? (Array.isArray(el) ? el : [el]) : [])}</m:${tag}>`;
  function seq(list) {
    let out = '';
    for (let i = 0; i < list.length; i++) {
      const el = list[i]; const tag = el.localName; const c = kids(el);
      const base = (tag === 'munderover' || tag === 'msubsup' || tag === 'munder' || tag === 'msub' || tag === 'mover' || tag === 'msup') ? c[0] : null;
      if (base && base.localName === 'mo' && NARY.has(base.textContent.trim())) {
        const lo = (tag === 'munderover' || tag === 'msubsup') ? c[1] : (tag === 'munder' || tag === 'msub') ? c[1] : null; const hi = (tag === 'munderover' || tag === 'msubsup') ? c[2] : (tag === 'mover' || tag === 'msup') ? c[1] : null;
        const operand = list.slice(i + 1); i = list.length;
        out += `<m:nary><m:naryPr><m:chr m:val="${esc(base.textContent.trim())}"/><m:limLoc m:val="${tag.startsWith('munder') || tag === 'mover' ? 'undOvr' : 'subSup'}"/>${lo ? '' : '<m:subHide m:val="1"/>'}${hi ? '' : '<m:supHide m:val="1"/>'}</m:naryPr>${arg('sub', lo)}${arg('sup', hi)}<m:e>${seq(operand)}</m:e></m:nary>`; break;
      }
      out += one(el, tag, c);
    }
    return out;
  }
  function one(el, tag, c) {
    switch (tag) {
      case 'semantics': return seq([c[0]]);
      case 'annotation': return '';
      case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'menclose': {
        if (tag === 'mrow' && c.length >= 2 && c[0].localName === 'mo' && c[c.length - 1].localName === 'mo' && (c[0].getAttribute('fence') === 'true' || c[0].getAttribute('stretchy') === 'true') && /^[([{|⟨⌊⌈]$/.test(c[0].textContent.trim()) && /^[)\]}|⟩⌋⌉]$/.test(c[c.length - 1].textContent.trim())) return `<m:d><m:dPr><m:begChr m:val="${esc(c[0].textContent.trim())}"/><m:endChr m:val="${esc(c[c.length - 1].textContent.trim())}"/></m:dPr><m:e>${seq(c.slice(1, -1))}</m:e></m:d>`;
        return seq(c);
      }
      case 'mi': { const t = el.textContent; return run(t, t.length > 1 || el.getAttribute('mathvariant') === 'normal' || KNOWN_FN.test(t)); }
      case 'mn': return run(el.textContent); case 'mo': return run(el.textContent.trim() || ' ', true); case 'mtext': return run(el.textContent, true);
      case 'mspace': return run(' ', true);
      case 'mfrac': return `<m:f>${arg('num', c[0])}${arg('den', c[1])}</m:f>`;
      case 'msup': return `<m:sSup><m:e>${seq([c[0]])}</m:e>${arg('sup', c[1])}</m:sSup>`;
      case 'msub': return `<m:sSub><m:e>${seq([c[0]])}</m:e>${arg('sub', c[1])}</m:sSub>`;
      case 'msubsup': return `<m:sSubSup><m:e>${seq([c[0]])}</m:e>${arg('sub', c[1])}${arg('sup', c[2])}</m:sSubSup>`;
      case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${seq(c)}</m:e></m:rad>`;
      case 'mroot': return `<m:rad><m:radPr/>${arg('deg', c[1])}<m:e>${seq([c[0]])}</m:e></m:rad>`;
      case 'mover': { const acc = c[1].textContent.trim(); if (['^', '¯', '→', '˜', '˙', '¨', '‾', 'ˇ'].includes(acc)) return `<m:acc><m:accPr><m:chr m:val="${esc(acc === '‾' ? '¯' : acc)}"/></m:accPr><m:e>${seq([c[0]])}</m:e></m:acc>`; return `<m:limUpp><m:e>${seq([c[0]])}</m:e>${arg('lim', c[1])}</m:limUpp>`; }
      case 'munder': return `<m:limLow><m:e>${seq([c[0]])}</m:e>${arg('lim', c[1])}</m:limLow>`;
      case 'munderover': return `<m:limUpp><m:e><m:limLow><m:e>${seq([c[0]])}</m:e>${arg('lim', c[1])}</m:limLow></m:e>${arg('lim', c[2])}</m:limUpp>`;
      case 'mtable': return `<m:m>${c.map((r) => `<m:mr>${kids(r).map((cell) => `<m:e>${seq(kids(cell))}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`;
      case 'mphantom': return '';
      default: return c.length ? seq(c) : run(el.textContent);
    }
  }
  const inner = seq([root]);
  return display ? `<m:oMathPara><m:oMath>${inner}</m:oMath></m:oMathPara>` : `<m:oMath>${inner}</m:oMath>`;
}
