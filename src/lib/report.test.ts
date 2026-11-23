import { describe, expect, it } from 'vitest';
import { createSeedState } from '../test/ledgerFixture';
import { confirmIncome } from './accounting';
import { buildMarkdownReport } from './report';

describe('buildMarkdownReport', () => {
  it('全部期间报表包含指标、图表数据、汇总和完整明细', () => {
    let state = createSeedState();
    state = confirmIncome(state, 'sample-event-payroll', 4180);
    state.expenseRecords.push({
      id: 'test-report-record',
      date: '2023-04-05',
      amount: 100,
      categoryId: 'sample-cat-books',
      kind: 'expense',
      note: '样例购书'
    });
    const report = buildMarkdownReport(state, 'all', '2023-05', '2023-05-08');
    expect(report).toContain('# NovoLedger 财务分析报表');
    expect(report).toContain('数据范围：2023年4月 至 2023年8月');
    expect(report).toContain('## 一、健康指标');
    expect(report).toContain('## 二、图表数据');
    expect(report).toContain('### 每日收支（2023年5月）');
    expect(report).toContain('### 月度收支趋势');
    expect(report).toContain('### 资金分布（当前状态）');
    expect(report).toContain('## 五、完整明细');
    expect(report).toContain('样例购书');
    expect(report).toContain('样例月薪');
  });

  it('单月报表不包含月度趋势表，标注单月范围', () => {
    const state = createSeedState();
    const report = buildMarkdownReport(state, 'month', '2023-05', '2023-05-08');
    expect(report).toContain('数据范围：2023年5月');
    expect(report).toContain('支出分类占比（2023年5月）');
    expect(report).not.toContain('### 月度收支趋势');
  });

  it('无支出记录时分类占比给出空状态', () => {
    const state = createSeedState();
    const report = buildMarkdownReport(state, 'all', '2023-05', '2023-05-08');
    expect(report).toContain('暂无支出记录。');
  });
});
