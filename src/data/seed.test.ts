import { describe, expect, it } from 'vitest';
import { createEmptyLedger, emptyMonth } from './seed';

describe('空白账本', () => {
  it('仅创建空月份框架，不预填资金、分录、预算或历史', () => {
    expect(createEmptyLedger('2026-11')).toEqual({
      version: 1, months: { '2026-11': { key: '2026-11', label: '2026年11月', status: 'draft', categories: [], funding: [] } },
      incomeSources: [], incomeEvents: [], sourcePools: {}, pockets: [], corrections: [], expenseRecords: [],
      transfers: [], summaryBalance: 0, nextMonthCharges: {}, history: []
    });
  });
  it('不同初始化之间不共享可变状态', () => {
    const local = createEmptyLedger('2026-11');
    local.months['2026-11'].categories.push({ id: 'a', budget: 5, actual: 0, name: '测试分类' });
    expect(createEmptyLedger('2026-11').months['2026-11'].categories).toEqual([]);
  });
  it('拒绝无效月份', () => {
    for (const key of ['2026-00', '2026-13', '2026-1', '0000-01', '__proto__']) expect(() => emptyMonth(key)).toThrow();
  });
});
