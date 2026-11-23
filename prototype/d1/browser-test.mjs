import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { startLocalD1 } from './local.mjs';
import { encryptLedger } from '../../src/lib/sync.ts';
import { fixtureLedger } from './fixture.js';
import { runAppTests } from './app-browser-tests.mjs';

const executable = process.env.NOVO_TEST_CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome'
].find(existsSync);
if (!executable) throw new Error('未找到 Chromium；请设置 NOVO_TEST_CHROME 到浏览器程序路径');
if (process.argv.slice(2).some(arg => arg !== '--app')) throw new Error('仅支持本地测试：可选 --app');
const appMode = process.argv.includes('--app');
const local = await startLocalD1({ enrolled: appMode });
const assets = new Map();
if (appMode) {
  const built = await viteBuild({ logLevel: 'error', mode: 'production', envFile: false, build: { write: false, copyPublicDir: false },
    define: { 'import.meta.env.VITE_ENABLE_D1_SYNC': JSON.stringify('1') } });
  for (const file of built.output) assets.set(`/${file.fileName}`, file.type === 'chunk' ? file.code : file.source);
}
const fault = { api: '', oldWorker: false };
const fixtures = new Map();
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./browser-entry.js', import.meta.url))],
  format: 'esm', platform: 'browser', bundle: true, write: false
});
const browserContent = bundle.outputFiles[0].contents;
const server = createServer(async (request, response) => {
  try {
    if (appMode && fixtures.has(request.url)) {
      const fixture = fixtures.get(request.url);
      const html = fixture.path === '/legacy-shell'
        ? '<!doctype html><title>Legacy fixture</title>' : String(assets.get('/index.html'));
      return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        .end(html.replace('<!DOCTYPE html>', '').replace('<!doctype html>', '').replace(
          /(<head>)|^(?=<title>)/i, match => `${match}<script>${fixture.onLoad}</script>`
        ).replace(/^/, '<!doctype html>'));
    }
    if (appMode && request.url === '/legacy-shell') return response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Legacy fixture</title>');
    if (appMode && request.url === '/sw.js' && fault.oldWorker) {
      return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(`
        self.addEventListener('install',event=>event.waitUntil(Promise.all(['finance-workbench-v3','novoledger-idb-v5'].map(key=>caches.open(key)
          .then(cache=>cache.put('/index.html',new Response('<title>Old cache</title>',{headers:{'Content-Type':'text/html'}})))))
          .then(()=>self.skipWaiting())));
        self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));`);
    }
    if (appMode) {
      const path = request.url === '/' ? '/index.html' : request.url;
      if (assets.has(path)) return response.writeHead(200, { 'Content-Type':
        path.endsWith('.html') ? 'text/html; charset=utf-8' : path.endsWith('.css') ? 'text/css' : 'text/javascript' }).end(assets.get(path));
      if (['/sw.js', '/manifest.webmanifest', '/icon.svg'].includes(path)) {
        return response.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' :
          path.endsWith('.svg') ? 'image/svg+xml' : 'application/manifest+json', 'Cache-Control': 'no-store' })
          .end(await readFile(new URL(`../../public${path}`, import.meta.url)));
      }
    }
    if (request.url === '/') return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<!doctype html><meta charset="utf-8"><title>NovoLedger isolated fixture</title><script type="module" src="/fixture.js"></script>');
    if (request.url === '/fixture.js') return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(browserContent);
    if (request.url?.split('?')[0] !== '/api/sync-v2') return response.writeHead(404).end();
    if (fault.api === 'unavailable') return response.writeHead(503, { 'Content-Type': 'application/json' }).end('{}');
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.byteLength;
      if (size > 540000) return response.writeHead(413).end();
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const key of ['authorization', 'content-type']) {
      if (typeof request.headers[key] === 'string') headers.set(key, request.headers[key]);
    }
    const result = await local.dispatch(request.url, {
      method: request.method, headers, body: chunks.length === 0 ? undefined : Buffer.concat(chunks)
    });
    if (fault.api === 'lose-ack' && request.method === 'POST' && request.url === '/api/sync-v2' && result.ok) {
      return; // Let the application timeout after the Worker has actually committed.
    }
    if (fault.api === 'tamper' && request.method === 'GET' && result.ok && request.url === '/api/sync-v2') {
      const json = await result.json();
      if (json.envelope) {
        const item = JSON.parse(json.envelope);
        item.data = (item.data[0] === 'A' ? 'B' : 'A') + item.data.slice(1);
        json.envelope = JSON.stringify(item);
      }
      return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
    }
    return response.writeHead(result.status, Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()));
  } catch {
    return response.writeHead(503).end();
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const url = `http://127.0.0.1:${server.address().port}/`;
const preferredTemp = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Temp', 'opencode');
const profile = await mkdtemp(join(preferredTemp && existsSync(preferredTemp) ? preferredTemp : tmpdir(), 'novo-d1-'));
const browser = spawn(executable, [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });
let socket;
let send;

async function until(check) {
  for (let tries = 0; tries < 100; tries++) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    await wait(100);
  }
  throw new Error('隔离浏览器未就绪');
}

