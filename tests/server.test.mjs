import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPaperServer, safeFetch } from '../server.js';

async function withServer(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperbench-test-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>PaperBench test</title><main>ok</main>');
  let state = { key: '', model: 'claude-test' };
  const aiProvider = {
    desktop: true,
    async get() { return { ...state }; },
    async set(v) { state = { ...v }; },
  };
  const running = await startPaperServer({ root, aiProvider, port: 0 });
  try { await fn({ ...running, getState: () => state }); }
  finally { await new Promise((resolve) => running.server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); }
}

test('serves the bundled application and reports desktop status', async () => {
  await withServer(async ({ origin }) => {
    const page = await fetch(origin + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /PaperBench test/);
    const status = await (await fetch(origin + '/api/status')).json();
    assert.deepEqual(status, { ok: true, ai: false, model: 'claude-test', desktop: true });
  });
});

test('desktop AI settings never return the key and model-only changes preserve it', async () => {
  await withServer(async ({ origin, getState }) => {
    let r = await fetch(origin + '/api/settings/ai', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'sk-ant-this-is-a-long-test-key', model: 'claude-a' }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { configured: true, model: 'claude-a' });
    assert.equal(getState().key, 'sk-ant-this-is-a-long-test-key');

    r = await fetch(origin + '/api/settings/ai');
    const settings = await r.json();
    assert.deepEqual(settings, { configured: true, model: 'claude-a' });
    assert.equal(JSON.stringify(settings).includes('long-test-key'), false);

    r = await fetch(origin + '/api/settings/ai', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-b' }),
    });
    assert.equal(r.status, 200);
    assert.equal(getState().key, 'sk-ant-this-is-a-long-test-key');
    assert.equal(getState().model, 'claude-b');
  });
});

test('AI key can be removed explicitly', async () => {
  await withServer(async ({ origin, getState }) => {
    await fetch(origin + '/api/settings/ai', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'sk-ant-this-is-a-long-test-key', model: 'claude-a' }),
    });
    const r = await fetch(origin + '/api/settings/ai', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: '' }),
    });
    assert.equal(r.status, 200);
    assert.equal(getState().key, '');
  });
});

test('arbitrary URL fetch rejects loopback before connecting', async () => {
  await assert.rejects(() => safeFetch('http://127.0.0.1:9/', { timeout: 1000 }), /not allowed/);
});

test('unknown API routes return JSON 404', async () => {
  await withServer(async ({ origin }) => {
    const r = await fetch(origin + '/api/nope');
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: 'Not found' });
  });
});
