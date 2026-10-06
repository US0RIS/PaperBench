// Small UI toolkit: hyperscript, icons, event bus, dialogs, popovers, menus, toasts.
import { createElement, Bold, Italic, Underline, Strikethrough, Superscript, Subscript, Code, Link, Quote, List, ListOrdered, ListChecks, Table, Image, Sigma, MessageSquare, MessageSquarePlus, BookOpen, Search, PanelLeft, PanelRight, Maximize2, Minimize2, Undo2, Redo2, Plus, X, ChevronRight, ChevronDown, ChevronLeft, ChevronUp, Ellipsis, Star, Folder, FileText, FileUp, Download, Upload, Trash2, Pencil, Check, Highlighter, StickyNote, Lightbulb, CircleHelp, Command, History, Settings, Globe, Book, Copy, ExternalLink, CircleAlert, ArrowUpRight, GripVertical, ZoomIn, ZoomOut, Asterisk, Heading, Minus, Hash, Eye, PenLine, Network, FileDown, Keyboard, Type, Library, Tag, RotateCcw, Filter, GitCompare, Sparkles, Scissors, Columns2, Info, Bookmark, Save, CornerDownLeft, SeparatorHorizontal } from 'lucide';

const ICONS = { bold: Bold, italic: Italic, underline: Underline, strike: Strikethrough, sup: Superscript, sub: Subscript, code: Code, link: Link, quote: Quote, list: List, olist: ListOrdered, tasks: ListChecks, table: Table, image: Image, sigma: Sigma, comment: MessageSquare, commentAdd: MessageSquarePlus, book: BookOpen, search: Search, panelL: PanelLeft, panelR: PanelRight, maximize: Maximize2, minimize: Minimize2, undo: Undo2, redo: Redo2, plus: Plus, x: X, right: ChevronRight, down: ChevronDown, left: ChevronLeft, up: ChevronUp, more: Ellipsis, star: Star, folder: Folder, file: FileText, fileUp: FileUp, download: Download, upload: Upload, trash: Trash2, pencil: Pencil, check: Check, highlight: Highlighter, note: StickyNote, idea: Lightbulb, question: CircleHelp, command: Command, history: History, settings: Globe && Settings, globe: Globe, dict: Book, copy: Copy, external: ExternalLink, alert: CircleAlert, arrow: ArrowUpRight, grip: GripVertical, zoomIn: ZoomIn, zoomOut: ZoomOut, footnote: Asterisk, heading: Heading, minus: Minus, hash: Hash, eye: Eye, suggest: PenLine, network: Network, export: FileDown, keyboard: Keyboard, type: Type, library: Library, tag: Tag, reset: RotateCcw, filter: Filter, compare: GitCompare, ai: Sparkles, scissors: Scissors, split: Columns2, info: Info, bookmark: Bookmark, save: Save, enter: CornerDownLeft, hr: SeparatorHorizontal };

// Native append/prepend stringify null/false; drop them so conditional children work everywhere.
for (const m of ['append', 'prepend', 'replaceChildren']) { const o = Element.prototype[m]; Element.prototype[m] = function (...a) { return o.apply(this, a.filter((x) => x != null && x !== false)); }; }
export function icon(name, size = 16) {
  const n = ICONS[name]; if (!n) return document.createTextNode('');
  const s = createElement(n, { width: size, height: size, 'stroke-width': 1.6, 'aria-hidden': 'true', focusable: 'false' });
  s.classList.add('ico'); return s;
}

