// IndexedDB persistence + in-memory project state with write-through saves.
import { uid, now, newProject } from './model.js';
const DB = 'paper-workbench', VER = 1;
let dbp;
export function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('projects', { keyPath: 'id' });
      d.createObjectStore('docs', { keyPath: 'projectId' });
      const it = d.createObjectStore('items', { keyPath: 'key' }); it.createIndex('pk', 'pk');
      const bl = d.createObjectStore('blobs', { keyPath: 'key' }); bl.createIndex('projectId', 'projectId');
      d.createObjectStore('texts', { keyPath: 'key' });
      d.createObjectStore('kv', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (stores, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(stores, mode); let out; Promise.resolve(fn(...[].concat(stores).map((s) => t.objectStore(s)))).then((v) => { out = v; }); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const put = (store, val) => tx(store, 'readwrite', (s) => rq(s.put(val)));
export const get = (store, key) => tx(store, 'readonly', (s) => rq(s.get(key)));
export const del = (store, key) => tx(store, 'readwrite', (s) => rq(s.delete(key)));
export const allOf = (store) => tx(store, 'readonly', (s) => rq(s.getAll()));

export const KINDS = ['source', 'note', 'highlight', 'comment', 'evidence', 'relation', 'snapshot', 'collection', 'claim'];
export const listProjects = () => allOf('projects');
export const kvGet = async (k) => (await get('kv', k))?.value;
export const kvSet = (k, value) => put('kv', { key: k, value });

export async function loadProject(id) {
  const [project, doc, items] = await Promise.all([get('projects', id), get('docs', id), tx('items', 'readonly', (s) => rq(s.getAll()))]);
  if (!project) return null;
  const P = { project, docJSON: doc?.json || null, docUpdated: doc?.updatedAt || 0 };
  for (const k of KINDS) P[k + 's'] = new Map();
  for (const it of items) { if (!it.key.startsWith(id + ':')) continue; P[it.kind + 's'].set(it.data.id, it.data); }
  return P;
}
export const saveProject = (project) => { project.updatedAt = now(); return put('projects', project); };
export const saveDoc = (projectId, json) => put('docs', { projectId, json, updatedAt: now() });
export const saveItem = (projectId, kind, data) => put('items', { key: `${projectId}:${kind}:${data.id}`, pk: `${projectId}:${kind}`, kind, data });
export const deleteItem = (projectId, kind, id) => del('items', `${projectId}:${kind}:${id}`);
export const saveBlob = (projectId, id, blob, name = '') => put('blobs', { key: `${projectId}:${id}`, projectId, blob, type: blob.type, name });
export const getBlob = async (projectId, id) => (await get('blobs', `${projectId}:${id}`))?.blob || null;
export const deleteBlob = (projectId, id) => del('blobs', `${projectId}:${id}`);
export const saveText = (projectId, sourceId, pages) => put('texts', { key: `${projectId}:${sourceId}`, projectId, pages });
export const getText = async (projectId, sourceId) => (await get('texts', `${projectId}:${sourceId}`))?.pages || null;
export const deleteText = (projectId, sourceId) => del('texts', `${projectId}:${sourceId}`);

export async function deleteProject(id) {
  const d = await open();
  await new Promise((res, rej) => {
    const t = d.transaction(['projects', 'docs', 'items', 'blobs', 'texts', 'kv'], 'readwrite');
    ['notebook:', 'wordlog:', 'recents:'].forEach((k) => t.objectStore('kv').delete(k + id));
    t.objectStore('projects').delete(id); t.objectStore('docs').delete(id);
    const cur = (name, test) => { const r = t.objectStore(name).openCursor(); r.onsuccess = () => { const c = r.result; if (c) { if (test(c.value)) c.delete(); c.continue(); } }; };
    cur('items', (v) => v.key.startsWith(id + ':')); cur('blobs', (v) => v.projectId === id); cur('texts', (v) => v.projectId === id);
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
export async function allBlobs(projectId) { const d = await open(); const out = []; await new Promise((res) => { const r = d.transaction('blobs').objectStore('blobs').index('projectId').openCursor(IDBKeyRange.only(projectId)); r.onsuccess = () => { const c = r.result; if (c) { out.push(c.value); c.continue(); } else res(); }; }); return out; }
export async function allTexts(projectId) { return (await allOf('texts')).filter((t) => t.projectId === projectId); }

// Synchronous recovery copy (survives a failed/blocked IndexedDB write).
export const recovery = {
  save(pid, json) { try { localStorage.setItem('recover:' + pid, JSON.stringify({ t: now(), json })); } catch { /* quota */ } },
  load(pid) { try { return JSON.parse(localStorage.getItem('recover:' + pid) || 'null'); } catch { return null; } },
  clear(pid) { try { localStorage.removeItem('recover:' + pid); } catch { /* */ } },
};
export { uid, now, newProject };

export const getNotebook = async (id) => (await get('kv', 'notebook:' + id))?.value || null;
export const saveNotebook = (id, json) => put('kv', { key: 'notebook:' + id, value: { json, updatedAt: now() } });
export const allDocs = () => allOf('docs');
export const allItems = () => allOf('items');
export const allKV = () => allOf('kv');
