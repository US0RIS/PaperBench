// Application state: current project, collections, derived data, write-through persistence.
import * as DB from './db.js';
import { uid, now, newSource, duplicateOf, debounce, newProject, defaultSettings } from './model.js';
import { renderCitations, isNoteStyle } from './csl.js';
import { bus, toast } from './ui.js';
import { sampleProject } from './sample.js';

export const S = {
  P: null, id: null, editor: null, derived: null, texts: new Map(), assets: new Map(), saveState: 'saved', recents: { sources: [], searches: [], sections: [], notes: [] },
  get project() { return this.P.project; }, get settings() { return this.P.project.settings; },
  get sources() { return this.P.sources; }, get notes() { return this.P.notes; },
};

export async function boot() {
  await DB.open();
  let projects = await DB.listProjects();
  if (!projects.length) { await createSample(); projects = await DB.listProjects(); }
  const last = (await DB.kvGet('lastProject')) || projects[0].id;
  await openProject(projects.find((p) => p.id === last) ? last : projects[0].id);
}
export async function createSample() {
  const { project, items, doc, texts, blobs, notebook } = sampleProject();
  await DB.saveProject(project); await DB.saveDoc(project.id, doc);
  for (const [kind, arr] of Object.entries(items)) for (const it of arr) await DB.saveItem(project.id, kind, it);
  for (const [sid, pages] of Object.entries(texts || {})) await DB.saveText(project.id, sid, pages);
  for (const b of blobs || []) await DB.saveBlob(project.id, b.id, b.blob, b.name);
  if (notebook) await DB.saveNotebook(project.id, notebook);
  return project.id;
}
export async function createBlank(name) {
  const p = newProject(name || 'Untitled paper');
  const { emptyDoc } = await import('./schema.js');
  await DB.saveProject(p); await DB.saveDoc(p.id, emptyDoc({ title: p.settings.title }));
  return p.id;
}
export async function openProject(id) {
  const P = await DB.loadProject(id);
  if (!P) throw new Error('Project not found');
  P.settings = P.project.settings = { ...defaultSettings(), ...P.project.settings, export: { ...defaultSettings().export, ...(P.project.settings.export || {}) } };
  // recover a newer unsaved draft if IndexedDB write was interrupted
  const rec = DB.recovery.load(id);
  if (rec && rec.t > (P.docUpdated || 0) + 500 && rec.json) { P.docJSON = rec.json; P.recovered = true; }
  const nb = await DB.getNotebook(id); P.notebookJSON = nb?.json || null; P.notebookUpdated = nb?.updatedAt || 0;
  try { const r = JSON.parse(localStorage.getItem('nbrecover:' + id) || 'null'); if (r && r.t > P.notebookUpdated + 500 && r.json) { P.notebookJSON = r.json; P.nbRecovered = true; } } catch { /* */ }
  S.wordlog = (await DB.kvGet('wordlog:' + id)) || {};
  S.P = P; S.id = id; S.texts = new Map(); S.assets = new Map();
  const all = await DB.allTexts(id); all.forEach((t) => S.texts.set(t.key.split(':')[1], t.pages));
  S.recents = (await DB.kvGet('recents:' + id)) || { sources: [], searches: [], sections: [], notes: [] };
  await DB.kvSet('lastProject', id);
  bus.emit('project');
}

// ---- generic item persistence -------------------------------------------------
const pending = new Set();
const track = (p) => { pending.add(p); p.finally(() => pending.delete(p)); return p; };
export const flushed = () => Promise.all([...pending]);
export function putItem(kind, obj) {
  S.P[kind + 's'].set(obj.id, obj);
  track(DB.saveItem(S.id, kind, obj).catch((e) => toast('Could not save: ' + e.message, { kind: 'err' })));
  bus.emit(kind + 's', obj);
  return obj;
}
export function removeItem(kind, id) {
  const o = S.P[kind + 's'].get(id); S.P[kind + 's'].delete(id);
  track(DB.deleteItem(S.id, kind, id)); bus.emit(kind + 's', null); return o;
}
export function saveSettings(patch = {}) {
  Object.assign(S.settings, patch); S.project.name = S.settings.title || S.project.name;
  track(DB.saveProject(S.project)); bus.emit('settings');
}
export function renameProject(name) { S.project.name = name; S.settings.title = name; track(DB.saveProject(S.project)); bus.emit('settings'); }

