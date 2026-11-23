import { describe, expect, it } from 'vitest';
import { createSeedState } from '../test/ledgerFixture';
import { validateImport } from './accounting';
import { createLedgerPersistence, listRecoveryCopies } from './ledgerPersistence';
import { createCloudReview } from './cloudReview';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }
  };
}

describe('账本恢复', () => {
  it('拒绝缺字段、错误金额和无效分类引用，不接受可覆盖动作的额外字段', () => {
    const seed = createSeedState();
    expect(() => validateImport({ ...seed, transfers: undefined })).toThrow();
    expect(() => validateImport({ ...seed, summaryBalance: '100' })).toThrow();
    expect(() => validateImport({ ...seed, expenseRecords: [
      { id: 'r', date: '2023-04-05', categoryId: 'missing', amount: 1, kind: 'expense' }
    ] })).toThrow();
    expect(() => validateImport({ ...seed, importJson: null })).toThrow();
  });

  it('旧备份补录不丢分类实际值，重复迁移不新增记录', () => {
    const seed = createSeedState();
    seed.months['2023-04'].categories[0].actual = 123;
    const { expenseRecords: _records, ...old } = seed;
    const restored = validateImport(old);
    expect(restored.expenseRecords[0].amount).toBe(123);
    expect(restored.months['2023-04'].categories[0].actual).toBe(123);
    expect(validateImport(restored)).toEqual(restored);
    expect(validateImport(old)).toEqual(restored);
  });

  it('多标签页写入不静默覆盖，冲突分支与连续记账均可恢复', () => {
    const storage = memoryStorage();
    const first = createLedgerPersistence(storage, 'one');
    const second = createLedgerPersistence(storage, 'two');
    const base = createSeedState();
    expect(first.save({ ...base, summaryBalance: 1 })).toBe('saved');
    expect(second.save({ ...base, summaryBalance: 2 })).toBe('branch');
    expect(second.save({ ...base, summaryBalance: 3 })).toBe('branch');
    expect(createLedgerPersistence(storage, 'three').load()?.summaryBalance).toBe(1);
    expect(listRecoveryCopies(storage).map(copy => JSON.parse(copy.json).summaryBalance).sort()).toEqual([1, 3]);
  });

  it('覆盖前保留多版本，存储报错不会替换主账本', () => {
    const storage = memoryStorage();
    const persistence = createLedgerPersistence(storage, 'one');
    const base = createSeedState();
    persistence.save(base);
    persistence.backup(base, '导入前');
    persistence.backup({ ...base, summaryBalance: 1 }, '重置前');
    const saved = storage.setItem;
    storage.setItem = () => { throw new Error('quota'); };
    expect(() => persistence.save({ ...base, summaryBalance: 2 })).toThrow();
    storage.setItem = saved;
    expect(persistence.load()).toEqual(base);
    expect(listRecoveryCopies(storage).filter(copy => copy.label !== '标签页工作副本')).toHaveLength(2);
  });

});

describe('旧 KV 只读同步护栏', () => {
  it('并发检查不同步执行，也不会产生任何上传；离线失败后可以重试', async () => {
    let online = false;
    let reads = 0;
    const local = JSON.stringify(createSeedState());
    const review = createCloudReview({
      local: () => local,
      read: async () => {
        reads++;
        if (!online) throw new Error('offline');
        return local;
      },
      restore: () => { throw new Error('不应导入'); }
    });
    const first = review.check('test');
    await expect(review.check('test')).rejects.toThrow(/进行中/);
    await expect(first).rejects.toThrow('offline');
    online = true;
    await expect(review.check('test')).resolves.toMatchObject({ kind: 'same' });
    expect(reads).toBe(2);
  });

  it('快速连续记账后拒绝应用已审阅的旧快照；导入失败不报告成功', async () => {
    const seed = createSeedState();
    let local = JSON.stringify(seed);
    const remote = { ...seed, summaryBalance: 9 };
    let accepted = false;
    const review = createCloudReview({
      local: () => local,
      read: async () => JSON.stringify(remote),
      restore: () => accepted
    });
    const old = await review.check('test');
    local = JSON.stringify({ ...seed, summaryBalance: 1 });
    local = JSON.stringify({ ...seed, summaryBalance: 2 });
    await expect(review.restore(old)).rejects.toThrow(/已变化/);
    const current = await review.check('test');
    await expect(review.restore(current)).rejects.toThrow(/恢复失败/);
    accepted = true;
    await expect(review.restore(current)).resolves.toBe(true);
  });

  it('拉取期间继续记账时不生成可恢复的旧快照，损坏输入也不进入恢复流程', async () => {
    const seed = createSeedState();
    let local = JSON.stringify(seed);
    let response = JSON.stringify({ ...seed, summaryBalance: 5 });
    let changed = true;
    const review = createCloudReview({
      local: () => local,
      async read() {
        if (changed) local = JSON.stringify({ ...seed, summaryBalance: 2 });
        return response;
      },
      restore: () => { throw new Error('不应恢复'); }
    });
    await expect(review.check('test')).rejects.toThrow(/检查期间/);
    changed = false;
    response = '{"version":1}';
    await expect(review.check('test')).rejects.toThrow(/无效/);
  });

  it('重复读取已恢复的快照不会再导入，字段顺序不影响比较', async () => {
    const seed = createSeedState();
    const { summaryBalance: _balance, ...rest } = seed;
    const remote = { summaryBalance: 5, ...rest };
    let local = JSON.stringify(seed);
    let restores = 0;
    const review = createCloudReview({
      local: () => local,
      read: async () => JSON.stringify(remote),
      restore: json => {
        restores++;
        local = JSON.stringify({ ...seed, ...JSON.parse(json) });
        return true;
      }
    });
    const pending = await review.check('test');
    await review.restore(pending);
    await expect(review.restore(pending)).rejects.toThrow(/重新检查/);
    await expect(review.check('test')).resolves.toEqual({ kind: 'same' });
    expect(restores).toBe(1);
  });
});
