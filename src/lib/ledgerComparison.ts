import type { LedgerState } from '../types';
import { money } from './format';
import { sameLedger } from './ledgerSchema';

const sections: [string, (keyof LedgerState)[]][] = [
  ['月份、分类预算、实际支出或月结', ['months', 'nextMonthCharges']],
  ['收入来源、到账或来源池', ['incomeSources', 'incomeEvents', 'sourcePools']],
  ['小荷包或余额校正', ['pockets', 'corrections']],
  ['资金划扣', ['transfers']],
  ['已确认总结余', ['summaryBalance']],
  ['操作记录', ['history']]
];

function totals(ledger: LedgerState) {
  let expense = 0, income = 0;
  for (const record of ledger.expenseRecords) {
    if (record.kind === 'income') income += record.amount;
    else expense += record.amount;
  }
  return { records: ledger.expenseRecords.length, expense: money(expense), income: money(income), balance: ledger.summaryBalance };
}

export function compareLedgers(current: LedgerState, target: LedgerState) {
  const before = new Map(current.expenseRecords.map(record => [record.id, record]));
  const after = new Map(target.expenseRecords.map(record => [record.id, record]));
  const onlyCurrent = current.expenseRecords.filter(record => !after.has(record.id));
  const onlyTarget = target.expenseRecords.filter(record => !before.has(record.id));
  const modified = current.expenseRecords.flatMap(record => {
    const next = after.get(record.id);
    return next && !sameLedger(record, next) ? [{ current: record, target: next }] : [];
  });
  const affected = sections.filter(([, keys]) => keys.some(key => !sameLedger(current[key], target[key]))).map(([label]) => label);
  if (!onlyCurrent.length && !onlyTarget.length && !modified.length && !sameLedger(current.expenseRecords, target.expenseRecords)) {
    affected.push('记账记录顺序');
  }
  return { current: totals(current), target: totals(target), onlyCurrent, onlyTarget, modified, affected };
}
