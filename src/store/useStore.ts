import { create } from 'zustand';
import { createEmptyLedger, emptyMonth } from '../data/seed';
import * as accounting from '../lib/accounting';
import { initializeLedger, ledgerRepository, onLedgerChange, parseBackup, type Workspace } from '../lib/ledgerDb';
import { sameLedger } from '../lib/ledgerSchema';
import type { ExpenseRecord, Id, IncomeSource, LedgerState, Transfer, TransferKind } from '../types';

type Patch = (state: LedgerState) => Partial<LedgerState>;
const inNode = typeof window === 'undefined';
function actions(set: (patch: Patch, reason?: string, expected?: number) => Promise<void>, exportJson: () => string) {
  const history = (state: LedgerState, title: string): LedgerState['history'] => [
    { id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), type: 'other', title },
    ...state.history
  ];
  return {
    confirmIncome: (id: Id, amount: number, note?: string) => set(s => accounting.confirmIncome(s, id, amount, note)),
    editIncome: (id: Id, amount: number, note?: string) => set(s => accounting.editIncome(s, id, amount, note)),
    addIncomeSource: (name: string, kind: IncomeSource['kind']) => set(state => {
      const id = `source-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return {
        incomeSources: [...state.incomeSources, { id, name, kind }],
        sourcePools: { ...state.sourcePools, [id]: 0 },
        history: history(state, `新增来源：${name}`)
      };
    }),
    renameIncomeSource: (id: Id, name: string) => set(state => ({
      incomeSources: state.incomeSources.map(source => source.id === id ? { ...source, name } : source),
      history: history(state, `来源改名：${name}`)
    })),
    removeIncomeSource: (id: Id) => set(state => {
      if (state.incomeEvents.some(event => event.sourceId === id)) throw new Error('该来源已有收入事件，不能删除');
      const source = state.incomeSources.find(item => item.id === id);
      const pools = { ...state.sourcePools };
      delete pools[id];
      return {
        incomeSources: state.incomeSources.filter(item => item.id !== id), sourcePools: pools,
        history: history(state, `删除来源：${source?.name ?? ''}`)
      };
    }),
    addIncomeEvent: (input: { sourceId: Id; title: string; plannedAmount: number; expectedAt: string }) => set(state => ({
      incomeEvents: [{
        ...input, id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, status: 'pending', edits: []
      }, ...state.incomeEvents],
      history: history(state, `新增收入事件：${input.title}`)
    })),
    removeIncomeEvent: (id: Id) => set(state => {
      const event = state.incomeEvents.find(item => item.id === id);
      if (!event) throw new Error('收入事件不存在');
      if (event.status === 'confirmed') throw new Error('已确认收入不能删除，可将金额修改为 0');
      return { incomeEvents: state.incomeEvents.filter(item => item.id !== id), history: history(state, `删除收入事件：${event.title}`) };
    }),
    executeTransfer: (id: Id) => set(s => accounting.executeTransfer(s, id)),
    addTransfer: (input: { monthKey: string; kind: TransferKind; fromId?: Id; toId?: Id; toCategoryId?: Id; amount: number; note?: string }) => set(state => {
      const transfer: Transfer = {
        ...input, id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        toCategoryId: input.kind === 'pocket-to-expense' ? input.toCategoryId : undefined,
        date: new Date().toISOString(), status: 'planned'
      };
      return { transfers: [transfer, ...state.transfers] };
    }),
    correctPocket: (id: Id, amount: number, note?: string) => set(s => accounting.correctPocket(s, id, amount, note)),
    addPocket: (name: string, amount: number, note?: string) => set(s => accounting.addPocket(s, name, amount, note)),
    removePocket: (id: Id) => set(s => accounting.removePocket(s, id)),
    addExpenseRecord: (date: string, amount: number, id: Id, options?: { kind?: 'expense' | 'income'; note?: string }) =>
      set(s => accounting.addExpenseRecord(s, date, amount, id, options)),
    editExpenseRecord: (id: Id, patch: Partial<Pick<ExpenseRecord, 'date' | 'amount' | 'categoryId' | 'note' | 'kind'>>) =>
      set(s => accounting.editExpenseRecord(s, id, patch)),
    removeExpenseRecord: (id: Id) => set(s => accounting.removeExpenseRecord(s, id)),
    updateCategory: (month: string, id: Id, patch: Partial<{ budget: number; actual: number }>, expectedBudget?: number) =>
      set(s => {
        if (expectedBudget !== undefined && s.months[month]?.categories.find(c => c.id === id)?.budget !== expectedBudget) {
          throw new Error('这项预算已变化，未覆盖，请核对后重输');
        }
        return accounting.updateCategory(s, month, id, patch);
      }),
    createMonth: (key: string) => set(s => {
      const month = emptyMonth(key);
      if (s.months[key]) return {};
      return { months: { ...s.months, [key]: month } };
    }),
    addCategory: async (month: string, name: string, budget: number) => {
      const id = `cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await set(s => accounting.addCategory(s.months[month] ? s : { ...s, months: { ...s.months, [month]: emptyMonth(month) } },
        month, name, budget, id));
      return id;
    },
    removeCategory: (month: string, id: Id) => set(s => accounting.removeCategory(s, month, id)),
    copyCategoriesFromMonth: (target: string, source: string) => set(s => accounting.copyCategoriesFromMonth(s, target, source)),
    reallocateBudget: (month: string, from: Id, to: Id, amount: number) => set(s => accounting.reallocateBudget(s, month, from, to, amount)),
    finalizeMonth: (month: string, source?: 'summary' | 'nextMonth' | 'parent', note?: string) =>
      set(s => accounting.finalizeMonth(s, month, source, note)),
    reviseFinalizedMonth: (month: string) => set(s => accounting.reviseFinalizedMonth(s, month)),
    exportJson,
    importJson: async (json: string, expected?: number) => {
      try {
        const data = parseBackup(json);
        await set(() => data, '导入前账本', expected);
        return true;
      } catch {
        return false;
      }
    },
    resetAll: (expected?: number) => set(() => createEmptyLedger(), '重置前账本', expected)
  };
}

