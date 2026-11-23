import { describe, expect, it } from 'vitest';
import { createEmptyLedger as createSeedState } from '../data/seed';
import { prepareMigration, migrationFence, legacyLedgerKey } from './ledgerDb';

function storage() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
}

describe('旧账本迁移前置保护', () => {
  it('保持源封套字节完整，并以它建立经校验的候选账本', () => {
    const local = storage();
    const ledger = { ...createSeedState(), summaryBalance: 314 };
    const raw = JSON.stringify({ state: ledger, version: 0 }, null, 4);
    local.setItem(legacyLedgerKey, raw);
    const prepared = prepareMigration(local, createSeedState());
    expect(prepared.raw).toBe(raw);
    expect(JSON.parse(prepared.json)).toEqual(ledger);
    expect(local.getItem(migrationFence)).not.toBeNull();
    expect(local.getItem(legacyLedgerKey)).toBe(raw);
  });

  it('失败时保留旧字节；有围栏的缺失数据库不能把旧副本自动升级', () => {
    const local = storage();
    local.setItem(legacyLedgerKey, '{broken');
    expect(() => prepareMigration(local, createSeedState())).toThrow();
    expect(local.getItem(legacyLedgerKey)).toBe('{broken');
    expect(local.getItem(migrationFence)).toBeNull();
    local.setItem(legacyLedgerKey, JSON.stringify({ state: createSeedState(), version: 0 }));
    local.setItem(migrationFence, '1');
    expect(() => prepareMigration(local, createSeedState())).toThrow(/恢复/);
  });
});
