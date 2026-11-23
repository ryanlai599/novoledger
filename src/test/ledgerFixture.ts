import { createEmptyLedger, emptyMonth } from '../data/seed';
import type { LedgerState } from '../types';

export function createSeedState(): LedgerState {
  const ledger = createEmptyLedger('2023-04');
  const categories = (key: string, ids: string[], labels: string[], budgets: number[]) => ({
    ...emptyMonth(key),
    categories: ids.map((id, i) => ({ id, name: labels[i], budget: budgets[i], actual: 0 }))
  });
  ledger.months = {
    '2023-04': categories('2023-04', ['sample-cat-books', 'sample-cat-hobby'], ['样例图书', '样例爱好'], [430, 760]),
    '2023-05': categories('2023-05', ['sample-cat-food', 'sample-cat-home'], ['样例餐饮', '样例家用'], [1260, 1770]),
    '2023-06': categories('2023-06', ['sample-cat-transit'], ['样例交通'], [2060]),
    '2023-07': categories('2023-07', ['sample-cat-supplies'], ['样例文具'], [2410]),
    '2023-08': categories('2023-08', ['sample-cat-events'], ['样例活动'], [2690])
  };
  ledger.incomeSources = [
    { id: 'sample-source-refund', name: '样例退款', kind: 'other' },
    { id: 'sample-source-contract', name: '样例合同', kind: 'salary' },
    { id: 'sample-source-payroll', name: '样例薪酬', kind: 'salary' }
  ];
  ledger.sourcePools = Object.fromEntries(ledger.incomeSources.map(source => [source.id, 0]));
  ledger.incomeEvents = [
    { id: 'sample-event-refund', sourceId: 'sample-source-refund', title: '样例退款到账', plannedAmount: 2310, expectedAt: '2023-07-08', status: 'pending', edits: [] },
    { id: 'sample-event-contract', sourceId: 'sample-source-contract', title: '样例合同收入', plannedAmount: 940, expectedAt: '2023-04-12', status: 'pending', edits: [] },
    { id: 'sample-event-payroll', sourceId: 'sample-source-payroll', title: '样例月薪', plannedAmount: 4180, expectedAt: '2023-04-18', status: 'pending', edits: [] },
    { id: 'sample-event-bonus', sourceId: 'sample-source-payroll', title: '样例奖金', plannedAmount: 620, expectedAt: '2023-05-20', status: 'pending', edits: [] }
  ];
  ledger.pockets = [
    { id: 'sample-pocket-home', name: '样例家用荷包', balance: 1580, isActive: true },
    { id: 'sample-pocket-transit', name: '样例交通荷包', balance: 1320, isActive: true },
    { id: 'sample-pocket-books', name: '样例图书荷包', balance: 430, isActive: true },
    { id: 'sample-pocket-hobby', name: '样例爱好荷包', balance: 760, isActive: true }
  ];
  ledger.transfers = [
    { id: 'sample-transfer-home', monthKey: '2023-04', date: '2023-04-24', kind: 'source-to-pocket', fromId: 'sample-source-payroll', toId: 'sample-pocket-home', amount: 2070, status: 'planned' },
    { id: 'sample-transfer-books', monthKey: '2023-04', date: '2023-04-25', kind: 'pocket-to-expense', fromId: 'sample-pocket-books', toCategoryId: 'sample-cat-books', amount: 430, status: 'planned' },
    { id: 'sample-transfer-hobby', monthKey: '2023-04', date: '2023-04-26', kind: 'pocket-to-expense', fromId: 'sample-pocket-hobby', toCategoryId: 'sample-cat-hobby', amount: 760, status: 'planned' },
    { id: 'sample-transfer-food', monthKey: '2023-05', date: '2023-05-07', kind: 'pocket-to-expense', fromId: 'sample-pocket-home', toCategoryId: 'sample-cat-food', amount: 17, status: 'planned' }
  ];
  return ledger;
}
