import { money, todayIso, todayLocalDate } from './format';
import { readLedgerV1 } from './ledgerSchema';
import type { ExpenseCategory, ExpenseRecord, Id, LedgerState, MonthPlan } from '../types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushHistory(state: LedgerState, event: Omit<LedgerState['history'][number], 'id' | 'at'>): LedgerState {
  state.history.unshift({ ...event, id: uid('h'), at: todayIso() });
  return state;
}

export function monthTotal(month: MonthPlan, field: 'budget' | 'actual'): number {
  return money(month.categories.reduce((sum, c) => sum + c[field], 0));
}

export function monthRemaining(month: MonthPlan): number {
  return money(monthTotal(month, 'budget') - monthTotal(month, 'actual'));
}

export function pendingIncomeTotal(state: LedgerState): number {
  return money(state.incomeEvents.filter(e => e.status === 'pending').reduce((sum, e) => sum + e.plannedAmount, 0));
}

export function projectedSummary(state: LedgerState): number {
  const plannedOut = state.transfers
    .filter(t => t.status === 'planned' && (t.kind === 'source-to-pocket' || t.kind === 'summary-to-pocket'))
    .reduce((sum, t) => sum + t.amount, 0);
  return money(state.summaryBalance + pendingIncomeTotal(state) - plannedOut);
}

export function confirmIncome(state: LedgerState, eventId: Id, actualAmount: number, note?: string): LedgerState {
  const next = clone(state);
  const event = next.incomeEvents.find(e => e.id === eventId);
  if (!event) throw new Error('收入事件不存在');
  const amount = money(actualAmount);
  if (amount < 0) throw new Error('金额不能为负数');
  if (event.status === 'confirmed' && event.actualAmount !== undefined) {
    throw new Error('该收入已确认，请使用修改');
  }
  event.status = 'confirmed';
  event.actualAmount = amount;
  next.sourcePools[event.sourceId] = money((next.sourcePools[event.sourceId] ?? 0) + amount);
  next.summaryBalance = money(next.summaryBalance + amount);
  pushHistory(next, { type: 'income_confirm', title: `确认到账：${event.title}`, detail: note, amount });
  return next;
}

export function editIncome(state: LedgerState, eventId: Id, newAmount: number, note?: string): LedgerState {
  const next = clone(state);
  const event = next.incomeEvents.find(e => e.id === eventId);
  if (!event || event.status !== 'confirmed' || event.actualAmount === undefined) throw new Error('只有已确认收入可以修改');
  const amount = money(newAmount);
  if (amount < 0) throw new Error('金额不能为负数');
  const diff = money(amount - event.actualAmount);
  event.edits.push({ at: todayIso(), from: event.actualAmount, to: amount, note });
  event.actualAmount = amount;
  next.sourcePools[event.sourceId] = money((next.sourcePools[event.sourceId] ?? 0) + diff);
  next.summaryBalance = money(next.summaryBalance + diff);
  pushHistory(next, { type: 'income_edit', title: `修改到账：${event.title}`, detail: note, amount: diff });
  return next;
}

