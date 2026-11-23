import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { fmtMoney, todayLocalDate } from '../lib/format';
import { buildMarkdownReport } from '../lib/report';
import {
  categoryBreakdown,
  categoryRows,
  dailyFlows,
  fundDistribution,
  healthIndicators,
  monthLabel,
  monthSummaries,
  monthlyTrend,
  type StatsRange
} from '../lib/statistics';
import { useFinanceStore } from '../store/useStore';
import { Badge, Button, Card, Money, ProgressBar, Segmented, StatCard } from './ui';

const COLORS = [
  '#6d5bd0',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ca8a04',
  '#64748b',
  '#db2777'
];

function downloadText(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function shortMonth(key: string): string {
  return `${Number(key.slice(5, 7))}月`;
}

function moneyTooltip(value: unknown): string {
  return fmtMoney(Number(value ?? 0));
}

export default function StatsPanel({ monthKey }: { monthKey: string }) {
  const state = useFinanceStore();
  const [range, setRange] = useState<StatsRange>('month');
  const [message, setMessage] = useState('');
  const today = todayLocalDate();

  const daily = dailyFlows(state, monthKey, today);
  const categories = categoryBreakdown(state, range, monthKey);
  const trend = monthlyTrend(state);
  const funds = fundDistribution(state);
  const health = healthIndicators(state);
  const summaries = monthSummaries(state);
  const categoryTable = categoryRows(state, monthKey);

  const exportMarkdown = () => {
    downloadText(
      buildMarkdownReport(state, range, monthKey, today),
      `finance-report-${range === 'all' ? 'all' : monthKey}.md`,
      'text/markdown'
    );
    setMessage('Markdown 报表已导出，可直接发给 AI 分析');
  };

  const exportJson = () => {
    downloadText(state.exportJson(), `finance-ledger-${today}.json`, 'application/json');
    setMessage('完整 JSON 账本已导出');
  };

  const dailyData = daily.map(row => ({ label: `${row.day}日`, income: row.income, expense: row.expense }));
  const trendData = trend.map(row => ({ label: shortMonth(row.monthKey), income: row.income, expense: row.expense }));
  const categoryData = categories.map(item => ({ name: item.name, value: item.amount }));
  const fundData = funds.filter(item => item.value > 0).map(item => ({ name: item.name, value: item.value }));

  return (
    <Card>
      <div className="card-head stats-head">
        <h3>收支统计与报表</h3>
        <div className="stats-toolbar">
          <Segmented
            label="统计范围"
            value={range}
            onChange={setRange}
            options={[
              { value: 'month', label: '本月' },
              { value: 'all', label: '全部期间' }
            ]}
          />
          <Button variant="ghost" onClick={exportMarkdown}>
            <FileText size={16} /> 导出 Markdown
          </Button>
          <Button variant="ghost" onClick={exportJson}>
            <Download size={16} /> 导出 JSON
          </Button>
        </div>
      </div>
      {message && <div className="stats-message">{message}</div>}

      <div className="stat-grid stats-health">
        <StatCard label="总收入" value={<Money value={health.totalIncome} />} tone="green" />
        <StatCard label="总支出" value={<Money value={health.totalExpense} />} tone="amber" />
        <StatCard label="净结余" value={<Money value={health.net} />} tone={health.net < 0 ? 'red' : 'green'} />
        <StatCard
          label="预算执行率"
          value={`${(health.budgetRate * 100).toFixed(1)}%`}
          sub={
            <ProgressBar
              value={health.budgetRate * 100}
              max={100}
              tone={health.budgetRate > 1 ? 'red' : health.budgetRate > 0.8 ? 'amber' : 'green'}
            />
          }
        />
        <StatCard
          label="超支月份数"
          value={health.overspendMonths}
          tone={health.overspendMonths > 0 ? 'red' : 'default'}
        />
        <StatCard
          label="资金占用率"
          value={`${(health.occupationRate * 100).toFixed(1)}%`}
          sub={<ProgressBar value={health.occupationRate * 100} max={100} tone="blue" />}
        />
      </div>

      <div className="grid-2 stats-charts">
        <div className="chart-block">
          <h4>每日收支（{monthLabel(monthKey)}）</h4>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#667085' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: '#667085' }} width={48} tickFormatter={moneyTooltip} />
                <Tooltip formatter={moneyTooltip} />
                <Legend />
                <Bar dataKey="income" name="收入" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="支出" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-block">
          <h4>支出分类占比（{range === 'month' ? monthLabel(monthKey) : '全部期间'}）</h4>
          <div className="chart-box">
            {categoryData.length === 0 ? (
              <div className="empty-state chart-empty">暂无支出记录</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius="42%" outerRadius="72%" paddingAngle={2}>
                    {categoryData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={moneyTooltip} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="chart-block">
          <h4>月度收支趋势</h4>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#667085' }} />
                <YAxis tick={{ fontSize: 11, fill: '#667085' }} width={48} tickFormatter={moneyTooltip} />
                <Tooltip formatter={moneyTooltip} />
                <Legend />
                <Bar dataKey="income" name="收入" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="支出" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-block">
          <h4>资金分布（当前状态）</h4>
          <div className="chart-box">
            {fundData.length === 0 ? (
              <div className="empty-state chart-empty">暂无资金数据</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={fundData} dataKey="value" nameKey="name" innerRadius="42%" outerRadius="72%" paddingAngle={2}>
                    {fundData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={moneyTooltip} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <h4 className="stats-table-title">月度汇总（全部期间）</h4>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>月份</th>
              <th>预算</th>
              <th>实际</th>
              <th>剩余/超支</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map(row => (
              <tr key={row.monthKey}>
                <td>{row.label}</td>
                <td><Money value={row.budget} /></td>
                <td><Money value={row.actual} /></td>
                <td>
                  <span className={row.remaining < 0 ? 'negative-text' : ''}><Money value={row.remaining} /></span>
                  {row.remaining < 0 && <Badge tone="red">超支</Badge>}
                </td>
                <td><Badge tone={row.status === 'finalized' ? 'green' : 'neutral'}>{row.status === 'finalized' ? '已结余' : '草稿'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="stats-table-title">当前月份分类表（{monthLabel(monthKey)}）</h4>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>分类</th>
              <th>预算</th>
              <th>实际</th>
              <th>剩余</th>
            </tr>
          </thead>
          <tbody>
            {categoryTable.map(row => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td><Money value={row.budget} /></td>
                <td><Money value={row.actual} /></td>
                <td className={row.remaining < 0 ? 'negative-text' : ''}><Money value={row.remaining} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
