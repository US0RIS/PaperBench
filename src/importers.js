import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-ris';
import { DOMParser as PMDOM } from 'prosemirror-model';
import { S, addSource, takeSnapshot, flushDoc } from './state.js';
import * as DB from './db.js';
import { schema } from './schema.js';
import { cslJsonCand, candidateToSource, sanitizeHTML } from './research.js';
import { toast, confirmDialog, download, bus } from './ui.js';
import { uid } from './model.js';

export async function importBibliography(file) {
  const text = await file.text(); let data;
  if (/\.json$/i.test(file.name)) data = JSON.parse(text); else data = new Cite(text).data;
  let added = 0, dup = 0;
  for (const j of data) { const c = cslJsonCand({ ...j, id: undefined }, 'import'); if (!c.src.title) continue; const r = addSource(candidateToSource(c), { quiet: true }); r.duplicate ? dup++ : added++; }
  toast(`Imported ${added} source${added === 1 ? '' : 's'}${dup ? `, skipped ${dup} duplicate${dup === 1 ? '' : 's'}` : ''}`);
}
export async function htmlToDraft(html, name) {
  const E = S.editor; const dom = new window.DOMParser().parseFromString(`<div>${sanitizeHTML(html, location.href)}</div>`, 'text/html').body.firstChild;
  dom.querySelectorAll('h1').forEach((h1) => { const h2 = document.createElement('h1'); h2.innerHTML = h1.innerHTML; h1.replaceWith(h2); });
  const slice = PMDOM.fromSchema(schema).parseSlice(dom); const nodes = []; slice.content.forEach((n) => { if (['paragraph', 'heading', 'bullet_list', 'ordered_list', 'blockquote', 'code_block', 'horizontal_rule'].includes(n.type.name)) nodes.push(n); });
  if (!nodes.length) throw new Error('No importable content found');
  const replace = await confirmDialog('Import into the paper', `Replace the body of the current paper with ${nodes.length} imported blocks from ${name}? A snapshot of the current draft is saved first so you can restore it. Choose Cancel to append instead.`, { ok: 'Replace body' });
  takeSnapshot('Before import of ' + name);
  const doc = E.view.state.doc; let start = 0; for (let i = 0; i < 4; i++) start += doc.child(i).nodeSize;
  const tr = E.view.state.tr; if (replace) tr.replaceWith(start, doc.content.size, nodes); else tr.insert(doc.content.size, nodes);
  E.view.dispatch(tr.setMeta('ids', true).setMeta('noSuggest', true)); toast('Imported ' + name);
}
export async function importDocx(file) { const mammoth = await import('mammoth'); const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }); await htmlToDraft(r.value, file.name); }
export async function importMarkdown(file) { const { marked } = await import('marked'); await htmlToDraft(marked.parse(await file.text()), file.name); }

// whole-project bundle
const b64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
export async function exportProject(id = S.id) {
  if (id === S.id) await flushDoc(); const P = await DB.loadProject(id); const blobs = []; for (const b of await DB.allBlobs(id)) blobs.push({ key: b.key.split(':')[1], name: b.name, data: await b64(b.blob) });
  const items = {}; for (const k of DB.KINDS) items[k] = [...P[k + 's'].values()]; const texts = {}; (await DB.allTexts(id)).forEach((t) => { texts[t.key.split(':')[1]] = t.pages; });
  const doc = (id === S.id ? S.editor.getJSON() : P.docJSON); const nb = await DB.getNotebook(id); const wl = await DB.kvGet('wordlog:' + id);
  const out = { format: 'paper-workbench/1', project: P.project, doc, notebook: nb?.json || null, wordlog: wl || {}, items, texts, blobs };
  download((P.project.settings.title || P.project.name || 'paper').replace(/[^\w]+/g, '-') + '.paper.json', JSON.stringify(out), 'application/json');
}
export async function importProject(file) {
  const j = JSON.parse(await file.text()); if (j.format !== 'paper-workbench/1') throw new Error('Not a paper workbench project file');
  const id = uid('prj'); const project = { ...j.project, id, name: j.project.name + ' (imported)' }; await DB.saveProject(project); await DB.saveDoc(id, j.doc); if (j.notebook) await DB.saveNotebook(id, j.notebook); if (j.wordlog) await DB.kvSet('wordlog:' + id, j.wordlog);
  for (const [k, arr] of Object.entries(j.items)) for (const it of arr) await DB.saveItem(id, k, it);
  for (const [sid, pages] of Object.entries(j.texts || {})) await DB.saveText(id, sid, pages);
  for (const b of j.blobs || []) await DB.saveBlob(id, b.key, await (await fetch(b.data)).blob(), b.name);
  return id;
}
