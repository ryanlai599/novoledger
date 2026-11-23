import { useState, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import { monthRemaining, monthTotal, pendingIncomeTotal, projectedSummary } from '../lib/accounting';
import { useFinanceStore } from '../store/useStore';
import { Badge, Button, Card, Modal, Money, StatCard } from './ui';
import type { PageKey } from './AppShell';
import StatsPanel from './StatsPanel';

export default function Dashboard({ monthKey, onNavigate }: { monthKey: string; onNavigate?: (page: PageKey) => void }) {
  const month = useFinanceStore(s => s.months[monthKey]);
  const summaryBalance = useFinanceStore(s => s.summaryBalance);
  const projected = useFinanceStore(s => projectedSummary(s));
  const pendingTotal = useFinanceStore(s => pendingIncomeTotal(s));
  const incomeEvents = useFinanceStore(s => s.incomeEvents);
  const transfers = useFinanceStore(s => s.transfers);
  const [collapsed, setCollapsed] = useState(true);
  const [demo, setDemo] = useState(false);

  const starter = <Card title="开始使用">
    <p>{month ? '本月还没有预算分类。先新建一个分类，或直接到记账页新增分类。' : '账本还没有月份。可新建月份，或恢复已核对的备份。'}</p>
    <div className="form-actions start">
      <Button onClick={() => onNavigate?.('month')}>设置月份和预算</Button>
      <Button variant="ghost" onClick={() => onNavigate?.('backup')}>恢复备份或设置同步</Button>
      <Button variant="ghost" onClick={() => setDemo(true)}>查看虚构示例</Button>
    </div>
    <Modal open={demo} title="虚构示例 · 仅供查看" onClose={() => setDemo(false)}>
      <p>以下金额是虚构的，与任何用户无关；不会写入、导出或同步到你的账本。</p>
      <div className="stat-grid">
        <StatCard label="示例预算" value={<Money value={500} />} />
        <StatCard label="示例交通支出" value={<Money value={65} />} />
        <StatCard label="示例剩余" value={<Money value={435} />} />
      </div>
      <Button variant="ghost" onClick={() => setDemo(false)}>返回自己的账本</Button>
    </Modal>
  </Card>;

  if (!month) return starter;

  const budget = monthTotal(month, 'budget');
  const actual = monthTotal(month, 'actual');
  const remaining = monthRemaining(month);
  const pendingEvents = incomeEvents.filter(e => e.status === 'pending').sort((a, b) => a.expectedAt.localeCompare(b.expectedAt));
  const pendingTransfers = transfers.filter(t => t.monthKey === monthKey && t.status === 'planned');
  const allTodos: ReactNode[] = [];
  const canCloseMonth = month.status === 'draft' && month.categories.length > 0;
  if (pendingEvents.length === 0 && pendingTransfers.length === 0 && !canCloseMonth) {
    allTodos.push(<div className="empty-state" key="empty">本月没有待办事项</div>);
  }
  pendingEvents.forEach(event => {
    allTodos.push(
      <div className="todo-item todo-income" key={event.id}>
        <div className="todo-main">
          <div className="todo-title">{event.title}</div>
          <div className="todo-sub">预计 {event.expectedAt} · 计划 {event.plannedAmount.toFixed(2)} 元</div>
        </div>
        {onNavigate && (
          <Button variant="ghost" onClick={() => onNavigate('income')}>
            去确认 <ArrowRight size={14} />
          </Button>
        )}
      </div>
    );
  });
  pendingTransfers.forEach(transfer => {
    allTodos.push(
      <div className="todo-item todo-transfer" key={transfer.id}>
        <div className="todo-main">
          <div className="todo-title">{transfer.note ?? '待执行划扣'}</div>
          <div className="todo-sub">金额 {transfer.amount.toFixed(2)} 元</div>
        </div>
        {onNavigate && (
          <Button variant="ghost" onClick={() => onNavigate('pockets')}>
            去执行 <ArrowRight size={14} />
          </Button>
        )}
      </div>
    );
  });
  if (canCloseMonth) {
    allTodos.push(
      <div className="todo-item todo-final" key="month-final">
        <div className="todo-main">
          <div className="todo-title">月底核对</div>
          <div className="todo-sub">{month.label} 还差最后确认</div>
        </div>
        {onNavigate && (
          <Button variant="ghost" onClick={() => onNavigate('month')}>
            去核对 <CheckCircle2 size={14} />
          </Button>
        )}
      </div>
    );
  }
  const hasMore = allTodos.length > 3;
  const visibleTodos = !collapsed || !hasMore ? allTodos : allTodos.slice(0, 3);

  return (
    <>
      {!month.categories.length && starter}
      <div className="stat-grid">
        <StatCard label="已确认总结余" value={<Money value={summaryBalance} />} tone="green" sub="可再分配资金" />
        <StatCard label="预计总结余" value={<Money value={projected} />} tone="blue" sub="含待确认收入" />
        <StatCard label={`${month.label} 预算`} value={<Money value={budget} />} />
        <StatCard label="本月已花" value={<Money value={actual} />} tone={actual > budget ? 'red' : 'default'} />
        <StatCard
          label="本月剩余"
          value={<Money value={remaining} />}
          tone={remaining < 0 ? 'red' : remaining > 0 ? 'green' : 'default'}
        />
        <StatCard label="待确认收入合计" value={<Money value={pendingTotal} />} tone="amber" />
      </div>

      <Card title="待办清单" action={<ListChecks size={18} className="muted-icon" />}>
        <div className="todo-list">
          {visibleTodos}
          {collapsed && hasMore && (
            <div className="todo-peek">
              {allTodos[3]}
              <button className="todo-peek-btn" onClick={() => setCollapsed(false)} aria-label="展开全部待办">
                <ChevronDown size={18} />
              </button>
            </div>
          )}
          {!collapsed && hasMore && (
            <button className="todo-collapse-bar" onClick={() => setCollapsed(true)} aria-label="收起待办">
              <ChevronUp size={18} />
            </button>
          )}
        </div>
      </Card>

      <StatsPanel monthKey={monthKey} />

      <Card title={`${month.label} 资金来源`}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>来源</th><th>金额</th><th>状态</th></tr>
            </thead>
            <tbody>
              {month.funding.map(fund => (
                <tr key={fund.id}>
                  <td>{fund.label}</td>
                  <td><Money value={fund.amount} /></td>
                  <td><Badge tone="blue">计划</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
