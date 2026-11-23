import { useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { todayLocalDate } from '../lib/format';
import { useFinanceStore } from '../store/useStore';
import { Badge, Button, Card, EmptyState, ErrorBanner, Modal, Money, MoneyInput } from './ui';

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${year}年${Number(month)}月`;
}

function KindToggle({ value, onChange }: { value: 'expense' | 'income'; onChange: (value: 'expense' | 'income') => void }) {
  return (
    <div className="kind-toggle" role="group" aria-label="收支类型">
      <button type="button" className={value === 'expense' ? 'active' : ''} onClick={() => onChange('expense')}>支出</button>
      <button type="button" className={value === 'income' ? 'active' : ''} onClick={() => onChange('income')}>收入</button>
    </div>
  );
}

export default function ExpenseRecordsPage({ monthKey }: { monthKey: string }) {
  const months = useFinanceStore(s => s.months);
  const expenseRecords = useFinanceStore(s => s.expenseRecords);
  const addExpenseRecord = useFinanceStore(s => s.addExpenseRecord);
  const editExpenseRecord = useFinanceStore(s => s.editExpenseRecord);
  const removeExpenseRecord = useFinanceStore(s => s.removeExpenseRecord);
  const addCategory = useFinanceStore(s => s.addCategory);

  const [error, setError] = useState('');
  const saving = useRef(false);
  const [date, setDate] = useState(todayLocalDate());
  const [amount, setAmount] = useState(0);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState('');
  const [filter, setFilter] = useState<'all' | 'expense' | 'income'>('all');
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addCategoryMonthKey, setAddCategoryMonthKey] = useState('');
  const [addCategoryFromEdit, setAddCategoryFromEdit] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryBudget, setNewCategoryBudget] = useState(0);

  const formMonthKey = date.slice(0, 7);
  const formMonth = months[formMonthKey];
  const categories = formMonth?.categories ?? [];
  const [categoryId, setCategoryId] = useState(() => months[todayLocalDate().slice(0, 7)]?.categories[0]?.id ?? '');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editDate, setEditDate] = useState(todayLocalDate());
  const [editAmount, setEditAmount] = useState(0);
  const [editKind, setEditKind] = useState<'expense' | 'income'>('expense');
  const [editNote, setEditNote] = useState('');
  const editingRecord = expenseRecords.find(r => r.id === editing);

  const changeDate = (value: string) => {
    setDate(value);
    const nextMonth = months[value.slice(0, 7)];
    const options = nextMonth?.categories ?? [];
    setCategoryId(prev => (options.some(c => c.id === prev) ? prev : (options[0]?.id ?? '')));
  };

  const run = async (fn: () => Promise<void>) => {
    try {
      setError('');
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    }
  };

  const submit = () => {
    if (saving.current) return;
    saving.current = true;
    void run(async () => {
      await addExpenseRecord(date, amount, categoryId, { kind, note: note || undefined });
      setAmount(0);
      setNote('');
    }).finally(() => { saving.current = false; });
  };

  const submitNewCategory = () => {
    void run(async () => {
      const id = await addCategory(addCategoryMonthKey, newCategoryName, newCategoryBudget);
      if (addCategoryFromEdit) {
        setEditCategoryId(id);
      } else {
        setCategoryId(id);
      }
      setAddCategoryOpen(false);
      setAddCategoryMonthKey('');
      setAddCategoryFromEdit(false);
      setNewCategoryName('');
      setNewCategoryBudget(0);
    });
  };

  const openEdit = (recordId: string) => {
    const record = expenseRecords.find(r => r.id === recordId);
    if (!record) return;
    setEditing(recordId);
    setEditDate(record.date);
    setEditAmount(record.amount);
    setEditKind(record.kind ?? 'expense');
    setEditNote(record.note ?? '');
    setEditCategoryId(record.categoryId);
  };

  const submitEdit = () => {
    void run(async () => {
      await editExpenseRecord(editing, {
        date: editDate,
        amount: editAmount,
        categoryId: editCategoryId,
        kind: editKind,
        note: editNote || undefined
      });
      setEditing('');
    });
  };

  const monthRecords = expenseRecords
    .filter(r => r.date.startsWith(`${monthKey}-`))
    .filter(r => filter === 'all' || (r.kind ?? 'expense') === filter)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <ErrorBanner message={error} />

      <Card title="记一笔">
        <div className="grid-2">
          <div className="field">
            <label htmlFor="expense-date">日期</label>
            <div className="date-kind-row">
              <input id="expense-date" type="date" value={date} max={todayLocalDate()} onChange={e => changeDate(e.target.value)} />
              <KindToggle value={kind} onChange={setKind} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="expense-amount">金额</label>
            <MoneyInput id="expense-amount" value={amount} onChange={setAmount} />
          </div>
          <div className="field">
            <label htmlFor="expense-category">分类</label>
            <select id="expense-category" value={categoryId} onChange={e => {
              const value = e.target.value;
              if (value === '__add__') {
                setAddCategoryMonthKey(formMonthKey);
                setAddCategoryFromEdit(false);
                setAddCategoryOpen(true);
              } else {
                setCategoryId(value);
              }
            }}>
              {categories.length === 0 && <option value="">暂无分类</option>}
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="__add__" disabled={!date || date > todayLocalDate() || formMonth?.status === 'finalized'}>+ 新增分类</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="expense-note">备注</label>
            <input id="expense-note" value={note} onChange={e => setNote(e.target.value)} placeholder="选填" />
          </div>
        </div>
        <div className="form-actions">
          <Button onClick={submit} disabled={amount <= 0 || !categoryId}>
            <Plus size={16} /> 保存记录
          </Button>
        </div>
        {!formMonth && <div className="todo-sub">该日期尚无预算月份；选择「+ 新增分类」会一并创建该月份。</div>}
      </Card>

      <Card
        title={`${monthLabel(monthKey)} 明细`}
        action={
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="筛选收支类型">
            <option value="all">全部</option>
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
        }
      >
        {monthRecords.length === 0 ? (
          <EmptyState text="本月还没有记账记录" />
        ) : (
          <div className="todo-list">
            {monthRecords.map(record => {
              const category = months[monthKey]?.categories.find(c => c.id === record.categoryId);
              return (
                <div className="todo-item" key={record.id}>
                  <div className="todo-main">
                    <div className="todo-title">
                      <Badge tone={(record.kind ?? 'expense') === 'income' ? 'green' : 'amber'}>
                        {(record.kind ?? 'expense') === 'income' ? '收入' : '支出'}
                      </Badge>{' '}
                      {category?.name ?? '未知分类'} · {record.date}
                    </div>
                    {record.note && <div className="todo-sub">{record.note}</div>}
                  </div>
                  <Money value={record.amount} />
                  <Button variant="ghost" onClick={() => openEdit(record.id)} aria-label="编辑记录">
                    <Pencil size={14} />
                  </Button>
                  <Button variant="danger" onClick={() => run(() => removeExpenseRecord(record.id))} aria-label="删除记录">
                    <Trash2 size={14} />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal open={Boolean(editing && editingRecord)} onClose={() => setEditing('')} title="修改记账">
        <div className="modal-body">
          <div className="field">
            <label htmlFor="edit-date">日期</label>
            <div className="date-kind-row">
              <input id="edit-date" type="date" value={editDate} max={todayLocalDate()} onChange={e => {
                setEditDate(e.target.value);
                const options = months[e.target.value.slice(0, 7)]?.categories ?? [];
                setEditCategoryId(prev => (options.some(c => c.id === prev) ? prev : (options[0]?.id ?? '')));
              }} />
              <KindToggle value={editKind} onChange={setEditKind} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="edit-amount">金额</label>
            <MoneyInput id="edit-amount" value={editAmount} onChange={setEditAmount} />
          </div>
          <div className="field">
            <label htmlFor="edit-category">分类</label>
            <select id="edit-category" value={editCategoryId} onChange={e => {
              const value = e.target.value;
              if (value === '__add__') {
                setAddCategoryMonthKey(editDate.slice(0, 7));
                setAddCategoryFromEdit(true);
                setAddCategoryOpen(true);
              } else {
                setEditCategoryId(value);
              }
            }}>
              {(months[editDate.slice(0, 7)]?.categories ?? []).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              <option value="__add__">+ 新增分类</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-note">备注</label>
            <input id="edit-note" value={editNote} onChange={e => setEditNote(e.target.value)} />
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setEditing('')}>取消</Button>
            <Button onClick={submitEdit} disabled={editAmount <= 0 || !editCategoryId}>保存</Button>
          </div>
        </div>
      </Modal>

      <Modal open={addCategoryOpen} onClose={() => setAddCategoryOpen(false)} title="新增分类">
        <div className="modal-body">
          <div className="field">
            <label htmlFor="new-category-name">分类名称</label>
            <input id="new-category-name" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="new-category-budget">预算金额</label>
            <MoneyInput id="new-category-budget" value={newCategoryBudget} onChange={setNewCategoryBudget} />
          </div>
          <div className="todo-sub">分类会加入 {months[addCategoryMonthKey]?.label ?? ''}，与月度规划页同步。</div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setAddCategoryOpen(false)}>取消</Button>
            <Button onClick={submitNewCategory} disabled={!newCategoryName.trim() || newCategoryBudget < 0}>新增</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