export function executeTransfer(state: LedgerState, transferId: Id): LedgerState {
  const next = clone(state);
  const transfer = next.transfers.find(t => t.id === transferId);
  if (!transfer) throw new Error('转账不存在');
  if (transfer.status === 'executed') return next;
  if (transfer.kind === 'source-to-pocket') {
    const pool = next.sourcePools[transfer.fromId ?? ''];
    if (pool === undefined || pool < transfer.amount) throw new Error(`余额不足：${transfer.note ?? '来源池'}`);
    next.sourcePools[transfer.fromId!] = money(pool - transfer.amount);
    next.summaryBalance = money(next.summaryBalance - transfer.amount);
    const pocket = next.pockets.find(p => p.id === transfer.toId);
    if (!pocket) throw new Error('小荷包不存在');
    pocket.balance = money(pocket.balance + transfer.amount);
  } else if (transfer.kind === 'pocket-to-pocket') {
    const from = next.pockets.find(p => p.id === transfer.fromId);
    const to = next.pockets.find(p => p.id === transfer.toId);
    if (!from || !to) throw new Error('小荷包不存在');
    if (from.balance < transfer.amount) throw new Error(`余额不足：${from.name}`);
    from.balance = money(from.balance - transfer.amount);
    to.balance = money(to.balance + transfer.amount);
  } else if (transfer.kind === 'pocket-to-summary') {
    const from = next.pockets.find(p => p.id === transfer.fromId);
    if (!from) throw new Error('小荷包不存在');
    if (from.balance < transfer.amount) throw new Error(`余额不足：${from.name}`);
    from.balance = money(from.balance - transfer.amount);
    next.summaryBalance = money(next.summaryBalance + transfer.amount);
  } else if (transfer.kind === 'summary-to-pocket') {
    if (next.summaryBalance < transfer.amount) throw new Error('总结余不足');
    next.summaryBalance = money(next.summaryBalance - transfer.amount);
    const to = next.pockets.find(p => p.id === transfer.toId);
    if (!to) throw new Error('小荷包不存在');
    to.balance = money(to.balance + transfer.amount);
  } else if (transfer.kind === 'pocket-to-expense') {
    const from = next.pockets.find(p => p.id === transfer.fromId);
    if (!from) throw new Error('小荷包不存在');
    if (from.balance < transfer.amount) throw new Error(`余额不足：${from.name}`);
    const month = next.months[transfer.monthKey];
    const category = month?.categories.find(c => c.id === transfer.toCategoryId);
    if (!month || !category) throw new Error('未选择支出分类或分类不存在');
    from.balance = money(from.balance - transfer.amount);
    category.budget = money(category.budget + transfer.amount);
  }
  transfer.status = 'executed';
  pushHistory(next, { type: 'transfer', title: `执行划扣：${transfer.note ?? transfer.id}`, amount: transfer.amount });
  return next;
}

export function correctPocket(state: LedgerState, pocketId: Id, actualBalance: number, reason?: string): LedgerState {
  const next = clone(state);
  const pocket = next.pockets.find(p => p.id === pocketId);
  if (!pocket) throw new Error('小荷包不存在');
  const actual = money(actualBalance);
  if (actual < 0) throw new Error('余额不能为负数');
  next.corrections.push({ id: uid('c'), pocketId, at: todayIso(), previousBalance: pocket.balance, actualBalance: actual, reason });
  pocket.balance = actual;
  pushHistory(next, { type: 'correction', title: `校正余额：${pocket.name}`, detail: reason, amount: actual });
  return next;
}

export function addPocket(state: LedgerState, name: string, balance: number, note?: string): LedgerState {
  const next = clone(state);
  if (!name.trim()) throw new Error('小荷包名称不能为空');
  const value = money(balance);
  if (value < 0) throw new Error('余额不能为负数');
  next.pockets.push({ id: uid('pocket'), name: name.trim(), balance: value, isActive: true, note });
  pushHistory(next, { type: 'other', title: `新增小荷包：${name.trim()}`, amount: value });
  return next;
}

export function removePocket(state: LedgerState, pocketId: Id): LedgerState {
  const next = clone(state);
  const pocket = next.pockets.find(p => p.id === pocketId);
  if (!pocket) throw new Error('小荷包不存在');
  if (pocket.balance > 0) throw new Error('余额不为 0，请先转出或校正为 0');
  if (next.transfers.some(t => t.status === 'planned' && (t.fromId === pocketId || t.toId === pocketId))) {
    throw new Error('存在未执行划扣引用该小荷包，请先处理');
  }
  next.pockets = next.pockets.filter(p => p.id !== pocketId);
  pushHistory(next, { type: 'other', title: `删除小荷包：${pocket.name}` });
  return next;
}

export function updateCategory(state: LedgerState, monthKey: string, categoryId: Id, patch: Partial<Pick<ExpenseCategory, 'budget' | 'actual'>>): LedgerState {
  const next = clone(state);
  const month = next.months[monthKey];
  if (!month || month.status === 'finalized') throw new Error('月份不存在或已结余');
  const category = month.categories.find(c => c.id === categoryId);
  if (!category) throw new Error('分类不存在');
  if (patch.budget !== undefined) {
    if (patch.budget < 0) throw new Error('金额不能为负数');
    category.budget = money(patch.budget);
  }
  if (patch.actual !== undefined) {
    if (patch.actual < 0) throw new Error('金额不能为负数');
    category.actual = money(patch.actual);
    pushHistory(next, { type: 'expense_update', title: `更新支出：${month.label} ${category.name}`, amount: category.actual });
  }
  return next;
}

