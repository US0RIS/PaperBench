// Local HTTP backend used by both the browser build and the macOS desktop app.
// Standalone usage: node server.js [port]
// Env: ANTHROPIC_API_KEY (optional), ANTHROPIC_MODEL (optional), PAPER_DIST (optional)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};
const PROXY_HOSTS = /^(export\.arxiv\.org|api\.crossref\.org|api\.openalex\.org|api\.semanticscholar\.org|eutils\.ncbi\.nlm\.nih\.gov|www\.googleapis\.com|openlibrary\.org|doi\.org|api\.datamuse\.com|api\.dictionaryapi\.dev|[a-z-]+\.(wikipedia|wiktionary)\.org)$/;

const json = (res, code, obj, extraHeaders = {}) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(obj));
};

function privateIP(ip) {
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    return x === '::1' || x === '::' || /^f[cd]/.test(x) || /^fe8[0-9a-f]:/.test(x) || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.') || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(x);
  }
  const p = ip.split('.').map(Number); const [a, b] = p;
  return p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255) || a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
}

async function assertPublicHost(hostname) {
  const addrs = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => privateIP(a.address))) throw new Error('That address is not allowed');
}

export async function safeFetch(url, { maxBytes = 8e6, timeout = 15000, method = 'GET', accept } = {}) {
  let cur = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(cur.protocol)) throw new Error('Only http(s) URLs are allowed');
    if (cur.username || cur.password) throw new Error('URLs containing credentials are not allowed');
    await assertPublicHost(cur.hostname);
    const r = await fetch(cur, {
      method, redirect: 'manual', signal: AbortSignal.timeout(timeout),
      headers: { 'user-agent': 'PaperBench/1.0 (+local research tool)', accept: accept || '*/*' },
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { cur = new URL(r.headers.get('location'), cur); continue; }
    const len = +r.headers.get('content-length') || 0;
    if (len > maxBytes) throw new Error('Response is too large');
    const buf = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('Response is too large');
    return { status: r.status, ok: r.ok, headers: r.headers, buf, finalUrl: cur.href };
  }
  throw new Error('Too many redirects');
}

async function readBody(req, maxBytes = 1e6) {
  const chunks = []; let n = 0;
  for await (const x of req) { n += x.length; if (n > maxBytes) throw new Error('Request body is too large'); chunks.push(x); }
  return Buffer.concat(chunks).toString('utf8');
}

function defaultAIProvider() {
  return {
    desktop: false,
    async get() { return { key: process.env.ANTHROPIC_API_KEY || '', model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL }; },
    async set() { throw new Error('AI settings can only be changed inside the desktop app.'); },
  };
}

function staticFile(root, pathname) {
  let p = decodeURIComponent(pathname); if (p.endsWith('/')) p += 'index.html';
  const relative = path.normalize(p).replace(/^([/\\])+/, '').replace(/^(\.\.[/\\])+/, '');
  const file = path.resolve(root, relative); const base = path.resolve(root) + path.sep;
  return file === path.resolve(root) || file.startsWith(base) ? file : null;
}

