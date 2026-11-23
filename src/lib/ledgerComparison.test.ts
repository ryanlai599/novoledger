import { expect, it } from 'vitest';
import { createEmptyLedger } from '../data/seed';
import { compareLedgers } from './ledgerComparison';
import { canonicalLedgerJson } from './ledgerSchema';
import type { ExpenseRecord } from '../types';

const backup = () => {
  const state = createEmptyLedger('2026-11');
  state.months['2026-11'].categories.push({ id: 'c', name: '合成分类', budget: 100, actual: 0 });
  return state;
};
const expense = (id: string, amount: number): ExpenseRecord => ({
  id, date: '2026-11-01', kind: 'expense', amount, categoryId: 'c', note: `synthetic-private-note-${id}`
});

it('预览能识别恢复后三笔变两笔、离线记录和预算差异', () => {
  const target = backup();
  target.expenseRecords.push(expense('desktop', 12.34), expense('phone', 23.45));
  const current = structuredClone(target);
  current.expenseRecords.push(expense('offline', 5.67));
  current.months['2026-11'].categories[0].budget = 101;
  const diff = compareLedgers(current, target);
  expect(diff.current).toMatchObject({ records: 3, expense: 41.46 });
  expect(diff.target).toMatchObject({ records: 2, expense: 35.79 });
  expect(diff.onlyCurrent.map(record => record.id)).toEqual(['offline']);
  expect(diff.onlyTarget).toEqual([]);
  expect(diff.modified).toEqual([]);
  expect(diff.affected).toContain('月份、分类预算、实际支出或月结');
});

it('相同笔数和总额不会掩盖同标识金额修改或不同笔交易', () => {
  const current = backup();
  const target = backup();
  current.expenseRecords = [expense('same-id', 5), expense('current-only', 5)];
  target.expenseRecords = [expense('same-id', 7), expense('history-only', 3)];
  const diff = compareLedgers(current, target);
  expect(diff.current).toEqual(diff.target);
  expect(diff.onlyCurrent[0].id).toBe('current-only');
  expect(diff.onlyTarget[0].id).toBe('history-only');
  expect(diff.modified.map(({ current, target }) => [current.amount, target.amount])).toEqual([[5, 7]]);
  expect(canonicalLedgerJson(current)).not.toBe(canonicalLedgerJson(target));
});
