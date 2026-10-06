// Dictionary, thesaurus, spelling suggestions and usage information.
import { S } from './state.js';
import { h, icon, clear, menu, toast, bus, segmented, $ } from './ui.js';
import { http, ApiError } from './research.js';
import { escapeHtml } from './model.js';

const cache = new Map();
const memo = async (k, fn) => { if (cache.has(k)) return cache.get(k); const v = await fn(); cache.set(k, v); return v; };
const lang = () => ({ en: 'en', es: 'es', fr: 'fr', de: 'de', it: 'it', pt: 'pt-BR', ru: 'ru', ja: 'ja', ko: 'ko', ar: 'ar', tr: 'tr', hi: 'hi' }[(S.settings.language || 'en').slice(0, 2)] || 'en');
export const lookupEntry = (w) => memo('def:' + lang() + w, async () => { try { return await http(`https://api.dictionaryapi.dev/api/v2/entries/${lang()}/${encodeURIComponent(w)}`); } catch (e) { if (e.status === 404) return null; throw e; } });
const dm = (q) => http(`https://api.datamuse.com/words?${q}`);
export const synonyms = (w) => memo('syn:' + w, () => dm(`rel_syn=${encodeURIComponent(w)}&max=30`));
export const antonyms = (w) => memo('ant:' + w, () => dm(`rel_ant=${encodeURIComponent(w)}&max=20`));
export const related = (w) => memo('rel:' + w, () => dm(`ml=${encodeURIComponent(w)}&max=30`));
export const spelling = (w) => memo('sp:' + w, () => dm(`sp=${encodeURIComponent(w)}&max=8`));
const freq = (w) => memo('f:' + w, async () => { const r = await dm(`sp=${encodeURIComponent(w)}&md=f&max=1`); const f = r[0]?.tags?.find((t) => t.startsWith('f:')); return r[0]?.word === w && f ? parseFloat(f.slice(2)) : null; });
const etym = (w) => memo('et:' + w, async () => {
  if (lang() !== 'en') return ''; try { const j = await http(`https://en.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(w)}&format=json&origin=*`); const p = Object.values(j.query?.pages || {})[0]; const t = p?.extract || ''; const m = t.match(/={2,}\s*Etymology(?: \d+)?\s*={2,}\n([\s\S]*?)(?=\n={2,}\s*[A-Z])/); return m ? m[1].trim().split('\n\n')[0] : ''; } catch { return ''; }
});
const stem = (w) => w.toLowerCase().replace(/(ing|edly|ed|ly|ies|es|s|ness|ment|tion|ions?)$/, '');

