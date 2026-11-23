import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { provisionFixtureOwner } from './functions/api/enrollment.js';
import { encryptLedger } from '../../src/lib/sync.ts';
import { fixtureLedger } from './fixture.js';
import { enrollOwner } from './enroll-test-owner.mjs';

const legacyKey = 'finance-workbench-v1';
const dbName = 'novoledger-ledger-v1';
function ledger() {
  const data = fixtureLedger();
  data.months = Object.fromEntries(['2026-08', '2026-09'].map(key => [key, {
    key, label: `测试 ${key}`, funding: [], status: 'draft',
    categories: [{ id: `category-${key}`, name: `合成分类 ${key}`, budget: 1000, actual: key.endsWith('08') ? 12 : 0 }]
  }]));
  data.expenseRecords = [{ id: 'migrated-record', date: '2026-08-03', amount: 12, kind: 'expense', categoryId: 'category-2026-08' }];
  data.incomeSources = [{ id: 'synthetic-source', name: '测试来源', kind: 'salary' }];
  data.incomeEvents = [{ id: 'synthetic-event', sourceId: 'synthetic-source', title: '测试到账',
    plannedAmount: 200, expectedAt: '2026-08-04', status: 'pending', edits: [] }];
  data.sourcePools = { 'synthetic-source': 0 };
  data.pockets = [{ id: 'synthetic-pocket', name: '测试荷包', balance: 20, isActive: true }];
  data.transfers = [{ id: 'synthetic-transfer', monthKey: '2026-08', kind: 'source-to-pocket',
    fromId: 'synthetic-source', toId: 'synthetic-pocket', amount: 50, date: '2026-08-05', status: 'planned' }];
  return data;
}

const setup = (raw, mode = '') => `
  if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
    if (!localStorage.getItem(${JSON.stringify(legacyKey)})) localStorage.setItem(${JSON.stringify(legacyKey)}, ${JSON.stringify(raw)});
    const create = URL.createObjectURL;
    URL.createObjectURL = function(blob) { window.latestExport = blob.text(); return create.call(this,blob); };
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(...args) {
      if (this.name === 'backups' && (window.failBackup || ${JSON.stringify(mode)} === 'migration-failure')) {
        throw new DOMException('synthetic quota', 'QuotaExceededError');
      }
      return original.apply(this,args);
    }
  }`;

async function read(tab, store = 'ledger') {
  return tab.run(`new Promise((resolve, reject) => {
    const request = indexedDB.open(${JSON.stringify(dbName)});
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const object = db.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)});
      const value = ${store === 'ledger' ? "object.get('main')" : 'object.getAll()'};
      value.onerror = () => { db.close(); reject(value.error); };
      value.onsuccess = () => { db.close(); resolve(value.result ?? null); };
    }
  })`);
}