try {
  const endpoint = await until(async () => {
    if (browser.exitCode !== null) throw new Error('隔离 Chromium 启动失败');
    try {
      const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
      return `ws://127.0.0.1:${port}${path}`;
    } catch { return undefined; }
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let next = 0;
  const pending = new Map();
  socket.addEventListener('message', message => {
    const update = JSON.parse(message.data);
    const action = pending.get(update.id);
    if (action) {
      pending.delete(update.id);
      clearTimeout(action.timer);
      if (update.error) action.reject(new Error(update.error.message));
      else action.resolve(update.result);
    }
  });
  send = (method, params, sessionId) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Chromium ${method} 超时`));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });

  const device = async () => (await send('Target.createBrowserContext')).browserContextId;
  const tab = async (browserContextId, options = {}) => {
    const { targetId } = await send('Target.createTarget', { url: appMode ? 'about:blank' : url, browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const run = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? '浏览器测试出错');
      return result.result.value;
    };
    await send('Network.enable', {}, sessionId);
    if (appMode) {
      if (options.mobile) await send('Emulation.setDeviceMetricsOverride', {
        width: 390, height: 844, deviceScaleFactor: 2, mobile: true
      }, sessionId);
      await send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId });
      const path = options.onLoad ? `/application-fixture-${crypto.randomUUID()}` : options.path ?? '/';
      if (options.onLoad) fixtures.set(path, options);
      await send('Page.navigate', { url: new URL(path, url).href }, sessionId);
      await until(async () => { try { return await run(`document.readyState === "complete" && location.pathname === ${JSON.stringify(path)}`); } catch { return false; } });
    } else await until(() => run('!!window.fixture'));
    return {
      run,
      call: (method, ...args) => run(`window.fixture[${JSON.stringify(method)}](...${JSON.stringify(args)})`),
      close: () => send('Target.closeTarget', { targetId }),
      async reload() {
        const start = await run('performance.timeOrigin');
        await send('Page.reload', {}, sessionId);
        await until(async () => {
          try { return await run(`performance.timeOrigin !== ${start} && (${appMode ? 'document.readyState === "complete"' : '!!window.fixture'})`); }
          catch { return false; }
        });
      },
      offline: value => send('Network.emulateNetworkConditions', {
        offline: value, latency: 0, downloadThroughput: -1, uploadThroughput: -1
      }, sessionId)
    };
  };

  if (appMode) {
    const fresh = await tab(await device());
    await until(() => fresh.run("document.body.innerText.includes('已确认总结余')"));
    const summary = await fresh.run(`new Promise((resolve, reject) => {
      const open = indexedDB.open('novoledger-ledger-v1');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const get = db.transaction('ledger').objectStore('ledger').get('main');
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => {
          const work = get.result;
          const data = JSON.parse(work.json);
          db.close();
          resolve({ noLegacy: localStorage.getItem('finance-workbench-v1') === null,
            noCloudBinding: work.account === null && work.anchor === null,
            months: Object.keys(data.months).length, sources: data.incomeSources.length,
            events: data.incomeEvents.length, pockets: data.pockets.length,
            transfers: data.transfers.length, expenses: data.expenseRecords.length });
        };
      };
    })`);
    assert.deepEqual(summary, { noLegacy: true, noCloudBinding: true, months: 1, sources: 0, events: 0, pockets: 0, transfers: 0, expenses: 0 });
    await fresh.close();
    await runAppTests({ local, device, tab, until, fault });
  } else {
  const firstDevice = await device();
  const secondDevice = await device();
  const a = await tab(firstDevice);
  const a2 = await tab(firstDevice);
  const b = await tab(secondDevice);
  const token = await a.call('newAccessToken');
  const secret = 'isolated-browser-encryption-fixture-only';
  const connect = (page, password = secret) => page.call('connect', token, password);
  await Promise.all([connect(a), connect(a2), connect(b)]);

  await a.call('edit', 1);
  assert.equal((await a.call('submit')).revision, 1);
  await b.call('review');
  await b.call('resolve', 'cloud', await b.call('view'));
  await Promise.all([a.call('edit', 11), a2.call('edit', 22)]);
  assert.deepEqual((await a.call('view')).local, [1, 11, 22]);
  console.log('PASS: 同源两标签并发记账，IndexedDB 保留两笔');

  await b.call('edit', 33);
  const results = await Promise.all([a.call('submit'), b.call('submit')]);
  assert.deepEqual(results.map(result => result.kind).sort(), ['committed', 'conflict']);
  const loser = results[0].kind === 'conflict' ? a : b;
  let preview = await loser.call('view');
  assert.notDeepEqual(preview.local, preview.remote);
  assert.ok(preview.pending);
  const originalPending = preview.pending;
  await loser.call('edit', 77);
  await assert.rejects(loser.call('resolve', 'cloud', preview), /账本已变化/);
  preview = await loser.call('view');
  assert.ok(preview.local.includes(77));
  assert.equal(preview.pending, originalPending);
  await loser.call('failBackup', true);
  await assert.rejects(loser.call('resolve', 'cloud', preview), /合成备份写入失败/);
  assert.deepEqual(await loser.call('view'), preview);
  await loser.call('failBackup', false);
  await loser.call('resolve', 'local', preview);
  const resolved = await loser.call('view');
  assert.deepEqual(resolved.local, preview.local);
  assert.ok(resolved.backups.some(copy => JSON.stringify(copy) === JSON.stringify(preview.remote)));
  assert.ok(resolved.backups.some(copy => !copy.includes(77) && JSON.stringify(copy) !== JSON.stringify(preview.remote)));
  assert.equal((await loser.call('submit')).revision, 3);
  console.log('PASS: 双设备同基准写入只成功一次；备份失败不覆盖，冲突两份可恢复');

  await loser.call('restore', 1);
  assert.deepEqual((await loser.call('view')).local, [1]);
  assert.equal((await loser.call('submit')).revision, 4);
  console.log('PASS: 恢复历史快照创建新版本，版本号不回拨');

  const offlineDevice = await device();
  let offline = await tab(offlineDevice);
  const anotherToken = await offline.call('newAccessToken');
  await offline.call('connect', anotherToken, secret);
  const old = fixtureLedger();
  delete old.expenseRecords;
  old.months['2020-01'].categories[0].actual = 9;
  const encryptedLegacy = await encryptLedger(JSON.stringify(old), 'synth-legacy');
  await offline.call('legacy', encryptedLegacy, 'synth-legacy');
  await offline.offline(true);
  await offline.call('edit', 44);
  await assert.rejects(offline.call('submit'));
  const queued = await offline.call('view');
  assert.deepEqual(queued.local, [9, 44]);
  assert.ok(queued.pending);
  await offline.close();
  offline = await tab(offlineDevice);
  await offline.call('connect', anotherToken, secret);
  assert.equal((await offline.call('view')).pending, queued.pending);
  await offline.call('mode', 'lose-ack');
  await assert.rejects(offline.call('submit'), /响应超时/);
  assert.equal((await offline.call('view')).pending, queued.pending);
  await offline.reload();
  await offline.call('connect', anotherToken, secret);
  await offline.call('review');
  assert.equal((await offline.call('view')).remote, null);
  await offline.call('edit', 55);
  assert.deepEqual(await offline.call('submit'), { kind: 'committed', revision: 1, replay: true });
  assert.deepEqual((await offline.call('view')).local, [9, 44, 55]);
  assert.equal((await offline.call('view')).dirty, true);
  assert.equal((await offline.call('submit')).revision, 2);
  assert.deepEqual((await offline.call('history')).map(item => item.revision), [2, 1]);
  console.log('PASS: 旧加密格式离线导入、断网/关页重开、服务端成功但响应超时、同请求恢复及新编辑保留');

  const previous = await loser.call('view');
  const attackerFixture = await tab(await device());
  await attackerFixture.call('connect', token, 'different-fixture-secret-only');
  await assert.rejects(attackerFixture.call('review'));
  assert.equal((await attackerFixture.call('view')).remote, null);
  await loser.call('mode', 'tamper');
  await assert.rejects(loser.call('review'));
  assert.deepEqual(await loser.call('view'), previous);
  console.log('PASS: 错误口令和损坏密文不进入恢复流程');
  console.log('D1 browser isolation tests passed');
  }
} finally {
  try { if (send) await send('Browser.close'); } catch { /* browser may already be closed */ }
  socket?.close();
  if (browser.exitCode === null) browser.kill();
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await local?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => undefined);
}
