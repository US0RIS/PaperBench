// Export formats: DOCX, PDF (print), Markdown, HTML, plain text, LaTeX (zip), BibTeX, RIS, CSL JSON.
import katex from 'katex';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Footer, Header, PageNumber, Table, TableRow, TableCell, WidthType, ImageRun, FootnoteReferenceRun, PageBreak, LevelFormat, ExternalHyperlink, BorderStyle, TabStopType, LineRuleType, ImportedXmlComponent, VerticalAlign } from 'docx';
import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-ris';
import { S } from './state.js';
import { buildModel, loadImage, dataURL, latexToOMML } from './export-model.js';
import { toCSL, firstFamily, yearOf, normTitle, escapeHtml, EXPORT_PRESETS } from './model.js';
import { download } from './ui.js';

const plain = (runs) => runs.map((r) => (r.br ? '\n' : r.math ? r.math : r.note ? '' : r.cite ? r.runs.map((x) => x.text).join('') : r.text || '')).join('');
const safeName = (t) => (t || 'paper').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'paper';
const optsOf = (o) => ({ ...EXPORT_PRESETS.apa, ...S.settings.export, ...(o || {}) });
const PAGE = { letter: { w: 8.5, h: 11 }, a4: { w: 8.27, h: 11.69 }, legal: { w: 8.5, h: 14 } };

// ---- bibliography formats -------------------------------------------------------
export function bibKeys(sources) {
  const keys = new Map(), used = new Set();
  sources.forEach((s) => { let base = ((firstFamily(s) || 'anon').toLowerCase().replace(/[^a-z0-9]/g, '') || 'anon') + (yearOf(s) || 'nd') + ((normTitle(s.title).split(' ').find((w) => w.length > 3) || 'x').slice(0, 8)); let k = base, i = 0; while (used.has(k)) k = base + String.fromCharCode(97 + i++); used.add(k); keys.set(s.id, k); });
  return keys;
}
function cslItems(list) { const keys = bibKeys(list); return list.map((s) => ({ ...toCSL(s), id: keys.get(s.id) })); }
export function exportBibliography(format, { all = false } = {}) {
  const D = S.derived; const cited = new Set(D.used); const list = [...S.sources.values()].filter((s) => all || cited.has(s.id) || s._forceBib);
  if (!list.length) throw new Error('There are no sources to export' + (all ? '.' : ' (none are cited yet).'));
  const items = cslItems(list);
  if (format === 'csljson') return { name: 'references.json', data: JSON.stringify(items, null, 2), type: 'application/json' };
  const cite = new Cite(items);
  if (format === 'bibtex') return { name: 'references.bib', data: cite.format('bibtex'), type: 'application/x-bibtex' };
  if (format === 'ris') return { name: 'references.ris', data: cite.format('ris'), type: 'application/x-research-info-systems' };
  throw new Error('Unknown format');
}

