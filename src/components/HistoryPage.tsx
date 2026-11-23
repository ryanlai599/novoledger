import { useState } from 'react';
import { useFinanceStore } from '../store/useStore';
import { Badge, Card, EmptyState } from './ui';

const typeLabels: Record<string, string> = {
  income_confirm: '到账',
  income_edit: '修改金额',
  transfer: '转账',
  expense_update: '支出',
  expense_record: '记账',
  reallocate: '划拨',
  copy_categories: '复制分类',
  correction: '校正',
  finalize: '结余',
  overspend: '超支',
  backup: '备份',
  import: '导入',
  export: '导出',
  other: '其他'
};

const typeTones: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'neutral'> = {
  income_confirm: 'green',
  income_edit: 'blue',
  transfer: 'blue',
  expense_update: 'amber',
  expense_record: 'amber',
  reallocate: 'blue',
  copy_categories: 'blue',
  correction: 'neutral',
  finalize: 'green',
  overspend: 'red',
  backup: 'neutral',
  import: 'neutral',
  export: 'neutral',
  other: 'neutral'
};

export default function HistoryPage() {
  const history = useFinanceStore(s => s.history);
  const [filter, setFilter] = useState('all');
  const items = filter === 'all' ? history : history.filter(h => h.type === filter);

  return (
    <Card
      title="操作记录"
      action={
        <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="筛选记录类型">
          <option value="all">全部</option>
          {Object.entries(typeLabels).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      }
    >
      {items.length === 0 ? (
        <EmptyState text="暂无记录" />
      ) : (
        <div className="timeline">
          {items.map(item => (
            <div className="timeline-item" key={item.id}>
              <div className="timeline-time">{new Date(item.at).toLocaleString('zh-CN')}</div>
              <div className="timeline-main">
                <div className="timeline-title">
                  <Badge tone={typeTones[item.type] ?? 'neutral'}>{typeLabels[item.type] ?? item.type}</Badge>{' '}
                  {item.title}
                </div>
                {item.amount !== undefined && <div className="timeline-detail">金额：{item.amount.toFixed(2)} 元</div>}
                {item.detail && <div className="timeline-detail">{item.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
