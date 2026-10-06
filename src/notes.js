// Research notes (quotation / paraphrase / idea / question), insertion into the draft, paste-provenance handling.
import { S, putItem, removeItem, pushRecent } from './state.js';
import { h, icon, clear, dialog, menu, popover, toast, bus, segmented, field, confirmDialog, $, ago } from './ui.js';
import { NOTE_KINDS, uid, now, shortCite, escapeHtml } from './model.js';
import { schema } from './schema.js';
import { insertBlock, inFront } from './commands.js';

const T = schema.nodes, M = schema.marks;
export const noteState = { kind: 'all', q: '' };
const KIND_ICON = { quotation: 'quote', paraphrase: 'pencil', idea: 'idea', question: 'question' };
const KIND_HINT = { quotation: 'Exact words from a source', paraphrase: 'Your restatement of a source', idea: 'Your own thought', question: 'Something to investigate' };

export function renderNotes(root) {
  clear(root);
  const list = h('div.note-list');
  const kinds = [['all', 'All'], ...Object.entries(NOTE_KINDS)];
  const q = h('input.input.search', { type: 'search', placeholder: 'Filter notes', 'aria-label': 'Filter notes', value: noteState.q, oninput: (e) => { noteState.q = e.target.value; draw(); } });
  const newBtn = h('button.icon-btn', { 'aria-label': 'New note', title: 'New note', onclick: () => menu(newBtn, Object.entries(NOTE_KINDS).map(([k, l]) => ({ label: l, icon: KIND_ICON[k], sub: KIND_HINT[k], action: () => noteDialog({ kind: k }) })) ) }, icon('plus'));
  root.append(h('div.side-tools', q, h('div.row', segmented(kinds, noteState.kind, (v) => { noteState.kind = v; draw(); }, 'Note type'), h('span.grow'), newBtn)), list);
  function draw() {
    clear(list); const words = noteState.q.toLowerCase().split(/\s+/).filter(Boolean);
    const arr = [...S.notes.values()].filter((n) => (noteState.kind === 'all' || n.kind === noteState.kind) && words.every((w) => `${n.text} ${(n.tags || []).join(' ')} ${S.sources.get(n.sourceId)?.title || ''}`.toLowerCase().includes(w))).sort((a, b) => b.updated - a.updated);
    if (!arr.length) list.append(h('div.empty-s', S.notes.size ? 'No notes match.' : h('span', 'No notes yet.', h('br'), 'Select text in a source or in the paper and choose “Create note”, or press + above.')));
    arr.forEach((n) => list.append(noteCard(n)));
  }
  draw();
}
export function noteCard(n, { compact = false } = {}) {
  const s = S.sources.get(n.sourceId); const sec = n.attach?.type === 'section' ? S.editor?.analysis().headings.find((x) => x.id === n.attach.refId) : null;
  const meta = [s && shortCite(s), n.page && 'p. ' + n.page, n.para && !n.page && '¶ ' + n.para, sec && '§ ' + (sec.text || 'section'), n.attach?.type === 'block' && 'attached to a paragraph'].filter(Boolean).join(' · ');
  const card = h('div.note.k-' + n.kind, { draggable: 'true', tabindex: '0', 'data-id': n.id, ondragstart: (e) => { e.dataTransfer.setData('application/x-note', n.id); e.dataTransfer.setData('text/plain', n.text); }, onkeydown: (e) => { if (e.key === 'Enter') noteDialog(n); } },
    h('div.note-k', icon(KIND_ICON[n.kind], 13), NOTE_KINDS[n.kind]), h('div.note-t' + (n.kind === 'quotation' ? '.q' : ''), n.kind === 'quotation' ? '“' + n.text + '”' : n.text || h('span.muted', 'Empty')), meta && h('div.note-m', meta), (n.tags || []).length > 0 && h('div.note-tags', n.tags.map((t) => h('span.tag.sm', t))),
    !compact && h('div.note-a', h('button.link-btn', { onclick: () => insertMenu(card.querySelector('.link-btn'), n) }, 'Insert'), (n.highlightId || (n.sourceId && n.page)) && h('button.link-btn', { onclick: () => openPassage(n) }, 'Open source'), h('button.link-btn', { onclick: () => noteDialog(n) }, 'Edit'), h('button.link-btn', { onclick: async () => { if (await confirmDialog('Delete note?', 'This note will be removed. Highlights stay.', { ok: 'Delete' })) removeItem('note', n.id); } }, 'Delete')));
  return card;
}
export function openPassage(n) { if (n.sourceId) bus.emit('open-reader', n.sourceId, { highlight: n.highlightId, page: n.page && !n.highlightId ? parseInt(n.page, 10) : undefined }); }
function insertMenu(anchor, n) {
  const hasSrc = !!S.sources.get(n.sourceId);
  menu(anchor, n.kind === 'quotation' ? [{ label: 'Quotation in text, with citation', icon: 'quote', disabled: !hasSrc, action: () => insertNoteIntoDraft(n.id, { form: 'inline' }) }, { label: 'Block quotation, with citation', icon: 'quote', disabled: !hasSrc, action: () => insertNoteIntoDraft(n.id, { form: 'block' }) }, { label: 'Citation only', icon: 'book', disabled: !hasSrc, action: () => insertNoteIntoDraft(n.id, { form: 'cite' }) }, !hasSrc && { heading: 'Attach a source to cite this quotation' }]
    : n.kind === 'paraphrase' ? [{ label: 'Text with citation', icon: 'pencil', action: () => insertNoteIntoDraft(n.id, { form: 'text' }) }, { label: 'Citation only', icon: 'book', disabled: !hasSrc, action: () => insertNoteIntoDraft(n.id, { form: 'cite' }) }]
    : [{ label: 'Insert as text', icon: 'pencil', action: () => insertNoteIntoDraft(n.id, { form: 'text' }) }, { label: 'Insert as drafting note', icon: 'note', action: () => insertNoteIntoDraft(n.id, { form: 'callout' }) }]);
}

