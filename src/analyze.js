// Walks the ProseMirror doc once and derives structure: headings, numbering, notes, citations, cross-reference labels.
import { wordCount } from './model.js';

export function walkJSON(nodes, fn) { for (const n of nodes || []) { fn(n); if (n.content) walkJSON(n.content, fn); } }

export function analyze(doc, opts = {}) {
  const A = { headings: [], figures: [], tables: [], equations: [], footnotes: [], citations: [], crossrefs: [], claims: [], labels: new Map(), noteCount: 0, sections: [], text: '' };
  const noteStyle = !!opts.noteStyle;
  let fig = 0, tab = 0, eq = 0, note = 0;
  const counters = [0, 0, 0, 0, 0, 0];
  doc.descendants((node, pos) => {
    const t = node.type.name;
    if (t === 'heading') {
      const lvl = node.attrs.level;
      let num = '';
      if (!node.attrs.planning) { counters[lvl - 1]++; for (let i = lvl; i < 6; i++) counters[i] = 0; num = counters.slice(0, lvl).filter((_, i) => counters[i] > 0 || i === lvl - 1).join('.'); }
      const h = { id: node.attrs.id, pos, end: pos + node.nodeSize, level: lvl, text: node.textContent, planning: node.attrs.planning, num };
      A.headings.push(h);
      if (node.attrs.id) A.labels.set(node.attrs.id, { kind: 'section', n: num, label: opts.numberHeadings && num ? `Section ${num}` : `“${node.textContent || 'Untitled section'}”`, text: node.textContent });
      return false;
    }
    if (t === 'figure') { const cap = node.textContent; if (node.attrs.numbered) { fig++; A.figures.push({ id: node.attrs.id, pos, n: fig, caption: cap }); if (node.attrs.id) A.labels.set(node.attrs.id, { kind: 'figure', n: fig, label: `Figure ${fig}`, text: cap }); } else A.figures.push({ id: node.attrs.id, pos, n: null, caption: cap }); return false; }
    if (t === 'table_block') { tab++; const cap = node.firstChild.textContent; A.tables.push({ id: node.attrs.id, pos, n: tab, caption: cap }); if (node.attrs.id) A.labels.set(node.attrs.id, { kind: 'table', n: tab, label: `Table ${tab}`, text: cap }); return false; }
    if (t === 'math_block') { if (node.attrs.numbered) { eq++; if (node.attrs.id) A.labels.set(node.attrs.id, { kind: 'equation', n: eq, label: `Equation (${eq})`, short: `(${eq})`, text: node.attrs.latex }); A.equations.push({ id: node.attrs.id, pos, n: eq, latex: node.attrs.latex }); } else A.equations.push({ id: node.attrs.id, pos, n: null, latex: node.attrs.latex }); return false; }
    if (t === 'footnote') {
      note++; const f = { id: node.attrs.id, pos, n: note, content: node.attrs.content }; A.footnotes.push(f);
      if (node.attrs.id) A.labels.set(node.attrs.id, { kind: 'footnote', n: note, label: `note ${note}`, text: '' });
      walkJSON(node.attrs.content, (c) => { if (c.type === 'citation') A.citations.push({ id: c.attrs.id, items: c.attrs.items, mode: c.attrs.mode, pos, noteIndex: note, inFootnote: f.id }); });
      return false;
    }
    if (t === 'citation') {
      const asNote = noteStyle || node.attrs.mode === 'note';
      if (asNote) note++;
      A.citations.push({ id: node.attrs.id, items: node.attrs.items, mode: node.attrs.mode, pos, noteIndex: asNote ? note : 0, asNote });
      return false;
    }
    if (t === 'crossref') { A.crossrefs.push({ pos, ...node.attrs }); return false; }
    if (node.isText) node.marks.forEach((m) => { if (m.type.name === 'claim') A.claims.push({ claimId: m.attrs.claimId, pos, text: node.text, blockPos: null }); });
    return true;
  });
  A.noteCount = note;
  // Section ranges and word counts (excluding planning headings' sections, drafting callouts, front matter)
  const hs = A.headings;
  hs.forEach((h, i) => {
    let end = doc.content.size; for (let j = i + 1; j < hs.length; j++) if (hs[j].level <= h.level) { end = hs[j].pos; break; }
    h.sectionEnd = end; h.words = countWordsIn(doc, h.end, end);
  });
  let front = 0; for (let i = 0; i < Math.min(3, doc.childCount); i++) front += doc.child(i).nodeSize; // title, subtitle, author are not body words
  A.bodyWords = countWordsIn(doc, front, doc.content.size);
  A.text = doc.textBetween(0, doc.content.size, '\n', ' ');
  return A;
}

export function countWordsIn(doc, from, to) {
  let n = 0;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'callout' || (node.type.name === 'heading' && node.attrs.planning)) return false;
    if (node.type.name === 'math_block' || node.type.name === 'page_break') return false;
    if (node.isText) { const a = Math.max(from, pos) - pos, b = Math.min(to, pos + node.nodeSize) - pos; n += wordCount(node.text.slice(a, b)); }
    return true;
  });
  return n;
}
export function labelFor(A, target, form = 'full') {
  const l = A.labels.get(target); if (!l) return '??';
  if (form === 'number') return l.kind === 'equation' ? l.short : String(l.n ?? l.label);
  return l.label;
}
