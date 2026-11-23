import { Fragment, useState } from 'react';
import { CheckCircle2, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFinanceStore } from '../store/useStore';
import type { IncomeSource } from '../types';
import { Badge, Button, Card, ErrorBanner, Modal, Money, MoneyInput } from './ui';

export default function IncomePage() {
  const sources = useFinanceStore(s => s.incomeSources);
  const events = useFinanceStore(s => s.incomeEvents);
  const sourcePools = useFinanceStore(s => s.sourcePools);
  const confirmIncome = useFinanceStore(s => s.confirmIncome);
  const editIncome = useFinanceStore(s => s.editIncome);
  const addIncomeSource = useFinanceStore(s => s.addIncomeSource);
  const renameIncomeSource = useFinanceStore(s => s.renameIncomeSource);
  const removeIncomeSource = useFinanceStore(s => s.removeIncomeSource);
  const addIncomeEvent = useFinanceStore(s => s.addIncomeEvent);
  const removeIncomeEvent = useFinanceStore(s => s.removeIncomeEvent);

  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [tier, setTier] = useState('');
  const [editId, setEditId] = useState('');
  const [editAmount, setEditAmount] = useState(0);
  const [editNote, setEditNote] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const [sourceKind, setSourceKind] = useState<IncomeSource['kind']>('other');
  const [renameId, setRenameId] = useState('');
  const [renameName, setRenameName] = useState('');
  const [eventOpen, setEventOpen] = useState(false);
  const [eventSourceId, setEventSourceId] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventAmount, setEventAmount] = useState(0);
  const [eventAt, setEventAt] = useState('');

  const run = async (fn: () => Promise<void>) => {
    try {
      setError('');
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    }
  };

  const openConfirm = (eventId: string) => {
    const event = events.find(e => e.id === eventId);
    if (!event) return;
    setConfirmId(eventId);
    setAmount(event.plannedAmount);
    setNote('');
    if (event.tierOptions?.length) {
      setTier(String(event.tierOptions[0].amount));
    }
  };

  const openEdit = (eventId: string) => {
    const event = events.find(e => e.id === eventId);
    if (!event) return;
    setEditId(eventId);
    setEditAmount(event.actualAmount ?? event.plannedAmount);
    setEditNote('');
  };

  const confirm = () => {
    void run(async () => {
      await confirmIncome(confirmId, amount, note || undefined);
      setConfirmId('');
    });
  };

  const edit = () => {
    void run(async () => {
      await editIncome(editId, editAmount, editNote || undefined);
      setEditId('');
    });
  };

  const submitSource = () => {
    void run(async () => {
      await addIncomeSource(sourceName.trim(), sourceKind);
      setSourceOpen(false);
      setSourceName('');
      setSourceKind('other');
    });
  };

  const submitRename = () => {
    void run(async () => {
      await renameIncomeSource(renameId, renameName.trim());
      setRenameId('');
      setRenameName('');
    });
  };

  const submitEvent = () => {
    void run(async () => {
      await addIncomeEvent({ sourceId: eventSourceId, title: eventTitle.trim(), plannedAmount: eventAmount, expectedAt: eventAt.trim() });
      setEventOpen(false);
      setEventSourceId('');
      setEventTitle('');
      setEventAmount(0);
      setEventAt('');
    });
  };

  const sortedEvents = [...events].sort((a, b) => a.expectedAt.localeCompare(b.expectedAt));
  const confirmEvent = events.find(e => e.id === confirmId);

  return (
    <>
      <ErrorBanner message={error} />

      <div className="pocket-grid">
        {sources.map(source => {
          const pending = events.filter(e => e.sourceId === source.id && e.status === 'pending').reduce((sum, e) => sum + e.plannedAmount, 0);
          return (
            <div className="stat" key={source.id}>
              <div className="stat-label">{source.name}</div>
              <div className="stat-value"><Money value={sourcePools[source.id] ?? 0} /></div>
              {pending > 0 && <div className="todo-sub">待确认 {pending.toFixed(2)} 元</div>}
              <div className="form-actions" style={{ marginTop: 8 }}>
                <Button variant="subtle" onClick={() => { setRenameId(source.id); setRenameName(source.name); }}>
                  <Pencil size={13} /> 改名
                </Button>
                <Button variant="subtle" onClick={() => run(() => removeIncomeSource(source.id))}>
                  <Trash2 size={13} /> 删除
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Card
        title="收入事件"
        action={
          <div className="form-actions inline">
            <Button variant="ghost" disabled={!sources.length} onClick={() => setEventOpen(true)}>
              <Plus size={14} /> 新增收入
            </Button>
            <Button variant="ghost" onClick={() => setSourceOpen(true)}>
              <Plus size={14} /> 新增来源
            </Button>
          </div>
        }
      >
        {!sources.length && <p>还没有收入来源。请先新增来源，再登记收入。</p>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>事件</th><th>预计到账</th><th>计划金额</th><th>实际金额</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {sortedEvents.map(event => (
                <Fragment key={event.id}>
                  <tr key={event.id}>
                    <td>{event.title}</td>
                    <td>{event.expectedAt}</td>
                    <td><Money value={event.plannedAmount} /></td>
                    <td>{event.actualAmount !== undefined ? <Money value={event.actualAmount} /> : '—'}</td>
                    <td>
                      {event.status === 'confirmed' ? <Badge tone="green">已确认</Badge> : <Badge tone="amber">待确认</Badge>}
                    </td>
                    <td>
                      <div className="form-actions inline">
                        {event.status === 'pending' && (
                          <>
                            <Button onClick={() => openConfirm(event.id)}>
                              <CheckCircle2 size={14} /> 确认到账
                            </Button>
                            <Button variant="danger" onClick={() => run(() => removeIncomeEvent(event.id))} aria-label={`删除${event.title}`}>
                              <Trash2 size={14} />
                            </Button>
                          </>
                        )}
                        {event.status === 'confirmed' && (
                          <Button variant="ghost" onClick={() => openEdit(event.id)}>
                            <Pencil size={14} /> 修改金额
                          </Button>
                        )}
                        {event.edits.length > 0 && (
                          <Button variant="subtle" onClick={() => setExpandedId(expandedId === event.id ? '' : event.id)}>
                            <History size={14} /> 修改记录
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === event.id && event.edits.length > 0 && (
                    <tr key={`${event.id}-edits`}>
                      <td colSpan={6}>
                        <div className="todo-list">
                          {event.edits.map((edit, index) => (
                            <div className="todo-item" key={`${event.id}-edit-${index}`}>
                              <div className="todo-main">
                                <div className="todo-title">{new Date(edit.at).toLocaleString('zh-CN')}</div>
                                <div className="todo-sub">
                                  {edit.from.toFixed(2)} 元 → {edit.to.toFixed(2)} 元{edit.note ? ` · ${edit.note}` : ''}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={Boolean(confirmId)} onClose={() => setConfirmId('')} title="确认到账">
        {confirmEvent && (
          <div className="modal-body">
            <div className="todo-title">{confirmEvent.title}</div>
            {confirmEvent.tierOptions && (
              <div className="field">
                <label>奖学金档次</label>
                <div className="form-actions inline start">
                  {confirmEvent.tierOptions.map(option => (
                    <label key={option.amount} className="todo-item" style={{ cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="tier"
                        value={option.amount}
                        checked={tier === String(option.amount)}
                        onChange={() => {
                          setTier(String(option.amount));
                          setAmount(option.amount);
                        }}
                      />
                      <span>{option.label}（{option.amount} 元）</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="field">
              <label htmlFor="confirm-amount">实际到账金额</label>
              <MoneyInput id="confirm-amount" value={amount} onChange={setAmount} />
            </div>
            <div className="field">
              <label htmlFor="confirm-note">备注</label>
              <textarea id="confirm-note" value={note} onChange={e => setNote(e.target.value)} placeholder="可填写差异原因" />
            </div>
            <div className="form-actions">
              <Button variant="ghost" onClick={() => setConfirmId('')}>取消</Button>
              <Button onClick={confirm} disabled={amount < 0}>确认</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(editId)} onClose={() => setEditId('')} title="修改实际金额">
        <div className="modal-body">
          <div className="field">
            <label htmlFor="edit-amount">新实际金额</label>
            <MoneyInput id="edit-amount" value={editAmount} onChange={setEditAmount} />
          </div>
          <div className="field">
            <label htmlFor="edit-note">修改原因</label>
            <textarea id="edit-note" value={editNote} onChange={e => setEditNote(e.target.value)} />
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setEditId('')}>取消</Button>
            <Button onClick={edit} disabled={editAmount < 0}>保存修改</Button>
          </div>
        </div>
      </Modal>

      <Modal open={sourceOpen} onClose={() => setSourceOpen(false)} title="新增来源">
        <div className="modal-body">
          <div className="field">
            <label htmlFor="source-name">来源名称</label>
            <input id="source-name" value={sourceName} onChange={e => setSourceName(e.target.value)} placeholder="例如：兼职收入" />
          </div>
          <div className="field">
            <label htmlFor="source-kind">类型</label>
            <select id="source-kind" value={sourceKind} onChange={e => setSourceKind(e.target.value as IncomeSource['kind'])}>
              <option value="grant">助学金</option>
              <option value="scholarship">奖学金</option>
              <option value="salary">工资</option>
              <option value="tutoring">辅导</option>
              <option value="parent">父母支援</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setSourceOpen(false)}>取消</Button>
            <Button onClick={submitSource} disabled={!sourceName.trim()}>新增</Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(renameId)} onClose={() => setRenameId('')} title="来源改名">
        <div className="modal-body">
          <div className="field">
            <label htmlFor="rename-name">来源名称</label>
            <input id="rename-name" value={renameName} onChange={e => setRenameName(e.target.value)} />
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setRenameId('')}>取消</Button>
            <Button onClick={submitRename} disabled={!renameName.trim()}>保存</Button>
          </div>
        </div>
      </Modal>

      <Modal open={eventOpen} onClose={() => setEventOpen(false)} title="新增收入">
        <div className="modal-body">
          <div className="field">
            <label htmlFor="event-source">来源</label>
            <select id="event-source" value={eventSourceId} onChange={e => setEventSourceId(e.target.value)}>
              <option value="">请选择</option>
              {sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="event-title">事件名称</label>
            <input id="event-title" value={eventTitle} onChange={e => setEventTitle(e.target.value)} placeholder="例如：7月兼职费" />
          </div>
          <div className="field">
            <label htmlFor="event-amount">计划金额</label>
            <MoneyInput id="event-amount" value={eventAmount} onChange={setEventAmount} />
          </div>
          <div className="field">
            <label htmlFor="event-at">预计到账</label>
            <input id="event-at" value={eventAt} onChange={e => setEventAt(e.target.value)} placeholder="例如：2027-02初" />
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setEventOpen(false)}>取消</Button>
            <Button onClick={submitEvent} disabled={!eventSourceId || !eventTitle.trim() || eventAmount < 0 || !eventAt.trim()}>新增</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