export function h(tag, attrs, ...kids) {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(tag) || [0, tag, ''];
  const el = document.createElement(m[1]);
  (m[2].match(/[.#][\w-]+/g) || []).forEach((t) => (t[0] === '.' ? el.classList.add(t.slice(1)) : (el.id = t.slice(1))));
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const k in attrs || {}) {
    const v = attrs[k]; if (v == null || v === false) continue;
    if (k === 'class') el.classList.add(...String(v).split(' ').filter(Boolean));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') { if (v) el.setAttribute(k, ''); el[k] = !!v; }
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (k) => { if (k == null || k === false) return; if (Array.isArray(k)) k.forEach(add); else el.append(k instanceof Node ? k : document.createTextNode(String(k))); };
  kids.forEach(add);
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export const bus = {
  m: new Map(),
  on(e, fn) { if (!this.m.has(e)) this.m.set(e, new Set()); this.m.get(e).add(fn); return () => this.m.get(e).delete(fn); },
  emit(e, ...a) { (this.m.get(e) || []).forEach((f) => { try { f(...a); } catch (err) { console.error('bus', e, err); } }); },
};

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';
export const kbd = (s) => s.replace(/Mod/g, MOD).replace(/Alt/g, isMac ? '⌥' : 'Alt').replace(/Shift/g, isMac ? '⇧' : 'Shift').replace(/-/g, isMac ? '' : '+');

let live;
export function announce(msg) { if (!live) { live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' }); document.body.append(live); } live.textContent = ''; setTimeout(() => (live.textContent = msg), 30); }

export function toast(msg, { action, onAction, timeout = 4200, kind = '' } = {}) {
  let host = $('#toasts'); if (!host) { host = h('div#toasts', { 'aria-live': 'polite' }); document.body.append(host); }
  const t = h('div.toast' + (kind ? '.' + kind : ''), h('span', msg), action && h('button.link-btn', { onclick: () => { onAction?.(); t.remove(); } }, action));
  host.append(t); const id = setTimeout(() => t.remove(), timeout); t.addEventListener('mouseenter', () => clearTimeout(id));
  return t;
}

export function dialog({ title, body, actions = [], width = 520, onClose, className = '', labelledBy } = {}) {
  const d = h('dialog.dialog' + (className && className.trim() ? '.' + className.trim().split(/\s+/).join('.') : ''), { style: { width: `min(${width}px, calc(100vw - 24px))` }, 'aria-labelledby': 'dlg-t-' + (labelledBy || 'x') });
  const tid = 'dlg-t-' + (labelledBy || 'x');
  const close = (val) => { d.close(); d.remove(); onClose?.(val); res?.(val); };
  let res;
  const hd = h('header.dialog-hd', h('h2', { id: tid }, title), h('button.icon-btn', { 'aria-label': 'Close', onclick: () => close(undefined) }, icon('x')));
  const ft = actions.length ? h('footer.dialog-ft', actions.map((a) => h('button.btn' + (a.primary ? '.btn-primary' : ''), { onclick: async () => { const r = a.onClick ? await a.onClick(d, close) : undefined; if (r !== false && !a.keepOpen) close(a.value); } }, a.label))) : null;
  d.append(hd, h('div.dialog-bd', body), ft);
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(undefined); });
  document.body.append(d); d.showModal();
  const first = d.querySelector('[autofocus], input, textarea, select'); first?.focus();
  const p = new Promise((r) => { res = r; }); p.close = close; p.el = d; return p;
}
export function confirmDialog(title, message, { ok = 'Confirm', danger = false } = {}) {
  return dialog({ title, body: h('p.dlg-msg', message), width: 440, actions: [{ label: 'Cancel', value: false }, { label: ok, primary: true, value: true }] }).then((v) => !!v);
}
export function promptDialog(title, label, value = '', { multiline = false, ok = 'Save' } = {}) {
  const input = multiline ? h('textarea.input', { rows: 4, value }) : h('input.input', { type: 'text', value, autofocus: true });
  const p = dialog({ title, body: h('label.field', h('span.field-l', label), input), width: 440, actions: [{ label: 'Cancel', value: undefined }, { label: ok, primary: true, onClick: (d, close) => { close(input.value); return false; } }] });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); p.close(input.value); } });
  return p;
}

