import { fmtMoney } from './format';
import type { HistoryEvent, LedgerState, Transfer, TransferKind } from '../types';
import {
  categoryBreakdown,
  categoryRows,
  dailyFlows,
  fundDistribution,
  healthIndicators,
  monthLabel,
  monthSummaries,
  monthlyTrend,
  resolveCategoryName,
  type StatsRange
} from './statistics';

const historyLabels: Record<HistoryEvent['type'], string> = {
  income_confirm: '到账确认',
  income_edit: '修改金额',
  transfer: '转账',
  expense_update: '支出更新',
  expense_record: '记账',
  reallocate: '预算划拨',
  copy_categories: '复制分类',
  correction: '余额校正',
  finalize: '结余',
  overspend: '超支',
  backup: '备份',
  import: '导入',
  export: '导出',
  other: '其他'
};

const transferLabels: Record<TransferKind, string> = {
  'source-to-pocket': '来源池→小荷包',
  'pocket-to-pocket': '小荷包→小荷包',
  'pocket-to-summary': '小荷包→总结余',
  'summary-to-pocket': '总结余→小荷包',
  'pocket-to-expense': '小荷包→支出'
};

function table(headers: string[], rows: string[][]): string {
  const lines = [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const row of rows) {
    lines.push(`| ${row.map(cell => cell.replace(/\|/g, '\\|')).join(' | ')} |`);
  }
  return lines.join('\n');
}

function moneyText(value: number): string {
  return `${fmtMoney(value)} 元`;
}

function nowStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function rangeText(state: LedgerState, range: StatsRange, monthKey: string): string {
  if (range === 'month') return monthLabel(monthKey);
  const keys = Object.keys(state.months).sort();
  return keys.length ? `${monthLabel(keys[0])} 至 ${monthLabel(keys[keys.length - 1])}` : '无月份数据';
}

function accountName(state: LedgerState, id?: string): string {
  if (!id) return '总结余';
  const source = state.incomeSources.find(item => item.id === id);
  if (source) return source.name;
  const pocket = state.pockets.find(item => item.id === id);
  if (pocket) return pocket.name;
  return '已删除账户';
}

function transferDescription(state: LedgerState, transfer: Transfer): string {
  const from = transfer.kind === 'summary-to-pocket' ? '总结余' : accountName(state, transfer.fromId);
  const to = transfer.toCategoryId
    ? resolveCategoryName(state, transfer.toCategoryId)
    : transfer.toId
      ? accountName(state, transfer.toId)
      : '总结余';
  return `${transferLabels[transfer.kind]}（${from} → ${to}）`;
}

function categoryName(state: LedgerState, categoryId: string): string {
  return resolveCategoryName(state, categoryId);
}

