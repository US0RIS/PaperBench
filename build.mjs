import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const single = process.argv.includes('--single');
const out = single ? 'dist-single' : 'dist';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const common = { bundle: true, minify: !process.argv.includes('--dev'), sourcemap: false, target: 'es2022', logLevel: 'warning',
  loader: { '.csl': 'text', '.xml': 'text', '.woff2': single ? 'dataurl' : 'file', '.woff': single ? 'dataurl' : 'file', '.ttf': single ? 'dataurl' : 'file' },
  plugins: [{ name: 'katex-woff2-only', setup(b) { b.onLoad({ filter: /katex\.min\.css$/ }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8').replace(/,url\([^)]*\.woff\) format\("woff"\)/g, '').replace(/,url\([^)]*\.ttf\) format\("truetype"\)/g, ''), loader: 'css', resolveDir: path.dirname(a.path) })); } }],
  assetNames: 'fonts/[name]-[hash]' };
// PDF.js worker as its own bundle
const w = await build({ ...common, entryPoints: ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs'], format: 'esm', outfile: path.join(out, 'pdf.worker.mjs'), write: !single, minify: true });
await build({ ...common, entryPoints: ['src/main.js'], format: 'esm', outdir: out, entryNames: 'app',
  define: single ? { __WORKER_INLINE__: 'true' } : { __WORKER_INLINE__: 'false' } });
let html = fs.readFileSync('src/index.html', 'utf8');
if (single) {
  const js = fs.readFileSync(path.join(out, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(out, 'app.css'), 'utf8');
  const worker = w.outputFiles[0].text;
  html = html.replace('<link rel="stylesheet" href="app.css">', () => `<style>${css}</style>`)
    .replace('<script type="module" src="app.js"></script>', () => `<script id="pdf-worker-src" type="text/plain">${worker.replace(/<\/script/gi, '<\\/script')}</script><script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
  fs.writeFileSync(path.join(out, 'paper.html'), html);
  for (const f of ['app.js', 'app.css']) fs.rmSync(path.join(out, f), { force: true });
  fs.rmSync(path.join(out, 'fonts'), { recursive: true, force: true });
} else {
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.copyFileSync('src/sw.js', path.join(out, 'sw.js'));
}
console.log('built', out);