export const dictState = { word: '', tab: 'define' };
export function renderDefine(root, word) {
  if (word != null) dictState.word = word.trim().split(/\s+/).slice(0, 3).join(' ');
  clear(root); const w = dictState.word;
  const input = h('input.input', { type: 'search', placeholder: 'Look up a word', 'aria-label': 'Look up a word', value: w, onkeydown: (e) => { if (e.key === 'Enter') { renderDefine(root, e.target.value); } } });
  const body = h('div.dict-body', { 'aria-live': 'polite' });
  root.append(h('div.panel-search', input), segmented([['define', 'Definition'], ['thesaurus', 'Thesaurus'], ['usage', 'Forms and usage']], dictState.tab, (v) => { dictState.tab = v; draw(); }, 'Language tool'), body);
  const selReplace = (word2) => { const E = S.editor; const { from, to, empty } = E.view.state.selection; return empty ? null : () => { E.view.dispatch(E.view.state.tr.insertText(word2, from, to)); E.focus(); }; };
  const chip = (x, anchorWord) => h('button.chip', { onclick: (e) => { const rep = selReplace(x); menu(e.currentTarget, [{ label: 'Look up “' + x + '”', icon: 'search', action: () => renderDefine(root, x) }, rep && { label: 'Replace selection with “' + x + '”', icon: 'pencil', action: rep }, { label: 'Copy', icon: 'copy', action: () => navigator.clipboard?.writeText(x) }]); } }, x);
  async function draw() {
    clear(body); if (!w) { body.append(h('p.empty-s', 'Select a word in the paper and choose Define, or type one above.')); return; }
    body.append(h('p.muted', 'Looking up…'));
    try {
      if (dictState.tab === 'define') {
        const e = await lookupEntry(w); clear(body);
        if (!e) { body.append(h('p', `No dictionary entry for “${w}”.`)); const sp = await spelling(w).catch(() => []); if (sp.length) body.append(h('p.muted', 'Did you mean'), h('div.chips', sp.filter((x) => x.word.toLowerCase() !== w.toLowerCase()).slice(0, 8).map((x) => chip(x.word)))); return; }
        const ph = (e[0].phonetics || []).find((p) => p.text && p.audio) || (e[0].phonetics || []).find((p) => p.text) || {}; const audio = (e[0].phonetics || []).find((p) => p.audio)?.audio;
        body.append(h('div.dict-h', h('h3.dict-w', e[0].word), (ph.text || e[0].phonetic) && h('span.dict-ph', ph.text || e[0].phonetic), audio && h('button.icon-btn.sm', { 'aria-label': 'Play pronunciation', onclick: () => new Audio(audio.startsWith('//') ? 'https:' + audio : audio).play().catch(() => toast('Audio unavailable')) }, icon('right', 14))));
        const meanings = e.flatMap((x) => x.meanings || []);
        meanings.forEach((m) => body.append(h('div.dict-m', h('div.dict-pos', m.partOfSpeech), h('ol', m.definitions.slice(0, 6).map((d) => h('li', d.definition, d.example && h('div.dict-ex', '“' + d.example + '”')))), ...[['Synonyms', [...new Set([...(m.synonyms || []), ...m.definitions.flatMap((d) => d.synonyms || [])])].slice(0, 10)], ['Antonyms', [...new Set([...(m.antonyms || []), ...m.definitions.flatMap((d) => d.antonyms || [])])].slice(0, 8)]].filter(([, a]) => a.length).map(([l, a]) => h('div.dict-sa', h('span.muted', l + ' '), h('span.chips', a.map((x) => chip(x))))))));
        const et = e.find((x) => x.origin)?.origin || await etym(e[0].word); if (et) body.append(h('div.dict-m', h('div.dict-pos', 'Etymology'), h('p', et)));
        body.append(h('p.muted.src', 'Definitions: Free Dictionary API (Wiktionary). Etymology: Wiktionary when available.'));
      } else if (dictState.tab === 'thesaurus') {
        const [s, a, r] = await Promise.all([synonyms(w), antonyms(w), related(w)]); clear(body);
        const sec = (l, arr) => arr.length ? h('div.dict-m', h('div.dict-pos', l), h('div.chips', arr.map((x) => chip(x.word)))) : null;
        body.append(sec('Synonyms', s) || h('p.muted', 'No synonyms found.'), sec('Antonyms', a), sec('Related words', r.filter((x) => !s.find((y) => y.word === x.word)).slice(0, 20)), h('p.muted.src', 'Suggestions only; nothing is changed until you choose a word. Source: Datamuse.'));
      } else {
        const [f, sp, forms] = await Promise.all([freq(w), spelling(w), dm(`sp=${encodeURIComponent(stem(w).slice(0, Math.max(4, stem(w).length))) }*&md=p&max=30`).catch(() => [])]); clear(body);
        const exact = sp.find((x) => x.word.toLowerCase() === w.toLowerCase());
        body.append(h('div.dict-m', h('div.dict-pos', 'Spelling'), exact ? h('p', `“${w}” is a recognized spelling.`) : h('div', h('p', `“${w}” was not recognized. Suggestions:`), h('div.chips', sp.slice(0, 8).map((x) => chip(x.word))))), h('div.dict-m', h('div.dict-pos', 'Usage'), f != null ? h('p', `About ${f < 1 ? f.toFixed(2) : Math.round(f)} occurrences per million words of general English. ${f > 30 ? 'A common word.' : f < 1 ? 'A rare word; consider whether your readers will know it.' : ''}`) : h('p.muted', 'No frequency data.')), h('div.dict-m', h('div.dict-pos', 'Words sharing this stem'), h('div.chips', forms.filter((x) => x.word.toLowerCase() !== w.toLowerCase()).slice(0, 16).map((x) => chip(x.word))), h('p.muted.src', 'A heuristic list, not a full conjugation table. Source: Datamuse.')));
      }
    } catch (e) { clear(body); body.append(h('p.err', e.message || 'Lookup failed'), h('button.btn.sm', { onclick: draw }, 'Try again')); }
  }
  draw();
}