export async function runAppTests({ local, device, tab, until, fault }) {
  async function text(page, phrase) {
    await until(() => page.run(`document.body.innerText.includes(${JSON.stringify(phrase)})`));
  }
  async function click(page, names, selector = 'button') {
    const list = Array.isArray(names) ? names : [names];
    const search = `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el =>
      el.getClientRects().length && !el.disabled &&
      ${JSON.stringify(list)}.includes(el.getAttribute('aria-label') || el.textContent.trim()))`;
    await until(() => page.run(`!!(${search})`));
    await page.run(`(${search}).click()`);
  }
  async function fill(page, selector, value) {
    await until(() => page.run(`!!document.querySelector(${JSON.stringify(selector)})`));
    await page.run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true}));
    })()`);
  }
  async function file(page, selector, json, name = 'synthetic.json') {
    await page.run(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      const files = new DataTransfer();
      files.items.add(new File([${JSON.stringify(json)}],${JSON.stringify(name)},{type:'application/json'}));
      input.files = files.files;
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
  }
  async function waitLedger(page, predicate) {
    return until(async () => {
      const value = await read(page);
      const data = value?.json && JSON.parse(value.json);
      return data && predicate(data, value) ? { data, work: value } : false;
    });
  }
  const nav = (page, names) => click(page, names, 'nav button');
  const blank = await tab(await device());
  await text(blank, '本月还没有预算分类');
  const pristine = await read(blank);
  const freshData = JSON.parse(pristine.json);
  assert.equal(pristine.account, null);
  assert.equal(await blank.run(`localStorage.getItem(${JSON.stringify(legacyKey)})`), null);
  assert.equal(Object.keys(freshData.months).length, 1);
  assert.deepEqual(Object.values(freshData.months).flatMap(month => month.categories), []);
  for (const field of ['incomeSources', 'incomeEvents', 'pockets', 'transfers', 'expenseRecords', 'history']) {
    assert.deepEqual(freshData[field], []);
  }
  assert.equal(await blank.run("document.body.innerText.includes('示例交通支出')"), false);
  await click(blank, '查看虚构示例');
  await text(blank, '示例交通支出');
  await click(blank, '返回自己的账本');
  assert.deepEqual(await read(blank), pristine);
  assert.equal(await blank.run("performance.getEntriesByType('resource').some(r=>new URL(r.name).pathname.startsWith('/api/'))"), false);
  await nav(blank, ['月度规划', '规划']);
  await click(blank, '新建月份');
  await fill(blank, '#new-month-key', '2026-04');
  await click(blank, '创建并打开');
  await waitLedger(blank, d => !!d.months['2026-04']);
  await nav(blank, '记账');
  await fill(blank, '#expense-date', '2026-05-08');
  await fill(blank, '#expense-category', '__add__');
  await fill(blank, '#new-category-name', '首次测试分类');
  await click(blank, '新增', '.modal button');
  await waitLedger(blank, d => d.months['2026-05']?.categories.length === 1);
  await fill(blank, '#expense-note', 'first-cold-start');
  await fill(blank, '#expense-amount', '23');
  await click(blank, '保存记录');
  await waitLedger(blank, d => d.expenseRecords[0]?.amount === 23 && d.months['2026-05'].categories[0].actual === 23);
  await nav(blank, ['数据备份', '备份']);
  await click(blank, '重置为空白账本');
  await click(blank, '再次点击确认重置');
  await waitLedger(blank, d => d.expenseRecords.length === 0 && !d.months['2026-05']);
  assert.ok((await read(blank, 'backups')).some(copy => JSON.parse(copy.json).expenseRecords[0]?.amount === 23));
  console.log('PASS: 全新浏览器空白，示例只读不联网；可创建月份、首笔记账并备份后重置');

  const raw = JSON.stringify({ state: ledger(), version: 0 }, null, 2);
  const deviceA = await device();
  const first = await tab(deviceA, { onLoad: setup(raw) });
  await text(first, '已确认总结余');
  assert.ok(isDeepStrictEqual(JSON.parse((await read(first)).json), ledger()), '迁移后的账本必须与合成旧账本逐字段一致');
  assert.ok((await read(first, 'backups')).some(copy => copy.json === raw));
  assert.equal(await first.run(`localStorage.getItem('${legacyKey}')`), raw);

  const failed = await tab(await device(), { onLoad: setup(raw, 'migration-failure') });
  await text(failed, '本机账本未打开');
  assert.equal(await read(failed), null);
  assert.equal(await failed.run(`localStorage.getItem('${legacyKey}')`), raw);
  assert.deepEqual(await read(failed, 'backups'), []);

  const healthyRecovery = await tab(await device(), { onLoad: setup('{broken') });
  await text(healthyRecovery, '本机账本未打开');
  await file(healthyRecovery, 'input[type=file]', raw);
  await click(healthyRecovery, '确认恢复主账本');
  assert.deepEqual((await waitLedger(healthyRecovery, data => data.expenseRecords.length === 1)).data, ledger());
  assert.ok((await read(healthyRecovery, 'backups')).some(copy => copy.json === '{broken'));
  // Deliberately damage only the synthetic IndexedDB copy.
  await healthyRecovery.run(`new Promise((resolve,reject) => {
    const open = indexedDB.open(${JSON.stringify(dbName)});
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('ledger','readwrite');
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.objectStore('ledger').put({json:'broken-db-fixture'},'main');
    };
  })`);
  await healthyRecovery.reload();
  await text(healthyRecovery, '本机账本未打开');
  assert.deepEqual(await read(healthyRecovery), { json: 'broken-db-fixture' });
  await file(healthyRecovery, 'input[type=file]', raw);
  await click(healthyRecovery, '确认恢复主账本');
  await waitLedger(healthyRecovery, data => data.expenseRecords.length === 1);
  assert.ok((await read(healthyRecovery, 'backups')).some(copy => copy.json.includes('broken-db-fixture')));
  console.log('PASS: 正式页面迁移逐字段一致；备份写入失败无主账本/未改旧原文；损坏旧副本可显式恢复');

  async function enter(page, date, amount, note) {
    await nav(page, '记账');
    if (date.startsWith('2026-09')) await fill(page, 'select[aria-label="选择月份"]', '2026-09');
    await fill(page, '#expense-date', date);
    await fill(page, '#expense-note', note);
    await fill(page, '#expense-amount', String(amount));
    await click(page, '保存记录');
    await waitLedger(page, d => d.expenseRecords.some(record => record.note === note && record.amount === amount));
  }
  await enter(first, '2026-08-09', 21, 'browser-create');
  await click(first, '编辑记录', '.todo-item:first-child button[aria-label="编辑记录"]');
  await fill(first, '#edit-amount', '24');
  await click(first, '保存', '.modal button');
  await waitLedger(first, d => d.months['2026-08'].categories[0].actual === 36);
  await click(first, '删除记录', '.todo-item:first-child button[aria-label="删除记录"]');
  await waitLedger(first, d => d.expenseRecords.length === 1 && d.months['2026-08'].categories[0].actual === 12);
  await nav(first, ['资金来源', '资金']);
  await click(first, '确认到账');
  await click(first, '确认', '.modal button');
  await waitLedger(first, d => d.sourcePools['synthetic-source'] === 200);
  await nav(first, ['小荷包', '荷包']);
  await click(first, '执行');
  await waitLedger(first, d => d.pockets[0].balance === 70 && d.sourcePools['synthetic-source'] === 150 && d.summaryBalance === 150);
  await nav(first, ['月度规划', '规划']);
  await first.run(`document.querySelector('input[aria-label="合成分类 2026-08预算"]').focus()`);
  await fill(first, 'input[aria-label="合成分类 2026-08预算"]', '900');
  await first.run('document.activeElement.blur()');
  await waitLedger(first, d => d.months['2026-08'].categories[0].budget === 900);
  await click(first, '确认结余');
  const finalized = (await waitLedger(first, d => d.months['2026-08'].status === 'finalized')).data;
  assert.equal(finalized.months['2026-08'].surplus, 888);
  assert.equal(finalized.summaryBalance, 1038);
  await nav(first, '记录');
  await text(first, '结余完成');
  await first.reload();
  await text(first, '已确认总结余');
  assert.deepEqual(JSON.parse((await read(first)).json), finalized);
  console.log('PASS: 记账增改删、到账确认、来源池划扣、预算修改、月结与重新加载，核对余额和明细');

  const a2 = await tab(deviceA, { onLoad: setup(raw) });
  await Promise.all([
    enter(first, '2026-09-03', 10, 'tab-a'), enter(a2, '2026-09-03', 15, 'tab-b')
  ]);
  await waitLedger(first, d => d.months['2026-09'].categories[0].actual === 25);
  await a2.run(`localStorage.setItem('${legacyKey}', '${JSON.stringify({ state: { ...ledger(), summaryBalance: 6666 } })}')`);
  await text(first, '主账本未改变');
  assert.equal(JSON.parse((await read(first)).json).summaryBalance, 1038);
  console.log('PASS: 多标签并发累计，旧标签写入仅留在旧副本');

  const secret = 'browser-synthetic-independent-encryption';
  const backup = page => nav(page, ['数据备份', '备份']);
  const pair = async (page, token) => {
    await backup(page);
    await fill(page, '#d1-token', token);
    await fill(page, '#d1-secret', secret);
    await click(page, '解锁云同步');
    await text(page, '已解锁本页同步');
  };
  await backup(first);
  await click(first, '首次使用：创建云端账本', 'summary');
  await click(first, '生成管理员令牌');
  await until(() => first.run("!!document.querySelector('#owner-registration')?.value"));
  const registration = await first.run("document.querySelector('#owner-registration').value");
  await click(first, '已私下保存管理员令牌', 'label');
  await fill(first, '#d1-secret', secret);
  await fill(first, '#d1-secret-again', secret);
  await click(first, '解锁云同步');
  await text(first, '设备令牌尚未登记');
  const register = (sql, params) => local.db.prepare(sql).bind(...params).run();
  assert.equal(await enrollOwner(register, registration), 'created');
  await click(first, '解锁云同步');
  await text(first, '已解锁本页同步');
  assert.equal(await first.run(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='提交本机修改').disabled`), true);
  await click(first, '检查云端');
  await text(first, '云端还没有同步版本');
  await click(first, '提交本机修改');
  await waitLedger(first, (d, w) => w.anchor?.revision === 1 && !w.dirty);
  await fill(first, '#device-label', 'Synthetic phone');
  await click(first, '发放设备令牌');
  await text(first, '已发放新令牌');
  const token = await first.run("document.querySelector('#issued-token').value");
  const deviceB = await device();
  let mobile = await tab(deviceB, { onLoad: setup(raw), mobile: true });
  assert.equal(await mobile.run('innerWidth'), 390);
  await pair(mobile, token);
  await click(mobile, '检查云端');
  await text(mobile, '本机与云端不一致');
  await click(mobile, '选用云端');
  await click(mobile, '确认执行', '.modal button');
  await waitLedger(mobile, (d, w) => w.anchor?.revision === 1 && d.summaryBalance === 1038);
  await Promise.all([
    enter(first, '2026-09-06', 30, 'device-a'), enter(mobile, '2026-09-07', 40, 'device-b')
  ]);
  await Promise.all([backup(first), backup(mobile)]);
  await Promise.all([click(first, '提交本机修改'), click(mobile, '提交本机修改')]);
  const cloud = await until(async () => {
    const [one, two] = await Promise.all([read(first), read(mobile)]);
    return one.conflict || two.conflict ? { one, two } : false;
  });
  const loser = cloud.one.conflict ? first : mobile;
  const conflict = cloud.one.conflict ?? cloud.two.conflict;
  assert.equal(conflict.snapshot.revision, 2);
  const beforeFailure = await read(loser);
  assert.notEqual(beforeFailure.json, conflict.json);
  await loser.run('window.failBackup = true');
  await click(loser, '保留本机');
  await click(loser, '确认执行', '.modal button');
  await text(loser, 'synthetic quota');
  assert.deepEqual(await read(loser), beforeFailure);
  await loser.run('window.failBackup = false');
  await click(loser, '确认执行', '.modal button');
  await waitLedger(loser, (d, w) => !w.conflict && w.anchor?.revision === 2 && w.dirty);
  assert.ok((await read(loser, 'backups')).some(copy => copy.json === conflict.json));
  await click(loser, '提交本机修改');
  await waitLedger(loser, (d, w) => w.anchor?.revision === 3);
  await click(loser, '读取云端历史');
  await text(loser, '版本 1');
  const versionButton = '.todo-item:has(span) button';
  const showHistory = () => loser.run(`Array.from(document.querySelectorAll(${JSON.stringify(versionButton)})).find(el =>
    el.textContent.trim() === '预览并恢复' && el.parentElement.innerText.trim().startsWith('版本 1')).click()`);
  const beforePreview = await read(loser);
  const backupsBeforePreview = await read(loser, 'backups');
  await showHistory();
  await text(loser, '恢复预览：云端版本 1');
  await text(loser, '恢复后不在当前账本：1 笔');
  assert.ok(await loser.run(`(/device-[ab]/).test(document.querySelector('.modal').innerText)`));
  assert.deepEqual(await read(loser), beforePreview);
  assert.deepEqual(await read(loser, 'backups'), backupsBeforePreview);
  const otherTab = loser === first ? a2 : await tab(deviceB, { mobile: true });
  await enter(otherTab, '2026-09-08', 5, 'edited-after-preview');
  const afterOtherTab = (await waitLedger(loser, d => d.expenseRecords.some(record => record.note === 'edited-after-preview'))).work;
  await click(loser, '备份当前账本并恢复草稿', '.modal button');
  await text(loser, '预览后本机账本或同步状态已变化');
  assert.deepEqual(await read(loser), afterOtherTab);
  assert.deepEqual(await read(loser, 'backups'), backupsBeforePreview);
  await click(loser, '取消', '.modal button');
  await showHistory();
  await text(loser, '恢复后不在当前账本：2 笔');
  await loser.run('window.failBackup = true');
  await click(loser, '备份当前账本并恢复草稿', '.modal button');
  await text(loser, 'synthetic quota');
  assert.deepEqual(await read(loser), afterOtherTab);
  await loser.run('window.failBackup = false');
  await click(loser, '备份当前账本并恢复草稿', '.modal button');
  await waitLedger(loser, (d, w) => d.months['2026-09'].categories[0].actual === 25 && w.anchor?.revision === 3 && w.dirty);
  assert.ok((await read(loser, 'backups')).some(copy => copy.reason === '恢复历史前' && copy.json === afterOtherTab.json));
  await click(loser, '导出 JSON', 'section.card:has(h3) button');
  assert.equal(JSON.parse(await loser.run('window.latestExport')).months['2026-08'].surplus, 888);
  assert.deepEqual(JSON.parse(await loser.run('window.latestExport')), JSON.parse((await read(loser)).json));
  await click(loser, '提交本机修改');
  await waitLedger(loser, (d, w) => w.anchor?.revision === 4 && !w.dirty && d.summaryBalance === 1038);
  await click(loser, '读取云端历史');
  await text(loser, '版本 4');
  await text(loser, '版本 3');
  console.log('PASS: 双设备竞争、历史差异预览不写入、旧预览拒绝、备份失败不覆盖、恢复后提交新版本和完整 JSON 导出');

  const deviceC = await device();
  let retry = await tab(deviceC, { onLoad: setup(raw) });
  const third = await provisionFixtureOwner(local.db);
  await pair(retry, third.token);
  const cipher = await encryptLedger(JSON.stringify(ledger()), 'synthetic-v1');
  await file(retry, 'input[type=file]', cipher);
  await text(retry, '这是旧版加密副本');
  await file(retry, '#legacy-envelope', raw);
  await text(retry, '不是可识别的旧加密副本');
  await file(retry, '#legacy-envelope', cipher);
  await fill(retry, '#legacy-code', 'wrong-v1-code');
  await click(retry, '解密并预览旧备份');
  await text(retry, '旧同步码不匹配');
  assert.deepEqual(JSON.parse((await read(retry)).json), ledger());
  await fill(retry, '#legacy-code', 'synthetic-v1');
  await click(retry, '解密并预览旧备份');
  await click(retry, '备份本机并恢复旧账本', '.modal button');
  await text(retry, '旧备份已恢复至本机');
  await click(retry, '检查云端');
  await text(retry, '云端还没有同步版本');
  await retry.run('navigator.serviceWorker.ready.then(() => true)');
  await until(() => retry.run('!!navigator.serviceWorker.controller'));
  await retry.offline(true);
  await enter(retry, '2026-09-11', 59, 'offline-test');
  await backup(retry);
  await click(retry, '提交本机修改');
  const queued = (await waitLedger(retry, (d, w) => !!w.pending)).work.pending;
  await text(retry, 'Failed to fetch');
  await click(retry, '导出待发账本副本');
  assert.deepEqual(JSON.parse(await retry.run('window.latestExport')), JSON.parse(queued.json));
  await retry.close();
  retry = await tab(deviceC, { onLoad: setup(raw) });
  assert.deepEqual((await read(retry)).pending, queued);
  await pair(retry, third.token);
  fault.api = 'unavailable';
  await click(retry, '重试待发请求');
  await text(retry, '503');
  assert.deepEqual((await read(retry)).pending, queued);
  fault.api = 'lose-ack';
  await click(retry, '重试待发请求');
  await text(retry, '响应超时');
  assert.deepEqual((await read(retry)).pending, queued);
  fault.api = '';
  await retry.reload();
  await pair(retry, third.token);
  await click(retry, '重试待发请求');
  await text(retry, '原请求收据');
  await waitLedger(retry, (d, w) => w.anchor?.revision === 1 && !w.pending && d.months['2026-09'].categories[0].actual === 59);
  fault.api = 'tamper';
  const beforeDamaged = await read(retry);
  await click(retry, '检查云端');
  await text(retry, '云端快照无法解密');
  assert.deepEqual(await read(retry), beforeDamaged);
  fault.api = '';
  console.log('PASS: 旧加密账本离线解密、断网记账、关页重开，503、超时已提交、原收据恢复和密文损坏');

  const wrong = await tab(await device(), { onLoad: setup(raw) });
  await backup(wrong);
  await fill(wrong, '#d1-token', third.token);
  await fill(wrong, '#d1-secret', 'incorrect-synthetic-encryption-key');
  await click(wrong, '解锁云同步');
  await text(wrong, '已解锁本页同步');
  const beforeWrongKey = await read(wrong);
  await click(wrong, '检查云端');
  await text(wrong, '云端快照无法解密');
  assert.deepEqual(await read(wrong), beforeWrongKey);

  fault.oldWorker = true;
  const pwa = await tab(await device(), { onLoad: setup(raw), path: '/legacy-shell' });
  await pwa.run("navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(()=>true)");
  await until(() => pwa.run('!!navigator.serviceWorker.controller'));
  assert.ok((await pwa.run('caches.keys()')).includes('finance-workbench-v3'));
  fault.oldWorker = false;
  await pwa.run("navigator.serviceWorker.getRegistration('/').then(r => r.update()).then(()=>true)");
  await until(() => pwa.run("caches.keys().then(keys=>keys.includes('novoledger-idb-v6')&&!keys.includes('finance-workbench-v3')&&!keys.includes('novoledger-idb-v5'))"));
  assert.ok(await pwa.run(`caches.open('novoledger-idb-v6').then(c=>c.keys())
    .then(requests=>requests.every(r=>!new URL(r.url).pathname.startsWith('/api/'))) `));
  await pwa.offline(true);
  await pwa.run("location.href = '/'");
  await text(pwa, '已确认总结余');
  await enter(pwa, '2026-09-05', 13, 'pwa-offline');
  await waitLedger(pwa, d => d.months['2026-09'].categories[0].actual === 13);
  console.log('PASS: 旧 Service Worker 缓存替换，正式应用壳可离线加载并写入新账本');
}