export function createRequestHandler({ root = path.join(here, process.env.PAPER_DIST || 'dist'), aiProvider = defaultAIProvider() } = {}) {
  return async (req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    try {
      if (u.pathname === '/api/status') {
        const ai = await aiProvider.get();
        return json(res, 200, { ok: true, ai: !!ai.key, model: ai.model || DEFAULT_MODEL, desktop: !!aiProvider.desktop });
      }
      if (u.pathname === '/api/settings/ai') {
        if (!aiProvider.desktop) return json(res, 404, { error: 'Not available' });
        if (req.method === 'GET') { const ai = await aiProvider.get(); return json(res, 200, { configured: !!ai.key, model: ai.model || DEFAULT_MODEL }); }
        if (req.method === 'PUT') {
          const body = JSON.parse(await readBody(req)); const current = await aiProvider.get();
          const hasKey = Object.prototype.hasOwnProperty.call(body, 'key');
          const key = hasKey ? String(body.key || '').trim() : current.key;
          const model = String(body.model || current.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
          if (key && key.length < 20) return json(res, 400, { error: 'That API key is too short.' });
          await aiProvider.set({ key, model }); return json(res, 200, { configured: !!key, model });
        }
        return json(res, 405, { error: 'Method not allowed' }, { allow: 'GET, PUT' });
      }
      if (u.pathname === '/api/proxy') {
        const raw = u.searchParams.get('url'); if (!raw) return json(res, 400, { error: 'Missing url' });
        const target = new URL(raw); if (!PROXY_HOSTS.test(target.hostname)) return json(res, 403, { error: 'Host not allowed' });
        const r = await safeFetch(target.href, { accept: req.headers.accept });
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'text/plain', 'cache-control': 'no-store' }); return res.end(r.buf);
      }
      if (u.pathname === '/api/fetch') {
        const target = u.searchParams.get('url'); if (!target) return json(res, 400, { error: 'Missing url' });
        const r = await safeFetch(target, { accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5' }); const ct = r.headers.get('content-type') || '';
        if (u.searchParams.get('raw')) { res.writeHead(r.status, { 'content-type': ct, 'cache-control': 'no-store' }); return res.end(r.buf); }
        if (!r.ok) return json(res, 502, { error: `The site returned ${r.status}` });
        if (/pdf/i.test(ct)) return json(res, 200, { finalUrl: r.finalUrl, contentType: ct });
        if (!/html|xml|text/i.test(ct)) return json(res, 415, { error: 'That URL is not a web page or PDF (' + ct + ')' });
        return json(res, 200, { finalUrl: r.finalUrl, contentType: ct, html: r.buf.toString('utf8') });
      }
      if (u.pathname === '/api/check') {
        const target = u.searchParams.get('url'); if (!target) return json(res, 400, { error: 'Missing url' });
        let r; try { r = await safeFetch(target, { method: 'HEAD', timeout: 10000 }); if (r.status === 405 || r.status === 403) r = await safeFetch(target, { timeout: 10000, maxBytes: 2e6 }); }
        catch (e) { return json(res, 200, { ok: false, error: e.message }); }
        return json(res, 200, { ok: r.status < 400, status: r.status });
      }
      if (u.pathname === '/api/ai' && req.method === 'POST') {
        const ai = await aiProvider.get(); if (!ai.key) return json(res, 501, { error: aiProvider.desktop ? 'Add your Anthropic API key in the Assist panel.' : 'Set ANTHROPIC_API_KEY on the server to enable AI assistance.' });
        const body = JSON.parse(await readBody(req));
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'x-api-key': ai.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: ai.model || DEFAULT_MODEL, max_tokens: 1500, system: body.system, messages: [{ role: 'user', content: body.prompt }] }),
          signal: AbortSignal.timeout(120000),
        });
        const j = await r.json(); if (!r.ok) return json(res, 502, { error: j.error?.message || 'AI request failed' });
        return json(res, 200, { text: (j.content || []).map((c) => c.text || '').join('') });
      }
      if (u.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });

      const file = staticFile(root, u.pathname);
      if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (!path.extname(u.pathname)) {
          const index = path.join(root, 'index.html'); if (fs.existsSync(index)) { res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' }); return fs.createReadStream(index).pipe(res); }
        }
        res.writeHead(404); return res.end('Not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (e) { json(res, 400, { error: e?.message || String(e) }); }
  };
}

export async function startPaperServer({ root, aiProvider, port = 5173, host = '127.0.0.1' } = {}) {
  const server = http.createServer(createRequestHandler({ root, aiProvider }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const addr = server.address(); const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return { server, port: actualPort, origin: `http://${host}:${actualPort}` };
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const port = +(process.argv[2] || process.env.PORT || 5173);
  startPaperServer({ port }).then(({ origin }) => {
    console.log(`PaperBench: ${origin}  (AI ${process.env.ANTHROPIC_API_KEY ? 'enabled' : 'disabled: set ANTHROPIC_API_KEY'})`);
  }).catch((e) => { console.error(e); process.exitCode = 1; });
}