export function buildMarkdownReport(state: LedgerState, range: StatsRange, monthKey: string, today: string): string {
  const sections: string[] = [];
  sections.push('# NovoLedger 财务分析报表');
  sections.push('');
  sections.push(`- 生成时间：${nowStamp()}`);
  sections.push(`- 数据范围：${rangeText(state, range, monthKey)}`);
  sections.push(`- 统计口径：已确认大额到账按预计到账月份计入月度趋势；每日柱状图只计入记账页小额收入；资金分布按当前状态计算。`);
  sections.push('');

  const indicators = healthIndicators(state);
  sections.push('## 一、健康指标');
  sections.push('');
  sections.push(
    table(
      ['指标', '数值'],
      [
        ['总收入（已确认到账 + 记账收入）', moneyText(indicators.totalIncome)],
        ['总支出（记账支出）', moneyText(indicators.totalExpense)],
        ['净结余', moneyText(indicators.net)],
        ['预算执行率', `${(indicators.budgetRate * 100).toFixed(2)}%`],
        ['超支月份数', String(indicators.overspendMonths)],
        ['资金占用率', `${(indicators.occupationRate * 100).toFixed(2)}%`]
      ]
    )
  );
  sections.push('');

  sections.push('## 二、图表数据');
  sections.push('');

  const daily = dailyFlows(state, monthKey, today);
  sections.push(`### 每日收支（${monthLabel(monthKey)}）`);
  sections.push('');
  sections.push(
    table(
      ['日期', '收入', '支出'],
      daily.map(row => [row.date, moneyText(row.income), moneyText(row.expense)])
    )
  );
  sections.push('');

  const categories = categoryBreakdown(state, range, monthKey);
  sections.push(`### 支出分类占比（${range === 'month' ? monthLabel(monthKey) : '全部期间'}）`);
  sections.push('');
  if (categories.length === 0) {
    sections.push('暂无支出记录。');
  } else {
    sections.push(
      table(
        ['分类', '金额', '占比'],
        categories.map(item => [item.name, moneyText(item.amount), `${item.ratio.toFixed(2)}%`])
      )
    );
  }
  sections.push('');

  if (range === 'all') {
    const trend = monthlyTrend(state);
    sections.push('### 月度收支趋势');
    sections.push('');
    sections.push(
      table(
        ['月份', '收入', '支出', '净额'],
        trend.map(row => [row.label, moneyText(row.income), moneyText(row.expense), moneyText(row.net)])
      )
    );
    sections.push('');
  }

  const funds = fundDistribution(state);
  sections.push('### 资金分布（当前状态）');
  sections.push('');
  sections.push(
    table(
      ['资金', '金额', '说明'],
      funds.map(item => [item.name, moneyText(item.value), item.note])
    )
  );
  sections.push('');

  const summaries = monthSummaries(state).filter(row => range === 'all' || row.monthKey === monthKey);
  sections.push('## 三、月度汇总');
  sections.push('');
  sections.push(
    table(
      ['月份', '预算', '实际', '剩余/超支', '状态'],
      summaries.map(row => [
        row.label,
        moneyText(row.budget),
        moneyText(row.actual),
        moneyText(row.remaining),
        row.status === 'finalized' ? '已结余' : '草稿'
      ])
    )
  );
  sections.push('');

  const categoryTableRows = categoryRows(state, monthKey);
  sections.push(`## 四、当前月份分类表（${monthLabel(monthKey)}）`);
  sections.push('');
  sections.push(
    table(
      ['分类', '预算', '实际', '剩余'],
      categoryTableRows.map(row => [row.name, moneyText(row.budget), moneyText(row.actual), moneyText(row.remaining)])
    )
  );
  sections.push('');

  sections.push('## 五、完整明细');
  sections.push('');

  const records = [...state.expenseRecords].sort((a, b) => a.date.localeCompare(b.date));
  sections.push('### 记账记录');
  sections.push('');
  if (records.length === 0) {
    sections.push('暂无记账记录。');
  } else {
    sections.push(
      table(
        ['日期', '类型', '分类', '金额', '备注'],
        records.map(record => [
          record.date,
          (record.kind ?? 'expense') === 'income' ? '收入' : '支出',
          categoryName(state, record.categoryId),
          moneyText(record.amount),
          record.note ?? ''
        ])
      )
    );
  }
  sections.push('');

  sections.push('### 收入事件');
  sections.push('');
  sections.push(
    table(
      ['标题', '来源', '计划金额', '实际金额', '状态', '预计到账'],
      state.incomeEvents.map(event => [
        event.title,
        state.incomeSources.find(source => source.id === event.sourceId)?.name ?? '未知来源',
        moneyText(event.plannedAmount),
        event.actualAmount === undefined ? '-' : moneyText(event.actualAmount),
        event.status === 'confirmed' ? '已确认' : '待确认',
        event.expectedAt
      ])
    )
  );
  sections.push('');

  sections.push('### 转账记录');
  sections.push('');
  if (state.transfers.length === 0) {
    sections.push('暂无转账记录。');
  } else {
    sections.push(
      table(
        ['月份', '类型与流向', '金额', '状态', '备注'],
        state.transfers.map(transfer => [
          transfer.monthKey,
          transferDescription(state, transfer),
          moneyText(transfer.amount),
          transfer.status === 'executed' ? '已执行' : '待执行',
          transfer.note ?? ''
        ])
      )
    );
  }
  sections.push('');

  sections.push('### 小荷包');
  sections.push('');
  sections.push(
    table(
      ['名称', '余额', '状态', '备注'],
      state.pockets.map(pocket => [
        pocket.name,
        moneyText(pocket.balance),
        pocket.isActive ? '启用' : '停用',
        pocket.note ?? ''
      ])
    )
  );
  sections.push('');

  sections.push('### 月度规划');
  sections.push('');
  for (const month of Object.values(state.months).sort((a, b) => a.key.localeCompare(b.key))) {
    sections.push(`#### ${month.label}`);
    sections.push('');
    sections.push(
      table(
        ['分类', '预算', '实际', '剩余'],
        month.categories.map(category => [
          category.name,
          moneyText(category.budget),
          moneyText(category.actual),
          moneyText(category.budget - category.actual)
        ])
      )
    );
    if (month.funding.length > 0) {
      sections.push('');
      sections.push('资金来源：' + month.funding.map(fund => `${fund.label} ${moneyText(fund.amount)}`).join('；'));
    }
    sections.push('');
  }

  sections.push('### 历史记录');
  sections.push('');
  if (state.history.length === 0) {
    sections.push('暂无历史记录。');
  } else {
    sections.push(
      table(
        ['时间', '类型', '标题', '金额', '备注'],
        state.history.map(event => [
          event.at,
          historyLabels[event.type] ?? event.type,
          event.title,
          event.amount === undefined ? '-' : moneyText(event.amount),
          event.detail ?? ''
        ])
      )
    );
  }
  sections.push('');

  sections.push('## 六、口径说明');
  sections.push('');
  sections.push('- 总收入 = 已确认大额到账合计 + 记账页小额收入合计。');
  sections.push('- 总支出 = 记账页支出记录合计；预算金额包含小荷包释放到分类预算的部分。');
  sections.push('- 月度趋势中的已确认大额到账按预计到账月份归属；每日收支只统计记账页小额收入。');
  sections.push('- 资金分布三块不重复：已确认总结余（含未占用来源池）、小荷包总额（已占用）、待确认收入（预计）。');
  sections.push('- 资金占用率 = 小荷包总额 ÷（总结余 + 来源池合计 + 小荷包总额）。');

  return sections.join('\n');
}
