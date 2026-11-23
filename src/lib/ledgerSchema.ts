import type { LedgerState } from '../types';

type Rule = (value: unknown) => boolean;
const text: Rule = value => typeof value === 'string';
const id: Rule = value => typeof value === 'string' && value.length > 0;
const number: Rule = value => typeof value === 'number' && Number.isFinite(value);
const amount: Rule = value => number(value) && (value as number) >= 0;
const oneOf = (...values: string[]): Rule => value => values.some(item => item === value);
const optional = (rule: Rule): Rule => value => value === undefined || rule(value);
const array = (rule: Rule): Rule => value => Array.isArray(value) && value.every(rule);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const shape = (fields: Record<string, Rule>): Rule => value =>
  object(value) && Object.entries(fields).every(([key, rule]) => rule(value[key]));
const map = (rule: Rule): Rule => value => object(value) && Object.values(value).every(rule);
const monthKey: Rule = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const date: Rule = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const fields: Record<keyof LedgerState, Rule> = {
  version: value => value === 1,
  incomeSources: array(shape({ id, name: text, kind: oneOf('grant', 'scholarship', 'salary', 'tutoring', 'parent', 'other') })),
  incomeEvents: array(shape({
    id, sourceId: id, title: text, plannedAmount: amount, actualAmount: optional(amount), expectedAt: text,
    status: oneOf('pending', 'confirmed'), note: optional(text),
    tierOptions: optional(array(shape({ label: text, amount }))),
    edits: array(shape({ at: text, from: amount, to: amount, note: optional(text) }))
  })),
  sourcePools: map(number),
  pockets: array(shape({ id, name: text, balance: amount, isActive: value => typeof value === 'boolean', note: optional(text) })),
  corrections: array(shape({ id, pocketId: id, at: text, previousBalance: amount, actualBalance: amount, reason: optional(text) })),
  expenseRecords: optional(array(shape({
    id, date, amount, categoryId: id, kind: optional(oneOf('expense', 'income')), note: optional(text)
  }))),
  transfers: array(shape({
    id, monthKey, date: text, amount, status: oneOf('planned', 'executed'),
    kind: oneOf('source-to-pocket', 'pocket-to-pocket', 'pocket-to-summary', 'summary-to-pocket', 'pocket-to-expense'),
    fromId: optional(id), toId: optional(id), toCategoryId: optional(id), note: optional(text)
  })),
  months: map(shape({
    key: monthKey, label: text, status: oneOf('draft', 'finalized'), finalizedAt: optional(text),
    surplus: optional(amount),
    overspend: optional(shape({ amount, at: text, source: oneOf('summary', 'nextMonth', 'parent'), note: optional(text) })),
    categories: array(shape({ id, name: text, budget: number, actual: amount })),
    funding: array(shape({ id, label: text, amount: number, note: optional(text) }))
  })),
  summaryBalance: number,
  nextMonthCharges: map(number),
  history: array(shape({
    id, at: text, title: text, detail: optional(text), amount: optional(number),
    type: oneOf('income_confirm', 'income_edit', 'transfer', 'expense_update', 'expense_record', 'reallocate',
      'copy_categories', 'correction', 'finalize', 'overspend', 'backup', 'import', 'export', 'other')
  }))
};

export function readLedgerV1(raw: unknown): LedgerState {
  if (!object(raw) || Object.keys(raw).some(key => !Object.prototype.hasOwnProperty.call(fields, key))) {
    throw new Error('无效的备份文件：账本结构不支持');
  }
  for (const [key, rule] of Object.entries(fields)) {
    if (!rule(raw[key])) throw new Error(`无效的备份文件：${key} 字段不合法`);
  }
  const ledger = raw as unknown as LedgerState;
  for (const [key, month] of Object.entries(ledger.months)) {
    if (key !== month.key || new Set(month.categories.map(category => category.id)).size !== month.categories.length) {
      throw new Error('无效的备份文件：月份或分类标识不合法');
    }
  }
  const recordIds = new Set<string>();
  for (const record of ledger.expenseRecords ?? []) {
    const key = record.date.slice(0, 7);
    if (recordIds.has(record.id) || !ledger.months[key]?.categories.some(category => category.id === record.categoryId)) {
      throw new Error('无效的备份文件：记账标识重复或分类引用不存在');
    }
    recordIds.add(record.id);
  }
  return ledger;
}

export function canonicalLedgerJson(value: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
  };
  return JSON.stringify(canonical(value));
}

export function sameLedger(left: unknown, right: unknown): boolean {
  return canonicalLedgerJson(left) === canonicalLedgerJson(right);
}
