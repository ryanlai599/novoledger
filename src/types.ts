export type Id = string;

export interface IncomeSource {
  id: Id;
  name: string;
  kind: 'grant' | 'scholarship' | 'salary' | 'tutoring' | 'parent' | 'other';
}

export interface EditRecord {
  at: string;
  from: number;
  to: number;
  note?: string;
}

export interface IncomeEvent {
  id: Id;
  sourceId: Id;
  title: string;
  plannedAmount: number;
  actualAmount?: number;
  expectedAt: string;
  status: 'pending' | 'confirmed';
  tierOptions?: { label: string; amount: number }[];
  edits: EditRecord[];
  note?: string;
}

export interface Pocket {
  id: Id;
  name: string;
  balance: number;
  isActive: boolean;
  note?: string;
}

export type TransferKind =
  | 'source-to-pocket'
  | 'pocket-to-pocket'
  | 'pocket-to-summary'
  | 'summary-to-pocket'
  | 'pocket-to-expense';

export interface Transfer {
  id: Id;
  monthKey: string;
  kind: TransferKind;
  fromId?: Id;
  toId?: Id;
  toCategoryId?: Id;
  amount: number;
  date: string;
  status: 'planned' | 'executed';
  note?: string;
}

export interface Correction {
  id: Id;
  pocketId: Id;
  at: string;
  previousBalance: number;
  actualBalance: number;
  reason?: string;
}

export interface ExpenseRecord {
  id: Id;
  date: string;
  amount: number;
  categoryId: Id;
  kind: 'expense' | 'income';
  note?: string;
}

export interface ExpenseCategory {
  id: Id;
  name: string;
  budget: number;
  actual: number;
}

export interface FundingLine {
  id: Id;
  label: string;
  amount: number;
  note?: string;
}

export interface OverspendRecord {
  amount: number;
  source: 'summary' | 'nextMonth' | 'parent';
  at: string;
  note?: string;
}

export interface MonthPlan {
  key: string;
  label: string;
  categories: ExpenseCategory[];
  funding: FundingLine[];
  status: 'draft' | 'finalized';
  finalizedAt?: string;
  surplus?: number;
  overspend?: OverspendRecord;
}

export interface HistoryEvent {
  id: Id;
  at: string;
  type:
    | 'income_confirm'
    | 'income_edit'
    | 'transfer'
    | 'expense_update'
    | 'expense_record'
    | 'reallocate'
    | 'copy_categories'
    | 'correction'
    | 'finalize'
    | 'overspend'
    | 'backup'
    | 'import'
    | 'export'
    | 'other';
  title: string;
  detail?: string;
  amount?: number;
}

export interface LedgerState {
  version: number;
  incomeSources: IncomeSource[];
  incomeEvents: IncomeEvent[];
  sourcePools: Record<Id, number>;
  pockets: Pocket[];
  corrections: Correction[];
  expenseRecords: ExpenseRecord[];
  transfers: Transfer[];
  months: Record<string, MonthPlan>;
  summaryBalance: number;
  nextMonthCharges: Record<string, number>;
  history: HistoryEvent[];
}
