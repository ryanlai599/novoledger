import { useState } from 'react';
import { ArrowRightLeft, Copy, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { monthRemaining, monthTotal } from '../lib/accounting';
import { useFinanceStore } from '../store/useStore';
import { Badge, Button, Card, ErrorBanner, Modal, Money, MoneyInput, StatCard } from './ui';

function BudgetInput({ budget, label, disabled, save }: {
  budget: number; label: string; disabled: boolean; save: (value: number, previous: number) => Promise<void>;
}) {
  const [edit, setEdit] = useState<{ value: string; previous: number } | null>(null);
  return <input type="number" min={0} step={0.01} inputMode="decimal" aria-label={label} disabled={disabled}
    title="离开输入框或按回车保存"
    value={edit?.value ?? budget}
    onFocus={() => setEdit({ value: String(budget), previous: budget })}
    onChange={event => setEdit({ value: event.target.value, previous: edit?.previous ?? budget })}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    onBlur={event => {
      const draft = event.target.value;
      setEdit(null);
      if (edit && draft.trim() && Number(draft) !== edit.previous) {
        void save(Number(draft), edit.previous);
      }
    }} />;
}

export default function MonthPlan({ monthKey, onMonthChange }: { monthKey: string; onMonthChange: (key: string) => void }) {
  const month = useFinanceStore(s => s.months[monthKey]);
  const months = useFinanceStore(s => s.months);
  const nextMonthCharges = useFinanceStore(s => s.nextMonthCharges);
  const updateCategory = useFinanceStore(s => s.updateCategory);
  const createMonth = useFinanceStore(s => s.createMonth);
  const addCategory = useFinanceStore(s => s.addCategory);
  const removeCategory = useFinanceStore(s => s.removeCategory);
  const copyCategoriesFromMonth = useFinanceStore(s => s.copyCategoriesFromMonth);
  const reallocateBudget = useFinanceStore(s => s.reallocateBudget);
  const finalizeMonth = useFinanceStore(s => s.finalizeMonth);
  const reviseFinalizedMonth = useFinanceStore(s => s.reviseFinalizedMonth);

  const [error, setError] = useState('');
  const [reallocateOpen, setReallocateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySourceKey, setCopySourceKey] = useState('');
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState(0);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState(0);
  const [overspendSource, setOverspendSource] = useState<'summary' | 'nextMonth' | 'parent'>('summary');
  const [note, setNote] = useState('');
  const [newMonthOpen, setNewMonthOpen] = useState(false);
  const [newMonthKey, setNewMonthKey] = useState('');
  const [creatingMonth, setCreatingMonth] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    try {
      setError('');
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    }
  };

  const monthSetup = <>
    <ErrorBanner message={error} />
    <Card title="月份管理" action={<Button variant="ghost" onClick={() => setNewMonthOpen(true)}>新建月份</Button>}>
      {!month && <p>当前账本还没有月份。先创建一个月份，再设置预算和分类。</p>}
    </Card>
    <Modal open={newMonthOpen} title="新建月份" onClose={() => { if (!creatingMonth) setNewMonthOpen(false); }}>
      <div className="field">
        <label htmlFor="new-month-key">月份（YYYY-MM）</label>
        <input id="new-month-key" type="month" placeholder="YYYY-MM" value={newMonthKey} onChange={e => setNewMonthKey(e.target.value)} />
      </div>
      <ErrorBanner message={error} />
      <p>新月份不带预设金额；若已存在，仅跳转，不改动它的预算。</p>
      <Button disabled={creatingMonth || !newMonthKey} onClick={() => {
        setCreatingMonth(true);
        void run(async () => {
          await createMonth(newMonthKey);
          onMonthChange(newMonthKey);
          setNewMonthOpen(false);
          setNewMonthKey('');
        }).finally(() => setCreatingMonth(false));
      }}>创建并打开</Button>
    </Modal>
  </>;

  if (!month) return monthSetup;

  const budgetTotal = monthTotal(month, 'budget');
  const actualTotal = monthTotal(month, 'actual');
  const remaining = monthRemaining(month);
  const charge = nextMonthCharges[monthKey] ?? 0;
  const sourceMonths = Object.keys(months).sort().filter(key => key !== monthKey);

  const submitReallocate = () => {
    void run(async () => {
      await reallocateBudget(monthKey, fromId, toId, amount);
      setReallocateOpen(false);
      setFromId('');
      setToId('');
      setAmount(0);
    });
  };

  const submitAdd = () => {
    void run(async () => {
      await addCategory(monthKey, name, budget);
      setAddOpen(false);
      setName('');
      setBudget(0);
    });
  };

  const submitCopy = () => {
    void run(async () => {
      await copyCategoriesFromMonth(monthKey, copySourceKey);
      setCopyConfirmOpen(false);
      setCopyOpen(false);
      setCopySourceKey('');
    });
  };

  return (
    <>
      {monthSetup}

      <div className="stat-grid">
        <StatCard label="预算合计" value={<Money value={budgetTotal} />} />
        <StatCard label="实际支出" value={<Money value={actualTotal} />} tone="amber" />
        <StatCard
          label="本月剩余"
          value={<Money value={remaining} />}
          tone={remaining < 0 ? 'red' : remaining > 0 ? 'green' : 'default'}
        />
        <StatCard
          label="状态"
          value={month.status === 'finalized' ? <Badge tone="green">已结余</Badge> : <Badge tone="amber">草稿</Badge>}
          tone="blue"
        />
      </div>

      <Card
        title="支出分类"
        action={
          <div className="form-actions inline">
            <Button variant="ghost" onClick={() => setReallocateOpen(true)} disabled={month.status === 'finalized'}>
              <ArrowRightLeft size={14} /> 划拨预算
            </Button>
            <Button variant="ghost" onClick={() => { setCopySourceKey(''); setCopyOpen(true); }} disabled={month.status === 'finalized' || !sourceMonths.length}>
              <Copy size={14} /> 复制分类
            </Button>
            <Button variant="ghost" onClick={() => setAddOpen(true)} disabled={month.status === 'finalized'}>
              <Plus size={14} /> 新增分类
            </Button>
          </div>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>分类</th><th>预算</th><th>实际</th><th>剩余</th><th></th></tr>
            </thead>
            <tbody>
              {month.categories.map(category => {
                const left = category.budget - category.actual;
                return (
                  <tr key={category.id}>
                    <td>{category.name}</td>
                    <td>
                      <BudgetInput
                        budget={category.budget}
                        save={(value, previous) => run(() => updateCategory(monthKey, category.id, { budget: value }, previous))}
                        disabled={month.status === 'finalized'}
                        label={`${category.name}预算`}
                      />
                    </td>
                    <td>
                      <Money value={category.actual} />
                    </td>
                    <td className={left < 0 ? 'negative' : ''}><Money value={left} /></td>
                    <td>
                      <Button
                        variant="danger"
                        disabled={month.status === 'finalized'}
                        onClick={() => run(() => removeCategory(monthKey, category.id))}
                        aria-label={`删除${category.name}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid-2">
        <Card title="资金来源">
          <div className="todo-list">
            {month.funding.map(fund => (
              <div className="todo-item" key={fund.id}>
                <div className="todo-main">
                  <div className="todo-title">{fund.label}</div>
                  {fund.note && <div className="todo-sub">{fund.note}</div>}
                </div>
                <Money value={fund.amount} />
              </div>
            ))}
            {charge > 0 && (
              <div className="todo-item">
                <div className="todo-main">
                  <div className="todo-title">上月超支划扣</div>
                </div>
                <span className="negative">-<Money value={charge} /></span>
              </div>
            )}
          </div>
        </Card>

        <Card title="月底结余">
          {month.status === 'draft' ? (
            <div className="modal-body">
              {remaining >= 0 ? (
                <>
                  <p>本月剩余 <Money value={remaining} /> 元，确认后会自动划入总结余。</p>
                  <div className="form-actions">
                    <Button onClick={() => run(() => finalizeMonth(monthKey, undefined, note))}>确认结余</Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="negative">本月超支 <Money value={-remaining} /> 元，需要选择来源。</p>
                  <div className="field">
                    <label htmlFor="overspend-source">超支来源</label>
                    <select id="overspend-source" value={overspendSource} onChange={e => setOverspendSource(e.target.value as typeof overspendSource)}>
                      <option value="summary">总结余</option>
                      <option value="nextMonth">下月资金</option>
                      <option value="parent">父母支援</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="overspend-note">备注</label>
                    <textarea id="overspend-note" value={note} onChange={e => setNote(e.target.value)} placeholder="例如：聚餐超支" />
                  </div>
                  <div className="form-actions">
                    <Button onClick={() => run(() => finalizeMonth(monthKey, overspendSource, note))}>确认超支并结余</Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="modal-body">
              {month.surplus !== undefined && <p>结余 <Money value={month.surplus} /> 元已划入总结余。</p>}
              {month.overspend && <p className="negative">超支 <Money value={month.overspend.amount} /> 元已从{month.overspend.source === 'summary' ? '总结余' : month.overspend.source === 'nextMonth' ? '下月资金' : '父母支援'}处理。</p>}
              {month.finalizedAt && <div className="todo-sub">结余时间：{new Date(month.finalizedAt).toLocaleString('zh-CN')}</div>}
              <div className="form-actions">
                <Button variant="ghost" onClick={() => run(() => reviseFinalizedMonth(monthKey))}>
                  <RotateCcw size={14} /> 修订结余
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Modal open={reallocateOpen} onClose={() => setReallocateOpen(false)} title="划拨预算">
        <div className="field">
          <label htmlFor="reallocate-from">来源分类</label>
          <select id="reallocate-from" value={fromId} onChange={e => setFromId(e.target.value)}>
            <option value="">请选择</option>
            {month.categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}（剩余 {c.budget.toFixed(2)}）</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="reallocate-to">目标分类</label>
          <select id="reallocate-to" value={toId} onChange={e => setToId(e.target.value)}>
            <option value="">请选择</option>
            {month.categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="reallocate-amount">划拨金额</label>
          <MoneyInput id="reallocate-amount" value={amount} onChange={setAmount} />
        </div>
        <div className="form-actions">
          <Button variant="ghost" onClick={() => setReallocateOpen(false)}>取消</Button>
          <Button onClick={submitReallocate} disabled={!fromId || !toId || amount <= 0}>确认划拨</Button>
        </div>
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="新增分类">
        <div className="field">
          <label htmlFor="new-cat-name">分类名称</label>
          <input id="new-cat-name" value={name} onChange={e => setName(e.target.value)} placeholder="例如：学习用品" />
        </div>
        <div className="field">
          <label htmlFor="new-cat-budget">预算金额</label>
          <MoneyInput id="new-cat-budget" value={budget} onChange={setBudget} />
        </div>
        <div className="form-actions">
          <Button variant="ghost" onClick={() => setAddOpen(false)}>取消</Button>
          <Button onClick={submitAdd} disabled={!name.trim() || budget < 0}>新增</Button>
        </div>
      </Modal>

      <Modal open={copyOpen} onClose={() => setCopyOpen(false)} title="复制分类">
        <div className="modal-body">
          <div className="field">
            <label htmlFor="copy-source-month">来源月份</label>
            <select id="copy-source-month" value={copySourceKey} onChange={e => setCopySourceKey(e.target.value)}>
              <option value="">请选择</option>
              {sourceMonths.map(key => (
                <option key={key} value={key}>
                  {months[key].label}（{months[key].categories.length} 个分类）
                </option>
              ))}
            </select>
          </div>
          <div className="todo-sub">将复制分类名称与预算金额，实际支出不会复制。</div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setCopyOpen(false)}>取消</Button>
            <Button
              onClick={() => {
                setCopyOpen(false);
                setCopyConfirmOpen(true);
              }}
              disabled={!copySourceKey}
            >
              下一步
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={copyConfirmOpen} onClose={() => setCopyConfirmOpen(false)} title="确认覆盖复制">
        <div className="modal-body">
          <p>
            将清空 {month.label} 现有 {month.categories.length} 个分类，并从 {copySourceKey ? months[copySourceKey].label : ''}{' '}
            复制 {copySourceKey ? months[copySourceKey].categories.length : 0} 个分类（含预算）。
          </p>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setCopyConfirmOpen(false)}>取消</Button>
            <Button onClick={submitCopy}>确认覆盖复制</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