export function citeItemFor(n) { const it = { sourceId: n.sourceId }; if (n.page) { it.locator = String(n.page).replace(/[–—]/g, '-'); it.label = 'page'; } else if (n.para) { it.locator = String(n.para); it.label = 'paragraph'; } if (n.id) it.noteId = n.id; if (n.highlightId) it.highlightId = n.highlightId; return it; }

export function insertNoteIntoDraft(noteId, { form = 'inline', pos } = {}) {
  const E = S.editor; const n = S.notes.get(noteId); if (!E || !n) return; const view = E.view; const src = S.sources.get(n.sourceId);
  const cit = () => (src ? T.citation.create({ id: uid('cit'), items: [citeItemFor(n)], mode: 'parenthetical' }) : null);
  const qm = (extra) => M.quote.create({ quoteId: n.highlightId || n.id, sourceId: n.sourceId || null, page: n.page || '', noteId: n.id, ...extra });
  if (!src && ['inline', 'block', 'cite'].includes(form) && n.kind !== 'idea') toast('This note has no source attached, so there is nothing to cite. Attach a source to the note first.', { kind: 'err' });
  if (form === 'cite') { if (src) E.cmd.citation([citeItemFor(n)]); return; }
  if (form === 'block') {
    const para = T.paragraph.create({ id: uid('par') }, [schema.text(n.text, [qm()]), schema.text(' '), cit()].filter(Boolean)); const bq = T.blockquote.create({ id: uid('bq') }, para); insertBlock(view, bq); return;
  }
  if (form === 'callout') { insertBlock(view, T.callout.create({ id: uid('co'), kind: 'note' }, T.paragraph.create({ id: uid('par') }, n.text ? schema.text(n.text) : null))); return; }
  const nodes = form === 'inline' ? [schema.text('“' + n.text + '”', [qm()]), src ? schema.text(' ') : null, cit()].filter(Boolean) : [schema.text(n.text), src ? schema.text(' ') : null, cit()].filter(Boolean);
  const at = pos ?? (inFront(view.state) ? null : view.state.selection.to);
  if (at == null) { insertBlock(view, T.paragraph.create({ id: uid('par') }, nodes)); return; }
  let tr = view.state.tr; if (view.state.doc.resolve(at).parent.inlineContent) tr = tr.insert(at, nodes); else tr = tr.insert(at, T.paragraph.create({ id: uid('par') }, nodes));
  view.dispatch(tr.scrollIntoView()); view.focus();
}

// ---- paste provenance ----------------------------------------------------------
export function handlePasteCapture(view, cap, text) {
  const src = S.sources.get(cap.sourceId); const where = src ? `${shortCite(src)}${cap.page ? ', p. ' + cap.page : ''}` : 'a source in the library';
  const coords = view.coordsAtPos(view.state.selection.from);
  const mkNote = () => { const hl = null; const n = { id: uid('note'), kind: 'quotation', text: cap.text, attach: { type: 'source', refId: cap.sourceId }, sourceId: cap.sourceId, page: cap.page || '', para: cap.para, tags: [], created: now(), updated: now() }; putItem('note', n); return n; };
  const existing = [...S.notes.values()].find((x) => x.kind === 'quotation' && x.sourceId === cap.sourceId && x.text === cap.text);
  const note = () => existing || mkNote();
  const pop = popover(coords, h('div.paste-ask', h('p.pa-t', 'Pasted from ', h('b', where)), h('p.muted', 'Copied source text is not treated as your own writing. How should it appear?'),
    h('div.pa-opts', h('button.btn.btn-primary.sm', { onclick: () => { pop.close(); insertNoteIntoDraft(note().id, { form: 'inline' }); } }, 'Quotation with citation'), h('button.btn.sm', { onclick: () => { pop.close(); insertNoteIntoDraft(note().id, { form: 'block' }); } }, 'Block quotation'), h('button.btn.sm', { onclick: () => { pop.close(); const q = note(); const n = { id: uid('note'), kind: 'paraphrase', text: '', attach: { type: 'source', refId: cap.sourceId }, sourceId: cap.sourceId, page: cap.page || '', tags: [], from: q.id, created: now(), updated: now() }; putItem('note', n); bus.emit('open-note', n.id); toast('Write your paraphrase in the note, then insert it.'); } }, 'Write a paraphrase note'), h('button.btn.sm', { onclick: () => { pop.close(); const tr = view.state.tr.insertText(text); view.dispatch(tr); S.lastCapture = null; toast('Inserted as ordinary text. The citation audit will still flag it if it matches a captured passage.'); } }, 'Plain text'))), { className: 'wide', label: 'Pasted source text' });
}