// ---- shared HTML renderer ---------------------------------------------------------
const mathML = (latex, display) => { try { return katex.renderToString(latex, { output: 'mathml', displayMode: display, throwOnError: false, strict: 'ignore' }); } catch { return `<code>${escapeHtml(latex)}</code>`; } };
function runsHTML(runs, m, ctx) {
  return runs.map((r) => {
    if (r.br) return '<br>'; if (r.math != null) return mathML(r.math, false);
    if (r.note) return `<sup class="fnref"><a id="r${r.note}" href="#fn${r.note}">${r.note}</a></sup>`;
    if (r.cite) return runsHTML(r.runs, m, ctx);
    let t = escapeHtml(r.text || ''); if (r.xref && ctx?.xrefs) t = `<a class="xref" href="#${r.xref}">${t}</a>`;
    if (r.code) t = `<code>${t}</code>`; if (r.i) t = `<em>${t}</em>`; if (r.b) t = `<strong>${t}</strong>`; if (r.u) t = `<u>${t}</u>`; if (r.s) t = `<s>${t}</s>`; if (r.sup) t = `<sup>${t}</sup>`; if (r.sub) t = `<sub>${t}</sub>`; if (r.link) t = `<a href="${escapeHtml(r.link)}">${t}</a>`; return t;
  }).join('');
}
async function blocksHTML(blocks, m, ctx, imgs) {
  let out = '';
  for (const b of blocks) {
    switch (b.t) {
      case 'p': out += `<p${b.align ? ` style="text-align:${b.align}"` : ''}>${runsHTML(b.runs, m, ctx)}</p>\n`; break;
      case 'h': out += `<h${Math.min(6, b.level + 1)} id="${b.id || ''}">${b.num ? b.num + ' ' : ''}${runsHTML(b.runs, m, ctx)}</h${Math.min(6, b.level + 1)}>\n`; break;
      case 'quote': out += `<blockquote>${await blocksHTML(b.blocks, m, ctx, imgs)}</blockquote>\n`; break;
      case 'list': { const tag = b.ordered ? 'ol' : 'ul'; out += `<${tag}${b.ordered && b.start !== 1 ? ` start="${b.start}"` : ''}${b.task ? ' class="tasks"' : ''}>${(await Promise.all(b.items.map(async (it) => `<li>${b.task ? `<input type="checkbox" disabled${it.checked ? ' checked' : ''}> ` : ''}${(await blocksHTML(it.blocks, m, ctx, imgs)).replace(/^<p>([\s\S]*?)<\/p>\n?$/, '$1')}</li>`))).join('')}</${tag}>\n`; break; }
      case 'code': out += `<pre><code>${escapeHtml(b.text)}</code></pre>\n`; break;
      case 'hr': out += '<hr>\n'; break; case 'pb': out += '<div class="pagebreak"></div>\n'; break;
      case 'math': out += `<div class="eq" id="${b.id || ''}"><span class="eqb">${mathML(b.latex, true)}</span>${b.n ? `<span class="eqn">(${b.n})</span>` : ''}</div>\n`; break;
      case 'fig': { const im = await imgs(b); out += `<figure id="${b.id || ''}" class="fig ${b.align}" style="--w:${b.width}%">${im ? `<img src="${im}" alt="${escapeHtml(b.alt || '')}">` : '<div class="noimg">[image unavailable]</div>'}<figcaption>${b.n ? `<strong>Figure ${b.n}.</strong> ` : ''}${runsHTML(b.caption, m, ctx)}${b.credit ? `<span class="credit"> ${escapeHtml(b.credit)}</span>` : ''}</figcaption></figure>\n`; break; }
      case 'table': { out += `<figure class="tbl" id="${b.id || ''}"><table><caption>${b.n ? `<strong>Table ${b.n}.</strong> ` : ''}${runsHTML(b.caption, m, ctx)}</caption>${b.rows.map((r) => `<tr>${r.map((c) => `<${c.header ? 'th scope="col"' : 'td'}${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}${c.align ? ` style="text-align:${c.align}"` : ''}>${c.blocks.map((x) => runsHTML(x.runs || [], m, ctx)).join('<br>')}</${c.header ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>${b.note.length ? `<div class="tnote">${runsHTML(b.note, m, ctx)}</div>` : ''}</figure>\n`; break; }
      default: break;
    }
  }
  return out;
}
export async function toHTML(m, o, { print = false } = {}) {
  const O = optsOf(o); const pg = PAGE[O.pageSize] || PAGE.letter; const imgs = async (fig) => { const im = await loadImage(fig); return im ? dataURL(im.blob) : null; };
  const ctx = { xrefs: true }; const body = await blocksHTML(m.body, m, ctx, imgs);
  const titleBlock = `<header class="${O.titlePage ? 'titlepage' : ''}"><h1>${escapeHtml(m.title)}</h1>${m.subtitle ? `<p class="subtitle">${escapeHtml(m.subtitle)}</p>` : ''}${m.author ? `<p class="author">${escapeHtml(m.author)}</p>` : ''}${O.titlePage ? [S.settings.institution, S.settings.course, S.settings.instructor, S.settings.date].filter(Boolean).map((x) => `<p class="aff">${escapeHtml(x)}</p>`).join('') : ''}</header>`;
  const abs = m.abstract.some((p) => p.length) ? `<section class="abstract"><h2>Abstract</h2>${m.abstract.map((p) => `<p>${runsHTML(p, m, ctx)}</p>`).join('')}</section>` : '';
  const notes = m.notes.length ? `<section class="notes"><h2>Notes</h2><ol>${m.notes.map((n) => `<li id="fn${n.n}" value="${n.n}">${runsHTML(n.runs, m, ctx)} <a class="back" href="#r${n.n}" aria-label="Back to text">↩</a></li>`).join('')}</ol></section>` : '';
  const bib = m.bib.length ? `<section class="bib"><h2>${m.bibTitle}</h2>${m.bib.map((b) => `<p class="bibentry${m.hangingIndent ? ' hang' : ''}">${b.label ? `<span class="bl">${escapeHtml(b.label)}</span> ` : ''}${runsHTML(b.runs, m, ctx)}</p>`).join('')}</section>` : '';
  const hdr = O.runningHeader === 'title' ? (m.title || '').slice(0, 50) : O.runningHeader === 'author' ? (m.author || '').split(' ').slice(-1)[0] : '';
  const css = `@page{size:${pg.w}in ${pg.h}in;margin:${O.margin}in;${print && O.pageNumbers ? `@bottom-center{content:counter(page);font:${Math.max(9, O.size - 2)}pt ${O.font},serif}` : ''}${print && hdr ? `@top-right{content:"${hdr.replace(/"/g, '')}";font:${Math.max(9, O.size - 2)}pt ${O.font},serif}` : ''}}
:root{--ink:#1a1a18}*{box-sizing:border-box}body{font:${O.size}pt/${O.line} "${O.font}",Georgia,"Times New Roman",serif;color:var(--ink);max-width:${print ? 'none' : (pg.w - 2 * O.margin) + 'in'};margin:${print ? 0 : '2rem auto'};padding:${print ? 0 : '0 1rem'};hyphens:manual}
p{margin:0 0 ${O.paraSpace}pt;text-indent:${O.indent}in;orphans:2;widows:2}h1,h2,h3,h4,h5,h6{line-height:1.25;break-after:avoid}header h1{text-align:center;font-size:${O.size + 2}pt;margin:0 0 .6em}header p{text-indent:0;text-align:center;margin:0}.titlepage{padding-top:2.5in;break-after:page}.subtitle{font-style:italic}
h2{font-size:${O.size + (O.headingStyle === 'apa' ? 0 : 1)}pt;${O.headingStyle === 'apa' ? 'text-align:center;' : ''}margin:1.2em 0 .4em}h3{font-size:${O.size}pt;margin:1em 0 .3em;${O.headingStyle === 'apa' ? 'font-style:italic;' : ''}}h4,h5,h6{font-size:${O.size}pt;margin:1em 0 .3em}
section.abstract h2,section.bib h2,section.notes h2{text-align:center}.abstract p{text-indent:0}blockquote{margin:0 0 ${O.paraSpace}pt ${0.5}in}blockquote p{text-indent:0}blockquote p:first-child{text-indent:0}
.bibentry{text-indent:0}.bibentry.hang{padding-left:.5in;text-indent:-.5in}.bl{display:inline-block;min-width:2.2em}.notes ol{padding-left:1.4em}.notes li{font-size:${O.size - 1}pt;line-height:1.3}.fnref a{text-decoration:none}
figure{margin:1em 0;break-inside:avoid}.fig img{width:var(--w);max-width:100%;height:auto;display:block}.fig.center img{margin:0 auto}.fig.right img{margin-left:auto}figcaption,caption{font-size:${O.size - 1}pt;line-height:1.3;text-align:left;margin:.4em 0}.credit{color:#555}
table{border-collapse:collapse;width:100%;font-size:${O.size - 1}pt;line-height:1.3}caption{caption-side:top}th,td{padding:.25em .5em;text-align:left;vertical-align:top}thead th,tr:first-child th{border-top:1px solid;border-bottom:1px solid}tr:last-child td{border-bottom:1px solid}.tnote{font-size:${O.size - 2}pt;margin-top:.3em}
.eq{display:flex;align-items:center;justify-content:center;position:relative;margin:.8em 0}.eqn{position:absolute;right:0}.pagebreak{break-after:page}pre{font:${O.size - 2}pt/1.4 ui-monospace,monospace;white-space:pre-wrap;break-inside:avoid}code{font-family:ui-monospace,monospace;font-size:.9em}a{color:inherit}ul.tasks{list-style:none;padding-left:1em}math{font-size:1.05em}`;
  return `<!doctype html>\n<html lang="${S.settings.language || 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(m.title || 'Paper')}</title><style>${css}</style></head><body>${titleBlock}${abs}<main>${body}</main>${notes}${bib}</body></html>`;
}

// ---- text, markdown ---------------------------------------------------------------
function runsMD(runs) {
  return runs.map((r) => { if (r.br) return '  \n'; if (r.math != null) return '$' + r.math + '$'; if (r.note) return `[^${r.note}]`; if (r.cite) return runsMD(r.runs); let t = (r.text || '').replace(/([*_`\[\]\\])/g, '\\$1'); if (r.code) t = '`' + (r.text || '') + '`'; if (r.i) t = '*' + t + '*'; if (r.b) t = '**' + t + '**'; if (r.s) t = '~~' + t + '~~'; if (r.sup) t = '^' + t + '^'; if (r.sub) t = '~' + t + '~'; if (r.link) t = `[${t}](${r.link})`; return t; }).join('');
}
async function blocksMD(blocks, ind, files) {
  let out = '';
  for (const b of blocks) {
    switch (b.t) {
      case 'p': out += ind + runsMD(b.runs) + '\n\n'; break;
      case 'h': out += '#'.repeat(Math.min(6, b.level + 1)) + ' ' + (b.num ? b.num + ' ' : '') + runsMD(b.runs) + '\n\n'; break;
      case 'quote': out += (await blocksMD(b.blocks, '', files)).trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n'; break;
      case 'list': { let i = b.start; for (const it of b.items) { const t = (await blocksMD(it.blocks, '', files)).trim().replace(/\n\n/g, '\n').split('\n'); out += `${ind}${b.task ? '- [' + (it.checked ? 'x' : ' ') + '] ' : b.ordered ? i++ + '. ' : '- '}${t[0]}\n${t.slice(1).map((l) => ind + '   ' + l).join('\n')}${t.length > 1 ? '\n' : ''}`; } out += '\n'; break; }
      case 'code': out += '```\n' + b.text + '\n```\n\n'; break; case 'hr': out += '---\n\n'; break; case 'pb': out += '\n---\n\n'; break;
      case 'math': out += `$$\n${b.latex}${b.n ? ` \\tag{${b.n}}` : ''}\n$$\n\n`; break;
      case 'fig': { const im = await loadImage(b); let path = ''; if (im) { path = `images/figure-${files.length + 1}.${im.ext}`; files.push({ path, data: im.data }); } out += `${im ? `![${(b.alt || '').replace(/[\[\]]/g, '')}](${path})\n\n` : ''}${b.n ? `**Figure ${b.n}.** ` : ''}${runsMD(b.caption)}${b.credit ? ' ' + b.credit : ''}\n\n`; break; }
      case 'table': { const rows = b.rows.map((r) => r.map((c) => c.blocks.map((x) => runsMD(x.runs || [])).join(' ').replace(/\|/g, '\\|'))); if (b.caption.length || b.n) out += `**${b.n ? 'Table ' + b.n + '.' : ''}** ${runsMD(b.caption)}\n\n`; if (rows.length) { out += '| ' + rows[0].join(' | ') + ' |\n| ' + rows[0].map((_, i) => ({ left: ':--', center: ':-:', right: '--:' }[b.rows[0][i]?.align] || '---')).join(' | ') + ' |\n' + rows.slice(1).map((r) => '| ' + r.join(' | ') + ' |').join('\n') + '\n\n'; } if (b.note.length) out += runsMD(b.note) + '\n\n'; break; }
      default: break;
    }
  }
  return out;
}
export async function toMarkdown(m) {
  const files = []; const meta = `---\ntitle: "${m.title.replace(/"/g, '\\"')}"\n${m.subtitle ? `subtitle: "${m.subtitle.replace(/"/g, '\\"')}"\n` : ''}author: "${(m.author || '').replace(/"/g, '\\"')}"\n---\n\n`;
  let md = meta + `# ${m.title}\n\n` + (m.subtitle ? `*${m.subtitle}*\n\n` : '') + (m.author ? `${m.author}\n\n` : '');
  if (m.abstract.some((p) => p.length)) md += '## Abstract\n\n' + m.abstract.map((p) => runsMD(p)).join('\n\n') + '\n\n';
  md += await blocksMD(m.body, '', files);
  if (m.notes.length) md += m.notes.map((n) => `[^${n.n}]: ${runsMD(n.runs)}`).join('\n') + '\n\n';
  if (m.bib.length) md += `## ${m.bibTitle}\n\n` + m.bib.map((b) => (b.label ? b.label + ' ' : '') + runsMD(b.runs)).join('\n\n') + '\n';
  return { md, files };
}
async function blocksText(blocks, ind) {
  let out = '';
  for (const b of blocks) {
    switch (b.t) {
      case 'p': out += ind + plain(b.runs) + '\n\n'; break; case 'h': out += (b.num ? b.num + ' ' : '') + plain(b.runs).toUpperCase().slice(0, 0) + (b.num ? b.num + ' ' : '') + plain(b.runs) + '\n\n'; break;
      case 'quote': out += (await blocksText(b.blocks, '    ')); break;
      case 'list': { let i = b.start; for (const it of b.items) out += `${ind}${b.task ? (it.checked ? '[x] ' : '[ ] ') : b.ordered ? i++ + '. ' : '• '}${(await blocksText(it.blocks, '')).trim()}\n`; out += '\n'; break; }
      case 'code': out += b.text + '\n\n'; break; case 'hr': out += '* * *\n\n'; break; case 'pb': out += '\n\f\n'; break; case 'math': out += `    ${b.latex}${b.n ? '    (' + b.n + ')' : ''}\n\n`; break;
      case 'fig': out += `[Figure${b.n ? ' ' + b.n : ''}: ${plain(b.caption)}${b.alt ? ' — ' + b.alt : ''}]\n\n`; break;
      case 'table': out += `${b.n ? 'Table ' + b.n + '. ' : ''}${plain(b.caption)}\n` + b.rows.map((r) => r.map((c) => c.blocks.map((x) => plain(x.runs || [])).join(' ')).join('\t')).join('\n') + '\n' + (b.note.length ? plain(b.note) + '\n' : '') + '\n'; break;
      default: break;
    }
  }
  return out;
}
export async function toText(m) {
  let t = `${m.title}\n${m.subtitle ? m.subtitle + '\n' : ''}${m.author || ''}\n\n`; if (m.abstract.some((p) => p.length)) t += 'Abstract\n' + m.abstract.map(plain).join('\n\n') + '\n\n'; t += await blocksText(m.body, '');
  if (m.notes.length) t += 'Notes\n' + m.notes.map((n) => `${n.n}. ${plain(n.runs)}`).join('\n') + '\n\n'; if (m.bib.length) t += m.bibTitle + '\n' + m.bib.map((b) => (b.label ? b.label + ' ' : '') + plain(b.runs)).join('\n\n') + '\n'; return t;
}

// ---- LaTeX ----------------------------------------------------------------------
const TEXMAP = { '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
const tex = (s) => s.replace(/[\\&%$#_{}~^]/g, (c) => TEXMAP[c]);
const BIBSTYLE = { apa: 'apa', mla: 'mla', 'chicago-nb': 'chicago-notes', 'chicago-ad': 'chicago-authordate', harvard: 'authoryear', ieee: 'ieee' };
const LOC = { page: 'p.~', chapter: 'ch.~', section: '\\S~', paragraph: '\\P~', figure: 'fig.~', table: 'tbl.~', line: 'l.~', verse: 'v.~', volume: 'vol.~', note: 'n.~' };
function citeTeX(c, keys) {
  const its = c.items.filter((i) => keys.has(i.sourceId)); if (!its.length) return '';
  const cmd = c.mode === 'narrative' ? '\\textcite' : c.mode === 'note' ? '\\footcite' : '\\parencite'; const star = its.every((i) => i.suppressAuthor) && c.mode !== 'narrative' ? '*' : '';
  const post = (i) => (i.locator ? `[${i.prefix ? tex(i.prefix) + ' ' : ''}]` + `[${(LOC[i.label || 'page'] || '') + tex(i.locator)}${i.suffix ? ', ' + tex(i.suffix) : ''}]` : i.prefix || i.suffix ? `[${tex(i.prefix || '')}][${tex(i.suffix || '')}]` : '');
  if (its.length === 1) return `${cmd}${star}${post(its[0]).replace(/^\[\]\[/, '[').replace(/^\[([^\]]*)\]$/, '[$1]')}{${keys.get(its[0].sourceId)}}`;
  return `${cmd}s` + its.map((i) => `${post(i)}{${keys.get(i.sourceId)}}`).join('');
}
function runsTeX(runs, keys, labelOf) {
  return runs.map((r) => {
    if (r.br) return '\\\\ '; if (r.math != null) return '$' + r.math + '$'; if (r.note != null) return r.fnTex || '';
    if (r.cite) return citeTeX(r.cite, keys) || tex(plain(r.runs)); if (r.xref) { const pre = r.xkind === 'figure' ? 'Figure~' : r.xkind === 'table' ? 'Table~' : r.xkind === 'equation' ? 'Equation~' : r.xkind === 'section' ? 'Section~' : ''; return `${r.xform === 'number' ? '' : pre}${r.xkind === 'equation' ? '\\eqref{eq:' + r.xref + '}' : '\\ref{' + (r.xkind === 'figure' ? 'fig' : r.xkind === 'table' ? 'tbl' : 'sec') + ':' + r.xref + '}'}`; }
    let t = tex(r.text || ''); if (r.code) t = `\\texttt{${t}}`; if (r.i) t = `\\emph{${t}}`; if (r.b) t = `\\textbf{${t}}`; if (r.u) t = `\\uline{${t}}`; if (r.s) t = `\\sout{${t}}`; if (r.sup) t = `\\textsuperscript{${t}}`; if (r.sub) t = `\\textsubscript{${t}}`; if (r.link) t = `\\href{${r.link.replace(/([%#])/g, '\\$1')}}{${t}}`; return t;
  }).join('');
}
export async function toLaTeX(m) {
  const files = []; const used = [...S.sources.values()].filter((s) => m.derived.used.includes(s.id)); const keys = bibKeys(used);
  const noteTex = new Map(); m.notes.forEach((n) => { if (n.fn) noteTex.set(n.n, `\\footnote{${runsTeX(n.runs.map((r) => r), keys)}}`); else if (n.cite) noteTex.set(n.n, citeTeX({ ...n.cite, mode: 'note' }, keys) || ''); });
  const fixNotes = (runs) => runs.map((r) => (r.note != null ? { ...r, fnTex: noteTex.get(r.note) } : r));
  const R = (runs) => runsTeX(fixNotes(runs), keys);
  const numFn = new Set(); // footnote bodies contain cites rendered as text (already formatted) -> keep as text
  async function blocks(bl, ind = '') {
    let o = '';
    for (const b of bl) {
      switch (b.t) {
        case 'p': o += R(b.runs) + '\n\n'; break;
        case 'h': o += `\\${['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph'][Math.min(5, b.level - 1)]}{${R(b.runs)}}${b.id ? `\\label{sec:${b.id}}` : ''}\n\n`; break;
        case 'quote': o += '\\begin{quote}\n' + await blocks(b.blocks) + '\\end{quote}\n\n'; break;
        case 'list': { const env = b.ordered ? 'enumerate' : 'itemize'; o += `\\begin{${env}}\n`; for (const it of b.items) o += `  \\item ${b.task ? (it.checked ? '$\\boxtimes$ ' : '$\\square$ ') : ''}${(await blocks(it.blocks)).trim()}\n`; o += `\\end{${env}}\n\n`; break; }
        case 'code': o += '\\begin{verbatim}\n' + b.text + '\n\\end{verbatim}\n\n'; break; case 'hr': o += '\\noindent\\rule{\\linewidth}{0.4pt}\n\n'; break; case 'pb': o += '\\newpage\n\n'; break;
        case 'math': o += b.n ? `\\begin{equation}\\label{eq:${b.id}}\n${b.latex}\n\\end{equation}\n\n` : `\\[\n${b.latex}\n\\]\n\n`; break;
        case 'fig': { const im = await loadImage(b); let inc = '\\fbox{image unavailable}'; if (im) { const p = `figures/figure-${files.length + 1}.${im.ext}`; files.push({ path: p, data: im.data }); inc = `\\includegraphics[width=${(b.width / 100).toFixed(2)}\\linewidth]{${p}}`; } o += `\\begin{figure}[htbp]\n\\centering\n${inc}\n\\caption{${R(b.caption)}${b.credit ? ' ' + tex(b.credit) : ''}}${b.id ? `\\label{fig:${b.id}}` : ''}\n\\end{figure}\n\n`; break; }
        case 'table': { const cols = Math.max(...b.rows.map((r) => r.length)); const al = (b.rows[0] || []).map((c) => ({ right: 'r', center: 'c' }[c.align] || 'l')).join('') || 'l'.repeat(cols); o += `\\begin{table}[htbp]\n\\caption{${R(b.caption)}}${b.id ? `\\label{tbl:${b.id}}` : ''}\n\\centering\n\\begin{tabular}{${al}}\n\\toprule\n`; b.rows.forEach((r, i) => { o += r.map((c) => c.blocks.map((x) => R(x.runs || [])).join(' ')).join(' & ') + ' \\\\\n'; if (i === 0 && r.every((c) => c.header)) o += '\\midrule\n'; }); o += `\\bottomrule\n\\end{tabular}\n${b.note.length ? `\\par\\smallskip{\\footnotesize ${R(b.note)}}\n` : ''}\\end{table}\n\n`; break; }
        default: break;
      }
    }
    return o;
  }
  const O = optsOf(); const style = BIBSTYLE[m.styleId] || 'authoryear';
  const body = await blocks(m.body);
  const pre = `% Generated by the paper workbench. Compile with: pdflatex, biber, pdflatex (needs biblatex with the "${style}" style).\n\\documentclass[${Math.round(O.size)}pt,${O.pageSize === 'a4' ? 'a4paper' : 'letterpaper'}]{article}\n\\usepackage[utf8]{inputenc}\\usepackage[T1]{fontenc}\\usepackage{amsmath,amssymb}\\usepackage{graphicx}\\usepackage{booktabs}\\usepackage[normalem]{ulem}\\usepackage{csquotes}\\usepackage{setspace}\\usepackage[margin=${O.margin}in]{geometry}\\usepackage[hidelinks]{hyperref}\n\\usepackage[backend=biber,style=${style}]{biblatex}\n\\addbibresource{references.bib}\n${O.line >= 1.9 ? '\\doublespacing' : O.line >= 1.4 ? '\\onehalfspacing' : ''}\n\\title{${tex(m.title)}${m.subtitle ? '\\\\ \\large ' + tex(m.subtitle) : ''}}\n\\author{${tex(m.author || '')}}\n\\date{${tex(S.settings.date || '')}}\n\\begin{document}\n\\maketitle\n`;
  const abs = m.abstract.some((p) => p.length) ? `\\begin{abstract}\n${m.abstract.map((p) => R(p)).join('\n\n')}\n\\end{abstract}\n\n` : '';
  const tail = `${m.derived.used.length ? '\\printbibliography\n' : ''}\\end{document}\n`;
  const bibRaw = exportBibliography('bibtex').data;
  return { tex: pre + abs + body + tail, bib: bibRaw, files };
}

// ---- DOCX -----------------------------------------------------------------------
const twip = (inch) => Math.round(inch * 1440);
export async function toDOCX(m, o) {
  const O = optsOf(o); const pg = PAGE[O.pageSize] || PAGE.letter; const contentW = pg.w - 2 * O.margin; const font = O.font || 'Times New Roman'; const sz = Math.round(O.size * 2);
  const spacing = { line: Math.round(O.line * 240), lineRule: LineRuleType.AUTO, after: Math.round(O.paraSpace * 20) }; const footnotes = {}; const endnotes = m.noteMode === 'endnote'; const numberings = [{ reference: 'bul', levels: [0, 1, 2, 3].map((l) => ({ level: l, format: LevelFormat.BULLET, text: ['•', '◦', '▪', '•'][l], alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: twip(0.5 * (l + 1)), hanging: twip(0.25) } } } })) }];
  let numCount = 0;
  const OMML = (latex, display) => { try { const comp = ImportedXmlComponent.fromXmlString(latexToOMML(latex, display).replace(/^<m:(oMath|oMathPara)/, '<m:$1 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"')); return comp.root.find((c) => typeof c !== 'string' && c.rootKey) || comp; } catch (e) { console.warn('math', e); return new TextRun({ text: latex, font: 'Consolas', size: sz - 2 }); } };
  const runFmt = (r) => ({ bold: !!r.b, italics: !!r.i, underline: r.u ? {} : undefined, strike: !!r.s, superScript: !!r.sup, subScript: !!r.sub, font: r.code ? { name: 'Consolas' } : undefined, size: sz });
  const mkRuns = (runs, base = {}) => {
    const out = [];
    runs.forEach((r) => {
      if (r.br) { out.push(new TextRun({ break: 1 })); return; } if (r.math != null) { out.push(OMML(r.math, false)); return; }
      if (r.note != null) { out.push(endnotes ? new TextRun({ text: String(r.note), superScript: true, size: sz }) : new FootnoteReferenceRun(r.note)); return; }
      if (r.cite) { out.push(...mkRuns(r.runs, base)); return; }
      const tr = new TextRun({ text: r.text || '', ...runFmt({ ...base, ...r }), color: r.link ? '1F4E8C' : undefined });
      out.push(r.link ? new ExternalHyperlink({ children: [tr], link: r.link }) : tr);
    });
    return out;
  };
  m.notes.forEach((n) => { footnotes[n.n] = { children: [new Paragraph({ children: mkRuns(n.runs).map((c) => c), spacing: { line: 240, after: 40 } })] }; });
  const para = (runs, opt = {}) => new Paragraph({ children: mkRuns(runs, opt.base), spacing: { ...spacing, ...(opt.spacing || {}) }, indent: opt.indent, alignment: opt.align, keepNext: opt.keepNext, pageBreakBefore: opt.pageBreakBefore });
  const headStyle = (lvl, runs) => {
    const hs = O.headingStyle; const base = { bold: true };
    const cfg = hs === 'apa' ? [{ align: AlignmentType.CENTER }, { align: AlignmentType.LEFT }, { align: AlignmentType.LEFT, italics: true }, { align: AlignmentType.LEFT, indent: twip(0.5) }][Math.min(3, lvl - 1)] : hs === 'chicago' ? [{ align: AlignmentType.CENTER }, { align: AlignmentType.LEFT }, { align: AlignmentType.LEFT, italics: true }][Math.min(2, lvl - 1)] : { align: AlignmentType.LEFT, ...(lvl === 3 ? { italics: true } : {}) };
    return new Paragraph({ children: mkRuns(runs, { b: 1, i: cfg.italics ? 1 : 0 }), heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.min(5, lvl - 1)], alignment: cfg.align, indent: cfg.indent ? { left: cfg.indent } : undefined, keepNext: true, spacing: { ...spacing, before: lvl === 1 ? 120 : 60, after: spacing.after || 60 } });
  };
  const caption = (label, runs, credit) => new Paragraph({ children: [new TextRun({ text: label ? label + ' ' : '', bold: true, size: sz }), ...mkRuns(runs, {}), ...(credit ? [new TextRun({ text: ' ' + credit, size: sz })] : [])], spacing: { line: 240, after: 120, before: 60 }, keepNext: false });
  async function blocks(bl, ctx = {}) {
    const out = [];
    for (const b of bl) {
      switch (b.t) {
        case 'p': out.push(para(b.runs, { indent: ctx.noIndent ? undefined : { firstLine: twip(O.indent) }, align: b.align === 'center' ? AlignmentType.CENTER : b.align === 'right' ? AlignmentType.RIGHT : b.align === 'justify' ? AlignmentType.JUSTIFIED : undefined, ...(ctx.quote ? { indent: { left: twip(0.5) } } : {}) })); break;
        case 'h': out.push(headStyle(b.level, [...(b.num ? [{ text: b.num + ' ' }] : []), ...b.runs])); break;
        case 'quote': out.push(...await blocks(b.blocks, { quote: true, noIndent: true })); break;
        case 'list': { let ref = 'bul'; if (b.ordered) { ref = 'num' + ++numCount; numberings.push({ reference: ref, levels: [0, 1, 2, 3].map((l) => ({ level: l, format: l % 2 ? LevelFormat.LOWER_LETTER : LevelFormat.DECIMAL, text: `%${l + 1}.`, start: l === 0 ? b.start : 1, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: twip(0.5 * (l + 1)), hanging: twip(0.3) } } } })) }); }
          const walk = async (list, level) => { for (const it of list.items) { const first = it.blocks[0]; const prefix = list.task ? [{ text: it.checked ? '☑ ' : '☐ ' }] : []; if (first?.t === 'p') out.push(new Paragraph({ children: mkRuns([...prefix, ...first.runs]), numbering: { reference: list === b ? ref : 'bul', level }, spacing: { ...spacing, after: Math.min(spacing.after, 60) } })); for (const sub of it.blocks.slice(1)) { if (sub.t === 'list') { const r2 = sub.ordered ? (() => { const rr = 'num' + ++numCount; numberings.push({ reference: rr, levels: [0, 1, 2, 3].map((l) => ({ level: l, format: l % 2 ? LevelFormat.LOWER_LETTER : LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: twip(0.5 * (l + 1)), hanging: twip(0.3) } } } })) }); return rr; })() : 'bul'; for (const it2 of sub.items) { const f2 = it2.blocks[0]; out.push(new Paragraph({ children: mkRuns(f2?.runs || []), numbering: { reference: r2, level: Math.min(3, level + 1) }, spacing: { ...spacing, after: 60 } })); } } else out.push(...await blocks([sub], { noIndent: true })); } } };
          await walk(b, 0); break; }
        case 'code': b.text.split('\n').forEach((l) => out.push(new Paragraph({ children: [new TextRun({ text: l, font: 'Consolas', size: sz - 2 })], spacing: { line: 240, after: 0 }, indent: { left: twip(0.3) } }))); break;
        case 'hr': out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '888888', space: 1 } }, spacing: { after: 120 } })); break;
        case 'pb': out.push(new Paragraph({ children: [new PageBreak()] })); break;
        case 'math': { const W = twip(contentW); out.push(new Paragraph({ children: b.n ? [new TextRun({ children: ['\t'] }), OMML(b.latex, false), new TextRun({ children: ['\t'], size: sz }), new TextRun({ text: `(${b.n})`, size: sz })] : [OMML(b.latex, true)], tabStops: b.n ? [{ type: TabStopType.CENTER, position: Math.round(W / 2) }, { type: TabStopType.RIGHT, position: W }] : undefined, alignment: b.n ? undefined : AlignmentType.CENTER, spacing: { before: 120, after: 120, line: 276 } })); break; }
        case 'fig': {
          const im = await loadImage(b); const lab = b.n ? `Figure ${b.n}.` : '';
          if (im) { const wpx = Math.round(contentW * 96 * (b.width / 100)); const hpx = Math.round(wpx * im.h / im.w); out.push(new Paragraph({ children: [new ImageRun({ type: im.ext === 'jpg' ? 'jpg' : im.ext === 'gif' ? 'gif' : 'png', data: im.data, transformation: { width: wpx, height: hpx }, altText: { title: 'Figure', description: b.alt || '', name: 'figure' } })], alignment: b.align === 'left' ? AlignmentType.LEFT : b.align === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 } })); }
          out.push(caption(lab, b.caption, b.credit)); break; }
        case 'table': {
          const rule = { style: BorderStyle.SINGLE, size: 6, color: '000000' }, none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
          if (b.n || b.caption.length) out.push(new Paragraph({ children: [new TextRun({ text: b.n ? `Table ${b.n}. ` : '', bold: true, size: sz }), ...mkRuns(b.caption)], keepNext: true, spacing: { line: 240, before: 120, after: 80 } }));
          const rows = b.rows.map((r, ri) => new TableRow({ tableHeader: r.every((c) => c.header), cantSplit: true, children: r.map((c) => new TableCell({ columnSpan: c.colspan > 1 ? c.colspan : undefined, rowSpan: c.rowspan > 1 ? c.rowspan : undefined, verticalAlign: VerticalAlign.TOP, margins: { top: 40, bottom: 40, left: 80, right: 80 }, borders: { top: ri === 0 ? rule : none, bottom: ri === 0 && r.every((x) => x.header) || ri === b.rows.length - 1 ? rule : none, left: none, right: none }, children: c.blocks.map((x) => new Paragraph({ children: mkRuns(x.runs || [], c.header ? { b: 1 } : {}), alignment: c.align === 'center' ? AlignmentType.CENTER : c.align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { line: 240, after: 0 } })) })) }));
          out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })); if (b.note.length) out.push(new Paragraph({ children: mkRuns(b.note, {}), spacing: { line: 240, before: 60, after: 160 } })); else out.push(new Paragraph({ spacing: { after: 120 } })); break; }
        default: break;
      }
    }
    return out;
  }
  const children = [];
  const tp = O.titlePage; const boldC = (t, extra = {}) => new Paragraph({ children: [new TextRun({ text: t, bold: true, size: sz + (tp ? 4 : 0) })], alignment: AlignmentType.CENTER, spacing: { before: extra.before || 0, after: 120, line: 276 } });
  if (tp) { children.push(new Paragraph({ spacing: { before: twip(2.2) } }), boldC(m.title)); if (m.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: m.subtitle, italics: true, size: sz })], alignment: AlignmentType.CENTER, spacing: { after: 240 } })); [m.author, S.settings.institution, S.settings.course, S.settings.instructor, S.settings.date].filter(Boolean).forEach((t) => children.push(new Paragraph({ children: [new TextRun({ text: t, size: sz })], alignment: AlignmentType.CENTER, spacing: { after: 60, line: 276 } }))); children.push(new Paragraph({ children: [new PageBreak()] })); }
  else { if (O.headingStyle === 'mla') { [m.author, S.settings.instructor, S.settings.course, S.settings.date].filter(Boolean).forEach((t) => children.push(new Paragraph({ children: [new TextRun({ text: t, size: sz })], spacing: { ...spacing, after: 0 } }))); } children.push(boldC(m.title, { before: 120 })); if (m.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: m.subtitle, italics: true, size: sz })], alignment: AlignmentType.CENTER, spacing: { after: 120 } })); if (O.headingStyle !== 'mla' && m.author) children.push(new Paragraph({ children: [new TextRun({ text: m.author, size: sz })], alignment: AlignmentType.CENTER, spacing: { after: 240 } })); }
  if (m.abstract.some((p) => p.length)) { children.push(new Paragraph({ children: [new TextRun({ text: 'Abstract', bold: true, size: sz })], alignment: AlignmentType.CENTER, spacing: { ...spacing, before: 120 }, keepNext: true })); m.abstract.forEach((p) => children.push(para(p, { indent: undefined }))); children.push(new Paragraph({ children: [new PageBreak()] })); }
  children.push(...await blocks(m.body));
  if (endnotes && m.notes.length) { children.push(new Paragraph({ children: [new PageBreak()] }), new Paragraph({ children: [new TextRun({ text: 'Notes', bold: true, size: sz })], alignment: AlignmentType.CENTER, spacing: { after: 120 } })); m.notes.forEach((n) => children.push(new Paragraph({ children: [new TextRun({ text: n.n + '. ', size: sz }), ...mkRuns(n.runs)], spacing: { line: 240, after: 80 }, indent: { left: twip(0.3), hanging: twip(0.3) } }))); }
  if (m.bib.length) { children.push(new Paragraph({ children: [new PageBreak()] }), new Paragraph({ children: [new TextRun({ text: m.bibTitle, bold: true, size: sz })], alignment: AlignmentType.CENTER, spacing: { ...spacing, after: 120 }, heading: HeadingLevel.HEADING_1 })); m.bib.forEach((b) => children.push(new Paragraph({ children: [...(b.label ? [new TextRun({ text: b.label + '\t', size: sz })] : []), ...mkRuns(b.runs)], spacing: { ...spacing, after: Math.max(spacing.after, 0) }, indent: b.label ? { left: twip(0.5), hanging: twip(0.5) } : m.hangingIndent ? { left: twip(0.5), hanging: twip(0.5) } : undefined }))); }
  const hdrText = O.runningHeader === 'title' ? (m.title || '').toUpperCase().slice(0, 50) : O.runningHeader === 'author' ? ((m.author || '').split(' ').slice(-1)[0] || '') : '';
  const pn = () => new TextRun({ children: [PageNumber.CURRENT], size: sz });
  const headerChildren = O.pageNumbers || hdrText ? [new Paragraph({ children: [...(hdrText ? [new TextRun({ text: hdrText + (O.pageNumbers ? '  ' : ''), size: sz })] : []), ...(O.pageNumbers ? [pn()] : [])], alignment: hdrText && O.headingStyle !== 'mla' && O.runningHeader === 'title' ? AlignmentType.LEFT : AlignmentType.RIGHT, tabStops: hdrText && O.runningHeader === 'title' ? [{ type: TabStopType.RIGHT, position: twip(contentW) }] : undefined })] : [];
  if (hdrText && O.runningHeader === 'title' && O.pageNumbers) headerChildren[0] = new Paragraph({ children: [new TextRun({ text: hdrText, size: sz }), new TextRun({ children: ['\t'] }), pn()], tabStops: [{ type: TabStopType.RIGHT, position: twip(contentW) }] });
  const doc = new Document({ creator: m.author || 'Author', title: m.title || 'Paper', styles: { default: { document: { run: { font, size: sz }, paragraph: { spacing } } }, paragraphStyles: [1, 2, 3, 4, 5, 6].map((l) => ({ id: 'Heading' + l, name: 'Heading ' + l, basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font, size: sz, bold: true, color: '000000' }, paragraph: { spacing: { before: 240, after: 60 }, outlineLevel: l - 1 } })) }, numbering: { config: numberings }, footnotes: endnotes ? {} : footnotes, sections: [{ properties: { page: { size: { width: twip(pg.w), height: twip(pg.h) }, margin: { top: twip(O.margin), bottom: twip(O.margin), left: twip(O.margin), right: twip(O.margin) } } }, headers: { default: new Header({ children: headerChildren.length ? headerChildren : [new Paragraph({})] }) }, children }] });
  return Packer.toBlob(doc);
}

