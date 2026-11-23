import { money } from './format';
import { monthTotal, pendingIncomeTotal } from './accounting';
import type { Id, LedgerState, OverspendRecord } from '../types';

export type StatsRange = 'month' | 'all';

export interface DailyFlow {
  date: string;
  day: number;
  income: number;
  expense: number;
}

export interface CategorySlice {
  name: string;
  amount: number;
  ratio: number;
}

export interface MonthlyTrendRow {
  monthKey: string;
  label: string;
  income: number;
  expense: number;
  net: number;
}

export interface FundSlice {
  name: string;
  value: number;
  note: string;
}

export interface HealthIndicators {
  totalIncome: number;
  totalExpense: number;
  net: number;
  budgetRate: number;
  overspendMonths: number;
  occupationRate: number;
}

export interface MonthSummaryRow {
  monthKey: string;
  label: string;
  budget: number;
  actual: number;
  remaining: number;
  status: 'draft' | 'finalized';
  overspend?: OverspendRecord;
}

export interface CategoryRow {
  id: Id;
  name: string;
  budget: number;
  actual: number;
  remaining: number;
}

export function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${year}年${Number(month)}月`;
}

export function resolveCategoryName(state: LedgerState, categoryId: Id): string {
  for (const month of Object.values(state.months)) {
    const category = month.categories.find(c => c.id === categoryId);
    if (category) return category.name;
  }
  return '未知分类';
}

function padDay(day: number): string {
  return String(day).padStart(2, '0');
}

export function dailyFlows(state: LedgerState, monthKey: string, today: string): DailyFlow[] {
  if (!state.months[monthKey] || monthKey > today.slice(0, 7)) return [];
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const maxDay = today.startsWith(`${monthKey}-`) ? Number(today.slice(8, 10)) : lastDay;
  const rows: DailyFlow[] = [];
  for (let day = 1; day <= maxDay; day += 1) {
    rows.push({ date: `${monthKey}-${padDay(day)}`, day, income: 0, expense: 0 });
  }
  const byDate = new Map(rows.map(row => [row.date, row]));
  for (const record of state.expenseRecords) {
    const row = byDate.get(record.date);
    if (!row) continue;
    if ((record.kind ?? 'expense') === 'income') {
      row.income = money(row.income + record.amount);
    } else {
      row.expense = money(row.expense + record.amount);
    }
  }
  return rows;
}

export function categoryBreakdown(state: LedgerState, range: StatsRange, monthKey: string): CategorySlice[] {
  const totals = new Map<Id, number>();
  const records =
    range === 'month'
      ? state.expenseRecords.filter(record => record.date.startsWith(`${monthKey}-`))
      : state.expenseRecords;
  for (const record of records) {
    if ((record.kind ?? 'expense') !== 'expense') continue;
    totals.set(record.categoryId, money((totals.get(record.categoryId) ?? 0) + record.amount));
  }
  const slices = [...totals.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([categoryId, amount]) => ({ name: resolveCategoryName(state, categoryId), amount }))
    .sort((a, b) => b.amount - a.amount);
  const total = money(slices.reduce((sum, item) => sum + item.amount, 0));
  return slices.map(item => ({ ...item, ratio: total > 0 ? money((item.amount / total) * 100) : 0 }));
}

export function monthlyTrend(state: LedgerState): MonthlyTrendRow[] {
  const smallIncome = new Map<string, number>();
  const expense = new Map<string, number>();
  for (const record of state.expenseRecords) {
    const key = record.date.slice(0, 7);
    if ((record.kind ?? 'expense') === 'income') {
      smallIncome.set(key, money((smallIncome.get(key) ?? 0) + record.amount));
    } else {
      expense.set(key, money((expense.get(key) ?? 0) + record.amount));
    }
  }
  const confirmedByMonth = new Map<string, number>();
  for (const event of state.incomeEvents) {
    if (event.status !== 'confirmed' || event.actualAmount === undefined) continue;
    const key = event.expectedAt.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    confirmedByMonth.set(key, money((confirmedByMonth.get(key) ?? 0) + event.actualAmount));
  }
  return Object.keys(state.months)
    .sort()
    .map(key => {
      const income = money((smallIncome.get(key) ?? 0) + (confirmedByMonth.get(key) ?? 0));
      const expenseTotal = expense.get(key) ?? 0;
      return {
        monthKey: key,
        label: monthLabel(key),
        income,
        expense: expenseTotal,
        net: money(income - expenseTotal)
      };
    });
}

export function fundDistribution(state: LedgerState): FundSlice[] {
  const summary = money(state.summaryBalance);
  const pockets = money(state.pockets.reduce((sum, pocket) => sum + pocket.balance, 0));
  const pending = money(pendingIncomeTotal(state));
  return [
    { name: '已确认总结余', value: summary, note: '可再分配，含未占用来源池' },
    { name: '小荷包', value: pockets, note: '已占用资金' },
    { name: '待确认收入', value: pending, note: '预计到账' }
  ];
}

export function healthIndicators(state: LedgerState): HealthIndicators {
  const confirmedIncome = money(
    state.incomeEvents
      .filter(event => event.status === 'confirmed' && event.actualAmount !== undefined)
      .reduce((sum, event) => sum + (event.actualAmount ?? 0), 0)
  );
  const smallIncome = money(
    state.expenseRecords
      .filter(record => (record.kind ?? 'expense') === 'income')
      .reduce((sum, record) => sum + record.amount, 0)
  );
  const totalIncome = money(confirmedIncome + smallIncome);
  const totalExpense = money(
    state.expenseRecords
      .filter(record => (record.kind ?? 'expense') === 'expense')
      .reduce((sum, record) => sum + record.amount, 0)
  );
  const totalBudget = money(Object.values(state.months).reduce((sum, month) => sum + monthTotal(month, 'budget'), 0));
  const pocketTotal = money(state.pockets.reduce((sum, pocket) => sum + pocket.balance, 0));
  const sourceTotal = money(Object.values(state.sourcePools).reduce((sum, value) => sum + (value ?? 0), 0));
  const occupationDenominator = money(state.summaryBalance + sourceTotal + pocketTotal);
  return {
    totalIncome,
    totalExpense,
    net: money(totalIncome - totalExpense),
    budgetRate: totalBudget > 0 ? totalExpense / totalBudget : 0,
    overspendMonths: Object.values(state.months).filter(month => month.status === 'finalized' && month.overspend).length,
    occupationRate: occupationDenominator > 0 ? pocketTotal / occupationDenominator : 0
  };
}

export function monthSummaries(state: LedgerState): MonthSummaryRow[] {
  return Object.keys(state.months)
    .sort()
    .map(key => {
      const month = state.months[key];
      const budget = monthTotal(month, 'budget');
      const actual = monthTotal(month, 'actual');
      return {
        monthKey: key,
        label: month.label,
        budget,
        actual,
        remaining: money(budget - actual),
        status: month.status,
        overspend: month.overspend
      };
    });
}

export function categoryRows(state: LedgerState, monthKey: string): CategoryRow[] {
  const month = state.months[monthKey];
  if (!month) return [];
  return month.categories.map(category => ({
    id: category.id,
    name: category.name,
    budget: category.budget,
    actual: category.actual,
    remaining: money(category.budget - category.actual)
  }));
}