type FinanceStore = LedgerState & ReturnType<typeof actions> & {
  workspace: Workspace | null;
  status: 'loading' | 'ready' | 'unavailable';
  persistenceNotice: string;
};

export const useFinanceStore = create<FinanceStore>()((apply, get) => {
  const empty = createEmptyLedger();
  let memory = empty;
  const set = async (patch: Patch, reason?: string, expected?: number) => {
    const nextLedger = (state: LedgerState) => accounting.validateImport(JSON.parse(JSON.stringify({ ...state, ...patch(state) })));
    if (inNode) {
      memory = nextLedger(memory);
      apply(memory);
      return;
    }
    if (get().status !== 'ready') throw new Error('本机账本尚不可用，未保存更改');
    const next = await ledgerRepository.update((work, backup) => {
      if (expected !== undefined && work.generation !== expected) throw new Error('账本已变化，请重新检查这次恢复');
      const current = accounting.validateImport(JSON.parse(work.json));
      const data = nextLedger(current);
      if (sameLedger(current, data)) return;
      if (reason) backup(work.json, reason);
      return { ...work, json: JSON.stringify(data), dirty: true, generation: work.generation + 1 };
    });
    if (next) applyWorkspace(next);
  };
  return {
    ...empty, status: inNode ? 'ready' : 'loading', workspace: null, persistenceNotice: '',
    ...actions(set, () => {
      if (!inNode && get().status !== 'ready') throw new Error('主账本不可读取，请导出原始副本');
      return JSON.stringify(inNode ? memory : JSON.parse(get().workspace!.json), null, 2);
    })
  };
});

export function applyWorkspace(workspace: Workspace) {
  const current = useFinanceStore.getState();
  if (current.status === 'ready' && current.workspace && current.workspace.serial >= workspace.serial) return;
  useFinanceStore.setState({
    ...accounting.validateImport(JSON.parse(workspace.json)), workspace, status: 'ready', persistenceNotice: ''
  });
}

function unavailable(error: unknown) {
  useFinanceStore.setState({
    status: 'unavailable', persistenceNotice: `本机账本未打开：${error instanceof Error ? error.message : '存储不可用'}`
  });
}

export async function loadFinanceStore() {
  try { applyWorkspace(await initializeLedger()); } catch (error) { unavailable(error); }
}

if (!inNode) {
  const refresh = () => {
    if (useFinanceStore.getState().status === 'ready') void ledgerRepository.read().then(applyWorkspace, unavailable);
  };
  onLedgerChange(refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