// ---- note dialog ---------------------------------------------------------------
export function noteDialog(init = {}) {
  const editing = !!(init.id && S.notes.has(init.id)); const n = editing ? { ...S.notes.get(init.id) } : { id: uid('note'), kind: init.kind || 'idea', text: init.text || '', attach: init.attach || { type: 'none' }, sourceId: init.sourceId || null, page: init.page || '', tags: init.tags || [], created: now(), updated: now(), ...init };
  const ta = h('textarea.input.note-ta', { rows: 5, value: n.text, placeholder: 'Write your note', autofocus: true, oninput: (e) => { n.text = e.target.value; } });
  const kindSeg = h('div'); const draw = () => { clear(kindSeg).append(segmented(Object.entries(NOTE_KINDS), n.kind, (v) => { n.kind = v; hint.textContent = KIND_HINT[v]; if (v === 'quotation') ta.placeholder = 'Exact words from the source'; else if (v === 'paraphrase') ta.placeholder = 'Restate the source in your own words'; else ta.placeholder = 'Write your note'; }, 'Note type')); };
  const hint = h('p.field-h', KIND_HINT[n.kind]); draw();
  const srcSel = h('select.input', { 'aria-label': 'Source', onchange: (e) => { n.sourceId = e.target.value || null; n.attach = n.sourceId ? { type: n.page ? 'source' : 'source', refId: n.sourceId } : { type: 'none' }; } }, h('option', { value: '' }, 'No source'), [...S.sources.values()].sort((a, b) => a.title.localeCompare(b.title)).map((s) => h('option', { value: s.id, selected: n.sourceId === s.id }, shortCite(s) + ' — ' + s.title.slice(0, 60))));
  const page = h('input.input.sm', { value: n.page || '', placeholder: 'Page', 'aria-label': 'Page', oninput: (e) => { n.page = e.target.value.trim(); } });
  const heads = S.editor?.analysis().headings || []; const secSel = h('select.input', { 'aria-label': 'Paper section', onchange: (e) => { if (e.target.value) { n.attach = { type: 'section', refId: e.target.value }; } else if (n.attach?.type === 'section') n.attach = n.sourceId ? { type: 'source', refId: n.sourceId } : { type: 'none' }; } }, h('option', { value: '' }, 'Not attached to a section'), heads.map((x) => h('option', { value: x.id, selected: n.attach?.type === 'section' && n.attach.refId === x.id }, '— '.repeat(x.level - 1) + (x.text || 'Untitled'))));
  const tags = h('input.input', { value: (n.tags || []).join(', '), placeholder: 'comma, separated', oninput: (e) => { n.tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean); } });
  const blockLine = n.attach?.type === 'block' ? h('p.field-h', 'Attached to a paragraph in the paper.') : null;
  const body = h('div.note-form', kindSeg, hint, field('Note', ta), h('div.f2', field('Source', srcSel), field('Page or locator', page)), field('Paper section', secSel), blockLine, field('Tags', tags));
  dialog({ title: editing ? 'Edit note' : 'New note', body, width: 560, actions: [{ label: 'Cancel', value: false }, { label: 'Save', primary: true, onClick: () => { if (!n.text.trim() && n.kind !== 'question') { toast('Write something first'); return false; } if (n.sourceId && n.attach?.type === 'none') n.attach = { type: 'source', refId: n.sourceId }; n.updated = now(); putItem('note', n); pushRecent('notes', { id: n.id, label: n.text.slice(0, 50) }); bus.emit('open-note-saved', n.id); } }] });
}
export function addNoteForSelection(kind = 'idea') {
  const E = S.editor; const text = E.selectionText(); const b = E.blockAt(E.view.state.selection.from);
  noteDialog({ kind, text: kind === 'quotation' ? '' : text && kind === 'idea' ? '' : '', attach: b ? { type: 'block', refId: b.node.attrs.id } : { type: 'none' }, quoteOfPaper: text });
}
bus.on('new-note', (o) => noteDialog(o || {}));
bus.on('open-note', (id) => { const n = S.notes.get(id); if (n) noteDialog(n); });
