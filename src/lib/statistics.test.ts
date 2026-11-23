import { describe, expect, it } from 'vitest';
import { createSeedState } from '../test/ledgerFixture';
import { confirmIncome } from './accounting';
import type { LedgerState } from '../types';
import {
  categoryBreakdown,
  categoryRows,
  dailyFlows,
  fundDistribution,
  healthIndicators,
  monthSummaries,
  monthlyTrend
} from './statistics';

function pushRecord(
  state: LedgerState,
  date: string,
  amount: number,
  categoryId: string,
  kind: 'expense' | 'income' = 'expense'
): LedgerState {
  state.expenseRecords.push({ id: `test-${date}-${amount}-${kind}`, date, amount, categoryId, kind });
  return state;
}

describe('statistics', () => {
  it('按天汇总收入和支出', () => {
    let state = createSeedState();
    state = pushRecord(state, '2023-04-05', 100, 'sample-cat-books');
    state = pushRecord(state, '2023-04-05', 50, 'sample-cat-hobby');
    state = pushRecord(state, '2023-04-06', 20, 'sample-cat-books', 'income');
    const flows = dailyFlows(state, '2023-04', '2023-04-08');
    expect(flows).toHaveLength(8);
    expect(flows[4]).toMatchObject({ date: '2023-04-05', income: 0, expense: 150 });
    expect(flows[5]).toMatchObject({ date: '2023-04-06', income: 20, expense: 0 });
  });

  it('未来日期不画进每日柱状图', () => {
    const state = createSeedState();
    const flows = dailyFlows(state, '2023-04', '2023-04-08');
    expect(flows.map(row => row.day)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('分类占比只统计有支出的分类', () => {
    let state = createSeedState();
    state = pushRecord(state, '2023-04-05', 100, 'sample-cat-books');
    state = pushRecord(state, '2023-04-06', 50, 'sample-cat-hobby');
    state = pushRecord(state, '2023-04-07', 20, 'sample-cat-books', 'income');
    const slices = categoryBreakdown(state, 'month', '2023-04');
    expect(slices).toEqual([
      { name: '样例图书', amount: 100, ratio: 66.67 },
      { name: '样例爱好', amount: 50, ratio: 33.33 }
    ]);
  });

  it('全部期间分类占比跨月份汇总', () => {
    let state = createSeedState();
    state = pushRecord(state, '2023-04-05', 100, 'sample-cat-books');
    state = pushRecord(state, '2023-05-02', 300, 'sample-cat-food');
    const slices = categoryBreakdown(state, 'all', '2023-04');
    expect(slices).toEqual([
      { name: '样例餐饮', amount: 300, ratio: 75 },
      { name: '样例图书', amount: 100, ratio: 25 }
    ]);
  });

  it('月度趋势按预计月份归属已确认大额收入', () => {
    let state = createSeedState();
    state = pushRecord(state, '2023-04-05', 30, 'sample-cat-books');
    state = confirmIncome(state, 'sample-event-payroll', 4180);
    const trend = monthlyTrend(state);
    expect(trend.find(row => row.monthKey === '2023-04')?.income).toBe(4180);
    expect(trend.find(row => row.monthKey === '2023-04')?.expense).toBe(30);
  });

  it('资金分布区分总结余、小荷包和待确认收入', () => {
    const state = createSeedState();
    expect(fundDistribution(state)).toEqual([
      { name: '已确认总结余', value: 0, note: '可再分配，含未占用来源池' },
      { name: '小荷包', value: 4090, note: '已占用资金' },
      { name: '待确认收入', value: 8050, note: '预计到账' }
    ]);
  });

  it('健康指标按全期汇总', () => {
    let state = createSeedState();
    state = confirmIncome(state, 'sample-event-payroll', 4180);
    state = pushRecord(state, '2023-04-05', 100, 'sample-cat-books');
    state = pushRecord(state, '2023-04-06', 20, 'sample-cat-books', 'income');
    const indicators = healthIndicators(state);
    expect(indicators.totalIncome).toBe(4200);
    expect(indicators.totalExpense).toBe(100);
    expect(indicators.net).toBe(4100);
    expect(indicators.overspendMonths).toBe(0);
    expect(indicators.budgetRate).toBeCloseTo(100 / 11380, 6);
    expect(indicators.occupationRate).toBeCloseTo(4090 / (4180 + 4180 + 4090), 6);
  });

  it('月度汇总和当前月份分类表', () => {
    const state = createSeedState();
    const summaries = monthSummaries(state);
    expect(summaries).toHaveLength(5);
    expect(summaries[0]).toMatchObject({ monthKey: '2023-04', budget: 1190, actual: 0, remaining: 1190 });
    const rows = categoryRows(state, '2023-05');
    expect(rows.find(row => row.name === '样例餐饮')).toMatchObject({ budget: 1260, actual: 0, remaining: 1260 });
  });
});