function recordSum(state: LedgerState, monthKey: string, categoryId: Id): number {
  return money(
    state.expenseRecords
      .filter(r => r.categoryId === categoryId && r.date.startsWith(`${monthKey}-`) && (r.kind ?? 'expense') === 'expense')
      .reduce((sum, r) => sum + r.amount, 0)
  );
}

function syncCategoryActual(state: LedgerState, monthKey: string, categoryId: Id): LedgerState {
  const category = state.months[monthKey]?.categories.find(c => c.id === categoryId);
  if (category) category.actual = recordSum(state, monthKey, categoryId);
  return state;
}

function isRecordKind(value: unknown): value is 'expense' | 'income' {
  return value === 'expense' || value === 'income';
}

function adjustCategoryBudget(state: LedgerState, monthKey: string, categoryId: Id, delta: number): LedgerState {
  const category = state.months[monthKey]?.categories.find(c => c.id === categoryId);
  if (category) category.budget = money(category.budget + delta);
  return state;
}

function applyRecordEffect(
  state: LedgerState,
  monthKey: string,
  categoryId: Id,
  kind: 'expense' | 'income',
  amount: number,
  direction: 1 | -1
): LedgerState {
  if (kind === 'income') return adjustCategoryBudget(state, monthKey, categoryId, amount * direction);
  return syncCategoryActual(state, monthKey, categoryId);
}

function validateRecordDate(state: LedgerState, date: string): { monthKey: string; month: MonthPlan } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式无效');
  const monthKey = date.slice(0, 7);
  const month = state.months[monthKey];
  if (!month) throw new Error('日期所在月份不存在');
  if (month.status === 'finalized') throw new Error('该月份已结余，请先修订结余');
  if (date > todayLocalDate()) throw new Error('不能记录未来日期');
  return { monthKey, month };
}

export function addExpenseRecord(
  state: LedgerState,
  date: string,
  amount: number,
  categoryId: Id,
  options: { kind?: 'expense' | 'income'; note?: string } = {}
): LedgerState {
  const next = clone(state);
  const kind = options.kind ?? 'expense';
  if (!isRecordKind(kind)) throw new Error('收支类型无效');
  const { monthKey, month } = validateRecordDate(next, date);
  const category = month.categories.find(c => c.id === categoryId);
  if (!category) throw new Error('支出分类不存在');
  const value = money(amount);
  if (value < 0) throw new Error('金额不能为负数');
  next.expenseRecords.unshift({ id: uid('exp'), date, amount: value, categoryId, kind, note: options.note });
  applyRecordEffect(next, monthKey, categoryId, kind, value, 1);
  pushHistory(next, {
    type: 'expense_record',
    title: `${kind === 'income' ? '记收入' : '记账'}：${month.label} ${category.name}`,
    detail: options.note,
    amount: value
  });
  return next;
}

export function editExpenseRecord(
  state: LedgerState,
  recordId: Id,
  patch: Partial<Pick<ExpenseRecord, 'date' | 'amount' | 'categoryId' | 'note' | 'kind'>>
): LedgerState {
  const next = clone(state);
  const record = next.expenseRecords.find(r => r.id === recordId);
  if (!record) throw new Error('记账记录不存在');
  const oldMonthKey = record.date.slice(0, 7);
  const oldCategoryId = record.categoryId;
  const oldKind = record.kind ?? 'expense';
  const oldAmount = record.amount;
  if (next.months[oldMonthKey]?.status === 'finalized') throw new Error('原月份已结余，请先修订结余');
  const newDate = patch.date ?? record.date;
  const { monthKey, month } = validateRecordDate(next, newDate);
  const newCategoryId = patch.categoryId ?? record.categoryId;
  const category = month.categories.find(c => c.id === newCategoryId);
  if (!category) throw new Error('支出分类不存在');
  const newKind = patch.kind ?? oldKind;
  if (!isRecordKind(newKind)) throw new Error('收支类型无效');
  const newAmount = patch.amount !== undefined ? money(patch.amount) : oldAmount;
  if (newAmount < 0) throw new Error('金额不能为负数');
  next.expenseRecords = next.expenseRecords.filter(r => r.id !== recordId);
  applyRecordEffect(next, oldMonthKey, oldCategoryId, oldKind, oldAmount, -1);
  record.date = newDate;
  record.amount = newAmount;
  record.categoryId = newCategoryId;
  record.kind = newKind;
  if (patch.note !== undefined) record.note = patch.note;
  next.expenseRecords.unshift(record);
  applyRecordEffect(next, monthKey, newCategoryId, newKind, newAmount, 1);
  pushHistory(next, { type: 'expense_record', title: `修改记账：${month.label} ${category.name}`, amount: newAmount });
  return next;
}

