import { describe, expect, it } from 'vitest';
import { createSeedState } from '../test/ledgerFixture';
import { confirmIncome, executeTransfer, finalizeMonth, monthRemaining, monthTotal } from './accounting';
import { buildMarkdownReport } from './report';
import { healthIndicators } from './statistics';

describe('已知账务问题：记录现状，不代表业务已确认', () => {
  it('结算后释放预算会使当前剩余偏离已存结余', () => {
    const state = executeTransfer(finalizeMonth(createSeedState(), '2023-04'), 'sample-transfer-books');
    const month = state.months['2023-04'];
    expect(month.status).toBe('finalized');
    expect(monthRemaining(month)).not.toBe(month.surplus);
  });

  it('总结余转出后来源池仍可再次扣款', () => {
    const state = confirmIncome(createSeedState(), 'sample-event-payroll', 4180);
    state.transfers.push({
      id: 'summary-out', kind: 'summary-to-pocket', monthKey: '2023-04', date: '2023-04',
      amount: 4180, toId: 'sample-pocket-transit', status: 'planned'
    });
    const after = executeTransfer(executeTransfer(state, 'summary-out'), 'sample-transfer-home');
    expect(after.summaryBalance).toBe(-2070);
  });

  it('样例预算执行两笔释放后叠加', () => {
    const state = executeTransfer(executeTransfer(createSeedState(), 'sample-transfer-books'), 'sample-transfer-hobby');
    expect(monthTotal(state.months['2023-04'], 'budget')).toBe(2380);
  });

  it('占用率再次计入来源池；单月 Markdown 仍有其他月份的记账明细', () => {
    const state = confirmIncome(createSeedState(), 'sample-event-payroll', 4180);
    const pockets = state.pockets.reduce((total, pocket) => total + pocket.balance, 0);
    state.expenseRecords.push({
      id: 'outside', date: '2023-04-05', amount: 1, categoryId: 'sample-cat-books', kind: 'expense', note: '其他月份明细'
    });
    expect(healthIndicators(state).occupationRate).toBeCloseTo(pockets / (pockets + 8360));
    expect(buildMarkdownReport(state, 'month', '2023-05', '2023-05-10')).toContain('其他月份明细');
  });
});