// ---- sources -----------------------------------------------------------------
export function addSource(src, { quiet = false, allowDuplicate = false } = {}) {
  const s = { ...newSource(), ...src, id: src.id || uid('src') };
  if (!s._added) s._added = now();
  const dup = !allowDuplicate && duplicateOf(s, S.sources);
  if (dup) return { source: dup.source, duplicate: true, reason: dup.reason };
  putItem('source', s); if (!quiet) toast('Saved to library');
  return { source: s, duplicate: false };
}
export function updateSource(id, patch) { const s = S.sources.get(id); if (!s) return; Object.assign(s, patch); putItem('source', s); refreshDerivedSoon(); return s; }
export async function deleteSource(id) {
  removeItem('source', id);
  for (const k of ['highlight', 'note']) for (const o of [...S.P[k + 's'].values()]) if (o.sourceId === id && (k === 'highlight' || o.attach?.type === 'source' || o.attach?.type === 'passage')) { if (k === 'note') { o.sourceId = null; o.attach = { type: 'none' }; putItem('note', o); } else removeItem('highlight', o.id); }
  await DB.deleteText(S.id, id); S.texts.delete(id);
  for (const f of S.P.sources.get(id)?._files || []) await DB.deleteBlob(S.id, f.id);
  refreshDerivedSoon();
}
export const mergeSources = (keepId, dropId) => {
  const keep = S.sources.get(keepId), drop = S.sources.get(dropId); if (!keep || !drop) return;
  for (const k in drop) if (keep[k] == null || keep[k] === '' || (Array.isArray(keep[k]) && !keep[k].length)) keep[k] = drop[k];
  keep._tags = [...new Set([...(keep._tags || []), ...(drop._tags || [])])];
  // repoint citations in the document
  S.editor?.rewriteSourceRefs(dropId, keepId);
  for (const k of ['highlight', 'note']) for (const o of S.P[k + 's'].values()) if (o.sourceId === dropId) { o.sourceId = keepId; putItem(k, o); }
  putItem('source', keep); removeItem('source', dropId); refreshDerivedSoon();
};

// ---- recents -----------------------------------------------------------------
export function pushRecent(kind, entry, max = 12) {
  const arr = S.recents[kind]; const i = arr.findIndex((x) => x.id === entry.id); if (i >= 0) arr.splice(i, 1);
  arr.unshift({ ...entry, t: now() }); arr.length = Math.min(arr.length, max);
  DB.kvSet('recents:' + S.id, S.recents); bus.emit('recents');
}

// ---- assets (images) ---------------------------------------------------------
export async function assetURL(id) {
  if (S.assets.has(id)) return S.assets.get(id);
  const b = await DB.getBlob(S.id, id); if (!b) return null;
  const u = URL.createObjectURL(b); S.assets.set(id, u); return u;
}
export async function addAsset(blob, name) { const id = uid('ast'); await DB.saveBlob(S.id, id, blob, name); S.assets.set(id, URL.createObjectURL(blob)); return id; }

// ---- derived data (analysis + citation rendering) ----------------------------
let rendering = 0;
export function refreshDerived() {
  const ed = S.editor; if (!ed || !S.P) return;
  const A = ed.analysis();
  const styleId = S.settings.citationStyle;
  const noteStyle = isNoteStyle(styleId);
  const includeUncited = [...S.sources.values()].filter((s) => s._forceBib || S.settings.includeUncited).map((s) => s.id);
  let R;
  const t0 = performance.now();
  try { R = renderCitations({ styleId, lang: S.settings.language, citations: A.citations, sources: S.sources, includeUncited }); } catch (e) { console.warn(e); R = { cites: new Map(), bib: { entries: [], params: {} }, missing: [], used: [], noteStyle, cls: 'in-text' }; }
  const byTop = new Map(), fnCites = new Map(); let ti = 0;
  A.citations.forEach((c, i) => { const html = R.cites.get('k' + i) || ''; if (c.inFootnote) { if (!fnCites.has(c.inFootnote)) fnCites.set(c.inFootnote, []); fnCites.get(c.inFootnote).push(html); } else if (c.id) byTop.set(c.id, html); });
  const noteOf = new Map(); A.citations.forEach((c) => { if (!c.inFootnote && c.asNote && c.id) noteOf.set(c.id, c.noteIndex); });
  S.derived = { A, ...R, cites: byTop, fnCites, noteOf, styleId, noteStyle, ms: performance.now() - t0, v: ++rendering };
  bus.emit('derived', S.derived);
}
export const refreshDerivedSoon = debounce(refreshDerived, 220);

