import { afterAll, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureLedger } from './fixture.js';

let temp: string | undefined;
afterAll(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });

it('离线工具比较普通与旧封套并不输出明细；对损坏副本失败关闭', async () => {
  temp = await mkdtemp(join(tmpdir(), 'novoledger-compare-test-'));
  const active = fixtureLedger();
  active.expenseRecords = [{ id: 'test-entry', date: '2020-01-01', amount: 5.67, categoryId: 'test-category',
    kind: 'expense', note: 'synthetic-private-note' }];
  const original = join(temp, 'a.json'), legacy = join(temp, 'b.json'), invalid = join(temp, 'bad.json');
  await Promise.all([
    writeFile(original, JSON.stringify(active)),
    writeFile(legacy, JSON.stringify({ state: active, version: 0 }, null, 2)),
    writeFile(invalid, new Uint8Array([0xff]))
  ]);
  const run = (right: string) => spawnSync(process.execPath, ['tools/compare-ledger-backups.mjs', original, right], { encoding: 'utf8', timeout: 10000 });
  const compared = run(legacy);
  expect(compared.status).toBe(0);
  expect(compared.stdout).toMatch(/规范内容一致/);
  expect(compared.stdout).toContain('5.67 元');
  expect(compared.stdout).not.toContain('synthetic-private-note');
  const failed = run(invalid);
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain('第 2 份无法读取或未通过账本结构校验');
}, 20000);