// ---- public API -----------------------------------------------------------------
export async function exportAs(format, opts = {}) {
  const base = safeName(S.settings.title || S.project.name);
  if (['bibtex', 'ris', 'csljson'].includes(format)) { const r = exportBibliography(format, opts); download(r.name, r.data, r.type); return r.name; }
  const m = await buildModel();
  if (format === 'docx') { const blob = await toDOCX(m, opts); download(base + '.docx', blob); return base + '.docx'; }
  if (format === 'html') { download(base + '.html', await toHTML(m, opts), 'text/html'); return base + '.html'; }
  if (format === 'txt') { download(base + '.txt', await toText(m), 'text/plain'); return base + '.txt'; }
  if (format === 'md') { const r = await toMarkdown(m); if (!r.files.length) { download(base + '.md', r.md, 'text/markdown'); return base + '.md'; } const z = new JSZip(); z.file('paper.md', r.md); r.files.forEach((f) => z.file(f.path, f.data)); download(base + '-markdown.zip', await z.generateAsync({ type: 'blob' })); return base + '-markdown.zip'; }
  if (format === 'latex') { const r = await toLaTeX(m); const z = new JSZip(); z.file('paper.tex', r.tex); z.file('references.bib', r.bib); r.files.forEach((f) => z.file(f.path, f.data)); download(base + '-latex.zip', await z.generateAsync({ type: 'blob' })); return base + '-latex.zip'; }
  if (format === 'pdf') { await printPDF(m, opts); return 'print'; }
  throw new Error('Unknown format ' + format);
}
export async function printPDF(m, opts) {
  const html = await toHTML(m, opts, { print: true }); const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'; document.body.append(f);
  await new Promise((res) => { f.onload = res; f.srcdoc = html; }); await new Promise((r) => setTimeout(r, 400));
  try { f.contentWindow.focus(); f.contentWindow.print(); } catch { const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' }))); if (!w) throw new Error('Your browser blocked the print window'); }
  setTimeout(() => f.remove(), 60000);
}
