import { CalendarRange, DatabaseBackup, History, LayoutDashboard, PiggyBank, Receipt, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useFinanceStore } from '../store/useStore';

export type PageKey = 'dashboard' | 'records' | 'month' | 'income' | 'pockets' | 'history' | 'backup';

const nav = [
  { key: 'dashboard' as PageKey, label: '概览', description: '查看总结余、本月预算与待办事项。', icon: LayoutDashboard },
  { key: 'records' as PageKey, label: '记账', description: '记录每日支出与小额收入，自动汇总到对应分类。', icon: Receipt },
  { key: 'month' as PageKey, label: '月度规划', mobileLabel: '规划', description: '管理每月预算、实际支出与月底结余。', icon: CalendarRange },
  { key: 'income' as PageKey, label: '资金来源', mobileLabel: '资金', description: '管理收入来源、收入事件与到账确认。', icon: Wallet },
  { key: 'pockets' as PageKey, label: '小荷包', mobileLabel: '荷包', description: '跟踪小荷包余额，执行资金划扣与转账。', icon: PiggyBank },
  { key: 'history' as PageKey, label: '记录', description: '查看所有账本操作的时间线记录。', icon: History },
  { key: 'backup' as PageKey, label: '数据备份', mobileLabel: '备份', description: '导出、导入备份并连接云同步。', icon: DatabaseBackup }
];

export default function AppShell({
  page,
  onPageChange,
  monthKey,
  onMonthChange,
  children
}: {
  page: PageKey;
  onPageChange: (page: PageKey) => void;
  monthKey: string;
  onMonthChange: (monthKey: string) => void;
  children: ReactNode;
}) {
  const months = useFinanceStore(s => s.months);
  const monthOptions = Object.keys(months).sort();
  const current = nav.find(n => n.key === page);

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand">
          <img className="brand-logo" src="/icon.svg" alt="NovoLedger 标志" />
          <span className="brand-text">
            <span className="brand-name">NovoLedger</span>
            <span className="brand-slogan">每一笔，都让未来更清晰</span>
          </span>
        </div>
        <nav className="side-links">
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={page === item.key ? 'nav-link active' : 'nav-link'}
                onClick={() => onPageChange(item.key)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="side-foot">本地账本 · 定期导出备份</div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <div className="topbar-title">{current?.label}</div>
            {current?.description && <div className="topbar-subtitle">{current.description}</div>}
          </div>
          <label className="month-select">
            <CalendarRange size={16} />
            <select value={monthOptions.length ? monthKey : ''} disabled={!monthOptions.length}
              onChange={e => onMonthChange(e.target.value)} aria-label="选择月份">
              {!monthOptions.length && <option value="">暂无月份</option>}
              {monthOptions.map(key => (
                <option key={key} value={key}>
                  {months[key].label}
                </option>
              ))}
            </select>
          </label>
        </header>
        <div className="page-content">{children}</div>
      </main>

      <nav className="bottom-nav">
        {nav.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className={page === item.key ? 'bottom-link active' : 'bottom-link'}
              onClick={() => onPageChange(item.key)}
            >
              <Icon size={19} />
              <span>{item.mobileLabel ?? item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