const openPops = new Set();
export function closeAllPopovers(except) { [...openPops].forEach((p) => p !== except && p.close()); }
export function popover(anchor, content, { placement = 'bottom-start', className = '', onClose, label = 'Popover', trap = false, offset = 6, keepOnScroll = true } = {}) {
  const el = h('div.popover' + (className && className.trim() ? '.' + className.trim().split(/\s+/).join('.') : ''), { role: 'dialog', 'aria-label': label }, content);
  document.body.append(el);
  const pos = () => {
    const r = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
    const w = el.offsetWidth, hh = el.offsetHeight, vw = innerWidth, vh = innerHeight;
    let x = placement.endsWith('end') ? r.right - w : placement.endsWith('center') ? r.left + r.width / 2 - w / 2 : r.left;
    let y = placement.startsWith('top') ? r.top - hh - offset : r.bottom + offset;
    if (placement.startsWith('right')) { x = r.right + offset; y = r.top; }
    if (y + hh > vh - 8 && r.top - hh - offset > 8) y = r.top - hh - offset;
    x = Math.max(8, Math.min(x, vw - w - 8)); y = Math.max(8, Math.min(y, vh - hh - 8));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  };
  const api = { el, reposition: pos, close() { if (!openPops.has(api)) return; openPops.delete(api); document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', key, true); el.remove(); onClose?.(); } };
  const out = (e) => { if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target)) && !e.target.closest?.('.popover, .menu, dialog')) api.close(); };
  const key = (e) => { if (e.key === 'Escape' && openPops.size && [...openPops].pop() === api) { e.stopPropagation(); api.close(); } };
  openPops.add(api);
  setTimeout(() => { document.addEventListener('mousedown', out, true); }, 0);
  document.addEventListener('keydown', key, true);
  pos(); requestAnimationFrame(pos);
  return api;
}

export function menu(anchor, items, { placement = 'bottom-start', onClose, label = 'Menu', className = '' } = {}) {
  const list = h('div.menu-list', { role: 'menu' });
  let pop;
  const mk = (it) => {
    if (it.divider) return h('div.menu-sep', { role: 'separator' });
    if (it.heading) return h('div.menu-h', it.heading);
    const b = h('button.menu-item', { role: it.checked != null ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': it.checked != null ? String(!!it.checked) : null, disabled: it.disabled, tabindex: '-1', onclick: (e) => { e.preventDefault(); pop.close(); it.action?.(); } },
      it.icon ? icon(it.icon, 15) : h('span.ico-sp'), h('span.mi-l', it.label), it.checked ? icon('check', 14) : null, it.kbd && h('span.kbd', kbd(it.kbd)), it.sub && h('span.mi-sub', it.sub));
    return b;
  };
  items.filter(Boolean).forEach((it) => list.append(mk(it)));
  pop = popover(anchor, list, { placement, className: 'menu ' + className, label, onClose, offset: 4 });
  const btns = () => $$('.menu-item:not([disabled])', list);
  const key = (e) => {
    const b = btns(); const i = b.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); b[(i + 1) % b.length]?.focus(); } else if (e.key === 'ArrowUp') { e.preventDefault(); b[(i - 1 + b.length) % b.length]?.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); pop.close(); }
  };
  list.addEventListener('keydown', key);
  requestAnimationFrame(() => btns()[0]?.focus({ preventScroll: true }));
  return pop;
}

export function segmented(options, value, onChange, label) {
  const root = h('div.seg', { role: 'tablist', 'aria-label': label || null });
  const render = () => { clear(root); options.forEach(([v, l, ic]) => root.append(h('button.seg-b', { role: 'tab', 'aria-selected': String(v === value), class: v === value ? 'on' : '', onclick: () => { value = v; render(); onChange(v); } }, ic ? icon(ic, 14) : null, l))); };
  render(); return root;
}
export function fileDialog({ accept = '', multiple = false } = {}) {
  return new Promise((res) => { const i = h('input', { type: 'file', accept, multiple, style: { display: 'none' } }); i.addEventListener('change', () => { res([...i.files]); i.remove(); }); i.addEventListener('cancel', () => { res([]); i.remove(); }); document.body.append(i); i.click(); });
}
export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (window.paperDesktop?.saveFile) {
    blob.arrayBuffer().then((buffer) => window.paperDesktop.saveFile({ name, mime: blob.type || type, bytes: buffer })).catch((e) => console.error('Save failed', e));
    return;
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
export const fmtDate = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const ago = (t) => { const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
export const field = (label, input, hint) => h('label.field', h('span.field-l', label), input, hint && h('span.field-h', hint));