export function removeExpenseRecord(state: LedgerState, recordId: Id): LedgerState {
  const next = clone(state);
  const record = next.expenseRecords.find(r => r.id === recordId);
  if (!record) throw new Error('记账记录不存在');
  const monthKey = record.date.slice(0, 7);
  const month = next.months[monthKey];
  if (month?.status === 'finalized') throw new Error('该月份已结余，请先修订结余');
  const kind = record.kind ?? 'expense';
  next.expenseRecords = next.expenseRecords.filter(r => r.id !== recordId);
  applyRecordEffect(next, monthKey, record.categoryId, kind, record.amount, -1);
  pushHistory(next, { type: 'expense_record', title: `删除记账：${month?.label ?? monthKey}`, amount: record.amount });
  return next;
}

export function addCategory(state: LedgerState, monthKey: string, name: string, budget: number, id?: Id): LedgerState {
  const next = clone(state);
  const month = next.months[monthKey];
  if (!month || month.status === 'finalized') throw new Error('月份不存在或已结余');
  if (!name.trim() || budget < 0) throw new Error('分类名称或金额无效');
  month.categories.push({ id: id ?? uid('cat'), name: name.trim(), budget: money(budget), actual: 0 });
  return next;
}

export function removeCategory(state: LedgerState, monthKey: string, categoryId: Id): LedgerState {
  const next = clone(state);
  const month = next.months[monthKey];
  if (!month || month.status === 'finalized') throw new Error('月份不存在或已结余');
  if (next.expenseRecords.some(r => r.categoryId === categoryId)) throw new Error('该分类已有记账记录，不能删除');
  month.categories = month.categories.filter(c => c.id !== categoryId);
  return next;
}

export function reallocateBudget(state: LedgerState, monthKey: string, fromCategoryId: Id, toCategoryId: Id, amount: number): LedgerState {
  const next = clone(state);
  const month = next.months[monthKey];
  if (!month || month.status === 'finalized') throw new Error('月份不存在或已结余');
  const from = month.categories.find(c => c.id === fromCategoryId);
  const to = month.categories.find(c => c.id === toCategoryId);
  if (!from || !to) throw new Error('分类不存在');
  const value = money(amount);
  if (value < 0 || from.budget < value) throw new Error('划拨金额无效或超出来源预算');
  from.budget = money(from.budget - value);
  to.budget = money(to.budget + value);
  pushHistory(next, { type: 'reallocate', title: `预算划拨：${from.name} → ${to.name}`, amount: value });
  return next;
}

export function copyCategoriesFromMonth(state: LedgerState, targetMonthKey: string, sourceMonthKey: string): LedgerState {
  const next = clone(state);
  const target = next.months[targetMonthKey];
  if (!target) throw new Error('目标月份不存在');
  if (target.status === 'finalized') throw new Error('目标月份已结余，请先修订结余');
  const source = next.months[sourceMonthKey];
  if (!source) throw new Error('来源月份不存在');
  if (sourceMonthKey === targetMonthKey) throw new Error('不能从当前月份复制');
  if (next.expenseRecords.some(r => r.date.startsWith(`${targetMonthKey}-`))) {
    throw new Error('目标月份已有记账记录，不能覆盖复制');
  }
  const hasPendingTargetTransfer = next.transfers.some(
    t =>
      t.kind === 'pocket-to-expense' &&
      t.status === 'planned' &&
      t.monthKey === targetMonthKey &&
      t.toCategoryId !== undefined &&
      target.categories.some(c => c.id === t.toCategoryId)
  );
  if (hasPendingTargetTransfer) {
    throw new Error('目标月份有未执行划扣指向旧分类，请先执行或删除');
  }
  target.categories = source.categories.map(category => ({
    id: uid('cat'),
    name: category.name,
    budget: money(category.budget),
    actual: 0
  }));
  pushHistory(next, {
    type: 'copy_categories',
    title: `复制分类：${source.label} → ${target.label}`,
    detail: `${source.categories.length} 个分类`,
    amount: monthTotal(source, 'budget')
  });
  return next;
}

function nextMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function finalizeMonth(state: LedgerState, monthKey: string, overspendSource?: 'summary' | 'nextMonth' | 'parent', note?: string): LedgerState {
  const next = clone(state);
  const month = next.months[monthKey];
  if (!month) throw new Error('月份不存在');
  if (month.status === 'finalized') throw new Error('月份已结余');
  const budget = monthTotal(month, 'budget');
  const actual = monthTotal(month, 'actual');
  const diff = money(budget - actual);
  if (diff >= 0) {
    month.surplus = diff;
    next.summaryBalance = money(next.summaryBalance + diff);
    pushHistory(next, { type: 'finalize', title: `确认结余：${month.label}`, detail: note, amount: diff });
  } else {
    const overspend = money(-diff);
    if (overspendSource === 'summary') {
      if (next.summaryBalance < overspend) throw new Error('总结余不足以覆盖超支');
      next.summaryBalance = money(next.summaryBalance - overspend);
    } else if (overspendSource === 'nextMonth') {
      const nextKey = nextMonthKey(monthKey);
      next.nextMonthCharges[nextKey] = money((next.nextMonthCharges[nextKey] ?? 0) + overspend);
    } else if (overspendSource === 'parent') {
      if (!next.incomeSources.some(source => source.id === 'source-parent')) {
        next.incomeSources.push({ id: 'source-parent', name: '父母支援', kind: 'parent' });
      }
      const parentEvent: LedgerState['incomeEvents'][number] = {
        id: uid('event-parent'),
        sourceId: 'source-parent',
        title: `父母支援：${month.label} 超支`,
        plannedAmount: overspend,
        actualAmount: overspend,
        expectedAt: todayIso().slice(0, 10),
        status: 'confirmed',
        edits: []
      };
      next.incomeEvents.push(parentEvent);
      next.sourcePools['source-parent'] = money((next.sourcePools['source-parent'] ?? 0) + overspend);
      next.summaryBalance = money(next.summaryBalance + overspend);
      next.sourcePools['source-parent'] = money(next.sourcePools['source-parent'] - overspend);
      next.summaryBalance = money(next.summaryBalance - overspend);
      pushHistory(next, { type: 'income_confirm', title: `父母支援到账：${month.label}`, amount: overspend });
    } else {
      throw new Error('超支必须选择来源');
    }
    month.overspend = { amount: overspend, source: overspendSource, at: todayIso(), note };
    pushHistory(next, { type: 'overspend', title: `超支登记：${month.label}`, detail: note, amount: overspend });
  }
  month.status = 'finalized';
  month.finalizedAt = todayIso();
  pushHistory(next, { type: 'finalize', title: `结余完成：${month.label}` });
  return next;
}

export function reviseFinalizedMonth(state: LedgerState, monthKey: string): LedgerState {
  const next = clone(state);
  const month = next.months[monthKey];
  if (!month || month.status !== 'finalized') throw new Error('月份未结余');
  if (month.surplus !== undefined) {
    next.summaryBalance = money(next.summaryBalance - month.surplus);
  }
  if (month.overspend) {
    if (month.overspend.source === 'summary') {
      next.summaryBalance = money(next.summaryBalance + month.overspend.amount);
    } else if (month.overspend.source === 'nextMonth') {
      const nextKey = nextMonthKey(monthKey);
      next.nextMonthCharges[nextKey] = money((next.nextMonthCharges[nextKey] ?? 0) - month.overspend.amount);
    }
  }
  delete month.surplus;
  delete month.overspend;
  delete month.finalizedAt;
  month.status = 'draft';
  pushHistory(next, { type: 'other', title: `修订结余：${month.label}` });
  return next;
}

export function validateImport(raw: unknown): LedgerState {
  return migrateLedger(readLedgerV1(raw));
}

export function migrateLedger(state: LedgerState): LedgerState {
  const next = clone(state);
  const hasRecords = Array.isArray(next.expenseRecords);
  const records: ExpenseRecord[] = hasRecords
    ? next.expenseRecords.map(r => ({ ...r, kind: r.kind ?? 'expense' }))
    : [];
  if (!hasRecords) {
    for (const month of Object.values(next.months ?? {})) {
      for (const category of month.categories) {
        if (category.actual > 0) {
          records.push({
            id: `exp-legacy:${month.key}:${category.id}`,
            date: `${month.key}-01`,
            amount: money(category.actual),
            categoryId: category.id,
            kind: 'expense',
            note: '期初补录'
          });
        }
      }
    }
  }
  next.expenseRecords = records;
  return next;
}
