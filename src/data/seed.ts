import { todayLocalDate } from '../lib/format';
import type { LedgerState, MonthPlan } from '../types';

export function emptyMonth(key: string): MonthPlan {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new Error('请输入有效月份（YYYY-MM）');
  const [year, month] = key.split('-');
  return { key, label: `${year}年${Number(month)}月`, status: 'draft', categories: [], funding: [] };
}

export function createEmptyLedger(key = todayLocalDate().slice(0, 7)): LedgerState {
  return {
    version: 1, months: { [key]: emptyMonth(key) }, summaryBalance: 0,
    incomeSources: [], incomeEvents: [], sourcePools: {}, pockets: [],
    corrections: [], expenseRecords: [], transfers: [], nextMonthCharges: {}, history: []
  };
}
