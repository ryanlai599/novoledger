import { useState } from 'react';
import { ArrowRightLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useFinanceStore } from '../store/useStore';
import type { IncomeSource, MonthPlan, Pocket, Transfer, TransferKind } from '../types';
import { Badge, Button, Card, EmptyState, ErrorBanner, Modal, Money, MoneyInput } from './ui';

function describeTransfer(transfer: Transfer, pockets: Pocket[], sources: IncomeSource[], months: Record<string, MonthPlan>) {
  const source = sources.find(s => s.id === transfer.fromId);
  const fromPocket = pockets.find(p => p.id === transfer.fromId);
  const toPocket = pockets.find(p => p.id === transfer.toId);
  const category = months[transfer.monthKey]?.categories.find(c => c.id === transfer.toCategoryId);
  if (transfer.kind === 'source-to-pocket') return `${source?.name ?? '来源池'} → ${toPocket?.name ?? '小荷包'}`;
  if (transfer.kind === 'pocket-to-pocket') return `${fromPocket?.name ?? '小荷包'} → ${toPocket?.name ?? '小荷包'}`;
  if (transfer.kind === 'pocket-to-summary') return `${fromPocket?.name ?? '小荷包'} → 总结余`;
  if (transfer.kind === 'summary-to-pocket') return `总结余 → ${toPocket?.name ?? '小荷包'}`;
  return `${fromPocket?.name ?? '小荷包'} → ${category?.name ?? '支出'}`;
}