// ---- doc persistence ---------------------------------------------------------
let dirty = false, lastJSON = null;
const persistDoc = debounce(async () => {
  if (!lastJSON) return;
  const json = lastJSON; setSave('saving');
  try { await DB.saveDoc(S.id, json); DB.recovery.clear(S.id); dirty = false; setSave('saved'); try { logWords(S.editor.analysis().bodyWords); } catch { /* */ } } catch (e) { setSave('error'); toast('Autosave failed. A recovery copy is kept in this browser.', { kind: 'err' }); }
}, 700);
const recover = debounce((json) => DB.recovery.save(S.id, json), 250);
export function docChanged(json) { lastJSON = json; dirty = true; setSave('unsaved'); recover(json); persistDoc(); S.P.docJSON = json; snapshotMaybe(); }
export function setSave(st) { S.saveState = st; bus.emit('save', st); }
export const isDirty = () => dirty || nbDirty;
// ---- notebook (free-form notes document, one per project)
let nbDirty = false, nbJSON = null;
const persistNb = debounce(async () => { if (!nbJSON) return; try { await DB.saveNotebook(S.id, nbJSON); try { localStorage.removeItem('nbrecover:' + S.id); } catch { /* */ } nbDirty = false; } catch { toast('Notes could not be saved. A recovery copy is kept in this browser.', { kind: 'err' }); } }, 700);
export function notebookChanged(json) { nbJSON = json; nbDirty = true; try { localStorage.setItem('nbrecover:' + S.id, JSON.stringify({ t: now(), json })); } catch { /* */ } persistNb(); }
export async function flushNotebook() { persistNb.cancel(); if (nbJSON && nbDirty) { try { await DB.saveNotebook(S.id, nbJSON); nbDirty = false; } catch { /* */ } } }
const day = () => new Date().toISOString().slice(0, 10);
export function logWords(n) { if (!S.wordlog) return; S.wordlog[day()] = n; DB.kvSet('wordlog:' + S.id, S.wordlog); }
export async function flushDoc() { await flushNotebook(); persistDoc.cancel(); if (lastJSON && dirty) { try { await DB.saveDoc(S.id, lastJSON); DB.recovery.clear(S.id); dirty = false; setSave('saved'); } catch { setSave('error'); } } await flushed(); }
export function retrySave() { persistDoc.flush(); }

// ---- automatic snapshots -----------------------------------------------------
let lastAuto = 0;
function snapshotMaybe() {
  const t = now(); if (t - lastAuto < 10 * 60 * 1000) return; lastAuto = lastAuto || t; if (t - lastAuto < 10 * 60 * 1000) return;
  takeSnapshot('', true);
}
export function takeSnapshot(name, auto = false) {
  const json = S.editor?.getJSON(); if (!json) return null;
  const snaps = [...S.P.snapshots.values()].filter((s) => s.auto).sort((a, b) => b.createdAt - a.createdAt);
  const last = snaps[0]; if (auto && last && JSON.stringify(last.doc) === JSON.stringify(json)) return null;
  lastAuto = now();
  const snap = { id: uid('snap'), name: name || '', auto, createdAt: now(), doc: json, words: S.derived?.A?.bodyWords || 0, settings: { citationStyle: S.settings.citationStyle } };
  putItem('snapshot', snap);
  if (auto) snaps.slice(29).forEach((s) => removeItem('snapshot', s.id));
  return snap;
}
window.addEventListener('beforeunload', (e) => { if (dirty || nbDirty || pending.size) { try { if (lastJSON && dirty) DB.recovery.save(S.id, lastJSON); } catch { /* */ } e.preventDefault(); e.returnValue = ''; } });