export default function PocketsPage({ monthKey }: { monthKey: string }) {
  const pockets = useFinanceStore(s => s.pockets);
  const sources = useFinanceStore(s => s.incomeSources);
  const transfers = useFinanceStore(s => s.transfers);
  const corrections = useFinanceStore(s => s.corrections);
  const months = useFinanceStore(s => s.months);
  const executeTransfer = useFinanceStore(s => s.executeTransfer);
  const addTransfer = useFinanceStore(s => s.addTransfer);
  const correctPocket = useFinanceStore(s => s.correctPocket);
  const addPocket = useFinanceStore(s => s.addPocket);
  const removePocket = useFinanceStore(s => s.removePocket);

  const [error, setError] = useState('');
  const [correctionId, setCorrectionId] = useState('');
  const [actualBalance, setActualBalance] = useState(0);
  const [reason, setReason] = useState('');
  const [pocketOpen, setPocketOpen] = useState(false);
  const [pocketName, setPocketName] = useState('');
  const [pocketBalance, setPocketBalance] = useState(0);
  const [pocketNote, setPocketNote] = useState('');
  const [deletePocketId, setDeletePocketId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState<TransferKind>('source-to-pocket');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [targetMonthKey, setTargetMonthKey] = useState(monthKey);
  const [targetCategoryId, setTargetCategoryId] = useState('');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');

  const run = async (fn: () => Promise<void>) => {
    try {
      setError('');
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    }
  };

  const monthTransfers = transfers.filter(t => t.monthKey === monthKey);
  const fromOptions = kind === 'source-to-pocket' ? sources : kind === 'summary-to-pocket' ? [] : pockets;

  const submitAdd = () => {
    void run(async () => {
      await addTransfer({
        monthKey,
        kind,
        fromId: fromId || undefined,
        toId: toId || undefined,
        toCategoryId: kind === 'pocket-to-expense' ? targetCategoryId || undefined : undefined,
        amount,
        note: note || undefined
      });
      setAddOpen(false);
      setFromId('');
      setToId('');
      setTargetMonthKey(monthKey);
      setTargetCategoryId('');
      setAmount(0);
      setNote('');
    });
  };

  const targetMonth = months[targetMonthKey];
  const targetCategories = targetMonth?.categories ?? [];
  const changeTargetMonth = (value: string) => {
    setTargetMonthKey(value);
    setTargetCategoryId(months[value]?.categories[0]?.id ?? '');
  };

  const submitCorrection = () => {
    void run(async () => {
      await correctPocket(correctionId, actualBalance, reason || undefined);
      setCorrectionId('');
      setActualBalance(0);
      setReason('');
    });
  };

  const submitAddPocket = () => {
    void run(async () => {
      await addPocket(pocketName, pocketBalance, pocketNote || undefined);
      setPocketOpen(false);
      setPocketName('');
      setPocketBalance(0);
      setPocketNote('');
    });
  };

  const submitDeletePocket = () => {
    void run(async () => {
      await removePocket(deletePocketId);
      setDeletePocketId('');
    });
  };

  return (
    <>
      <ErrorBanner message={error} />

      <div className="pocket-grid">
        {pockets.filter(p => p.isActive).map(pocket => {
          const lastCorrection = [...corrections].reverse().find(c => c.pocketId === pocket.id);
          return (
            <Card key={pocket.id} title={pocket.name}>
              <div className="stat-value"><Money value={pocket.balance} /></div>
              {pocket.note && <div className="todo-sub">{pocket.note}</div>}
              {lastCorrection && <div className="todo-sub">最近校正：{lastCorrection.actualBalance.toFixed(2)} 元</div>}
              <div className="form-actions" style={{ marginTop: 10 }}>
                <Button variant="ghost" onClick={() => {
                  setCorrectionId(pocket.id);
                  setActualBalance(pocket.balance);
                  setReason('');
                }}>
                  <Pencil size={14} /> 余额校正
                </Button>
                <Button variant="danger" onClick={() => setDeletePocketId(pocket.id)}>
                  <Trash2 size={14} /> 删除
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card
        title={`${monthKey} 划扣指令`}
        action={
          <div className="form-actions inline">
            <Button variant="ghost" onClick={() => {
              setTargetMonthKey(monthKey);
              setTargetCategoryId(months[monthKey]?.categories[0]?.id ?? '');
              setAddOpen(true);
            }}>
              <Plus size={14} /> 手动转账
            </Button>
            <Button variant="ghost" onClick={() => setPocketOpen(true)}>
              <Plus size={14} /> 新增小荷包
            </Button>
          </div>
        }
      >
        {monthTransfers.length === 0 ? (
          <EmptyState text="本月没有划扣指令" />
        ) : (
          <div className="todo-list">
            {monthTransfers.map(transfer => (
              <div className="todo-item" key={transfer.id}>
                <div className="todo-main">
                  <div className="todo-title">{describeTransfer(transfer, pockets, sources, months)}</div>
                  <div className="todo-sub">{transfer.note ?? ''}</div>
                </div>
                <Money value={transfer.amount} />
                {transfer.status === 'executed' ? (
                  <Badge tone="green">已执行</Badge>
                ) : (
                  <Button variant="ghost" onClick={() => run(() => executeTransfer(transfer.id))}>
                    <ArrowRightLeft size={14} /> 执行
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={Boolean(correctionId)} onClose={() => setCorrectionId('')} title="余额校正">
        <div className="modal-body">
          <div className="field">
             <label htmlFor="actual-balance">实际余额</label>
            <MoneyInput id="actual-balance" value={actualBalance} onChange={setActualBalance} />
          </div>
          <div className="field">
            <label htmlFor="correction-reason">备注</label>
            <textarea id="correction-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：漏记一笔转账" />
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setCorrectionId('')}>取消</Button>
            <Button onClick={submitCorrection} disabled={actualBalance < 0}>确认校正</Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(deletePocketId)} onClose={() => setDeletePocketId('')} title="删除小荷包">
        <div className="modal-body">
          <p>确定删除小荷包「{pockets.find(p => p.id === deletePocketId)?.name ?? ''}」吗？删除后不可恢复。</p>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setDeletePocketId('')}>取消</Button>
            <Button variant="danger" onClick={submitDeletePocket}>确认删除</Button>
          </div>
        </div>
      </Modal>

      <Modal open={pocketOpen} onClose={() => setPocketOpen(false)} title="新增小荷包">
        <div className="modal-body">
          <div className="field">
            <label htmlFor="pocket-name">小荷包名称</label>
            <input id="pocket-name" value={pocketName} onChange={e => setPocketName(e.target.value)} placeholder="例如：餐饮基金" />
          </div>
          <div className="field">
             <label htmlFor="pocket-balance">实际余额</label>
            <MoneyInput id="pocket-balance" value={pocketBalance} onChange={setPocketBalance} />
          </div>
          <div className="field">
            <label htmlFor="pocket-note">备注</label>
            <input id="pocket-note" value={pocketNote} onChange={e => setPocketNote(e.target.value)} />
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setPocketOpen(false)}>取消</Button>
            <Button onClick={submitAddPocket} disabled={!pocketName.trim() || pocketBalance < 0}>新增</Button>
          </div>
        </div>
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="手动转账">
        <div className="modal-body">
          <div className="field">
            <label htmlFor="transfer-kind">转账类型</label>
            <select id="transfer-kind" value={kind} onChange={e => {
              setKind(e.target.value as TransferKind);
              setFromId('');
              setToId('');
              setTargetMonthKey(monthKey);
              setTargetCategoryId(e.target.value === 'pocket-to-expense' ? months[monthKey]?.categories[0]?.id ?? '' : '');
            }}>
              <option value="source-to-pocket">来源池 → 小荷包</option>
              <option value="pocket-to-pocket">小荷包 → 小荷包</option>
              <option value="pocket-to-summary">小荷包 → 总结余</option>
              <option value="summary-to-pocket">总结余 → 小荷包</option>
              <option value="pocket-to-expense">小荷包 → 支出</option>
            </select>
          </div>
          {fromOptions.length > 0 && (
            <div className="field">
              <label htmlFor="transfer-from">来源</label>
              <select id="transfer-from" value={fromId} onChange={e => setFromId(e.target.value)}>
                <option value="">请选择</option>
                {fromOptions.map(item => (
                  <option key={item.id} value={item.id}>{(item as { name: string }).name}</option>
                ))}
              </select>
            </div>
          )}
          {(kind === 'source-to-pocket' || kind === 'pocket-to-pocket' || kind === 'summary-to-pocket') && (
            <div className="field">
              <label htmlFor="transfer-to">去向小荷包</label>
              <select id="transfer-to" value={toId} onChange={e => setToId(e.target.value)}>
                <option value="">请选择</option>
                {pockets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {kind === 'pocket-to-expense' && (
            <>
              <div className="field">
                <label htmlFor="transfer-target-month">去向月份</label>
                <select id="transfer-target-month" value={targetMonthKey} onChange={e => changeTargetMonth(e.target.value)}>
                  {Object.keys(months).sort().map(key => (
                    <option key={key} value={key}>{months[key].label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="transfer-target-category">支出分类</label>
                <select id="transfer-target-category" value={targetCategoryId} onChange={e => setTargetCategoryId(e.target.value)}>
                  <option value="">请选择</option>
                  {targetCategories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="transfer-amount">金额</label>
            <MoneyInput id="transfer-amount" value={amount} onChange={setAmount} />
          </div>
          <div className="field">
            <label htmlFor="transfer-note">备注</label>
            <input id="transfer-note" value={note} onChange={e => setNote(e.target.value)} placeholder="例如：转9月生活费" />
          </div>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>取消</Button>
            <Button onClick={submitAdd} disabled={amount <= 0 || (kind === 'pocket-to-expense' && !targetCategoryId)}>添加指令</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
