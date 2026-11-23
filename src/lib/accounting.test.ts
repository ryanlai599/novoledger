import { describe, expect, it } from 'vitest';
import { createEmptyLedger } from '../data/seed';
import { createSeedState } from '../test/ledgerFixture';
import {
  addExpenseRecord,
  addPocket,
  confirmIncome,
  copyCategoriesFromMonth,
  correctPocket,
  editIncome,
  editExpenseRecord,
  executeTransfer,
  finalizeMonth,
  migrateLedger,
  monthRemaining,
  monthTotal,
  projectedSummary,
  reallocateBudget,
  removeExpenseRecord,
  removePocket,
  validateImport,
  updateCategory
} from './accounting';

describe('accounting', () => {
  it('计算月度预算、实际和剩余', () => {
    const state = createSeedState();
    const month = state.months['2023-05'];
    expect(monthTotal(month, 'budget')).toBe(3030);
    expect(monthTotal(month, 'actual')).toBe(0);
    expect(monthRemaining(month)).toBe(3030);
  });

  it('确认收入后进入来源池并计入总结余', () => {
    let state = createSeedState();
    state = confirmIncome(state, 'sample-event-refund', 2310);
    expect(state.incomeEvents.find(e => e.id === 'sample-event-refund')?.status).toBe('confirmed');
    expect(state.sourcePools['sample-source-refund']).toBe(2310);
    expect(state.summaryBalance).toBe(2310);
  });

  it('修改已确认收入会同步调整池和总结余', () => {
    let state = createSeedState();
    state = confirmIncome(state, 'sample-event-contract', 940);
    state = editIncome(state, 'sample-event-contract', 820);
    expect(state.sourcePools['sample-source-contract']).toBe(820);
    expect(state.summaryBalance).toBe(820);
    expect(state.incomeEvents.find(e => e.id === 'sample-event-contract')?.edits.length).toBe(1);
  });

  it('执行来源池到小荷包的转账', () => {
    let state = createSeedState();
    state = confirmIncome(state, 'sample-event-payroll', 4180);
    state = executeTransfer(state, 'sample-transfer-home');
    expect(state.sourcePools['sample-source-payroll']).toBe(2110);
    expect(state.pockets.find(p => p.id === 'sample-pocket-home')?.balance).toBe(3650);
    expect(state.summaryBalance).toBe(2110);
  });

  it('余额不足时阻止来源池转账', () => {
    const state = createSeedState();
    expect(() => executeTransfer(state, 'sample-transfer-home')).toThrow(/余额不足/);
  });

  it('余额校正更新小荷包并记录', () => {
    let state = createSeedState();
    state = correctPocket(state, 'sample-pocket-transit', 1490, '样例余额校正');
    expect(state.pockets.find(p => p.id === 'sample-pocket-transit')?.balance).toBe(1490);
    expect(state.corrections.length).toBe(1);
  });

  it('更新实际支出后实时改变本月剩余', () => {
    let state = createSeedState();
    const category = state.months['2023-05'].categories[0];
    state = updateCategory(state, '2023-05', category.id, { actual: 1080 });
    expect(monthRemaining(state.months['2023-05'])).toBe(1950);
  });

  it('分类之间划拨富余预算', () => {
    let state = createSeedState();
    const [a, b] = state.months['2023-05'].categories;
    state = reallocateBudget(state, '2023-05', a.id, b.id, 200);
    const month = state.months['2023-05'];
    const catA = month.categories.find(c => c.id === a.id)!;
    const catB = month.categories.find(c => c.id === b.id)!;
    expect(catA.budget).toBe(1060);
    expect(catB.budget).toBe(1970);
    expect(monthTotal(month, 'budget')).toBe(3030);
  });

  it('月底结余把剩余预算转入总结余并锁定月份', () => {
    let state = createSeedState();
    const category = state.months['2023-05'].categories[0];
    state = updateCategory(state, '2023-05', category.id, { actual: 2040 });
    state = finalizeMonth(state, '2023-05');
    expect(state.months['2023-05'].status).toBe('finalized');
    expect(state.months['2023-05'].surplus).toBe(990);
    expect(state.summaryBalance).toBe(990);
  });

  it('超支从总结余扣减', () => {
    let state = createSeedState();
    state = confirmIncome(state, 'sample-event-refund', 2310);
    const category = state.months['2023-05'].categories[0];
    state = updateCategory(state, '2023-05', category.id, { actual: 4090 });
    state = finalizeMonth(state, '2023-05', 'summary', '样例超支');
    expect(state.months['2023-05'].overspend?.amount).toBe(1060);
    expect(state.summaryBalance).toBe(1250);
  });

  it('超支由父母支援时净额不改变总结余', () => {
    let state = createSeedState();
    const category = state.months['2023-05'].categories[0];
    state = updateCategory(state, '2023-05', category.id, { actual: 4090 });
    state = finalizeMonth(state, '2023-05', 'parent');
    expect(state.summaryBalance).toBe(0);
    expect(state.incomeEvents.some(e => e.sourceId === 'source-parent')).toBe(true);
  });

  it('预计总结余按计划金额计算', () => {
    const state = createSeedState();
    expect(projectedSummary(state)).toBe(5980);
  });

  it('导入校验拒绝非法数据', () => {
    expect(() => validateImport({ version: 1 })).toThrow(/无效/);
    expect(() => validateImport(createSeedState())).not.toThrow();
  });

  it('新增记账自动累加分类实际支出并更新剩余', () => {
    let state = createSeedState();
    const category = state.months['2023-04'].categories[0];
    state = addExpenseRecord(state, '2023-04-05', 200, category.id, { note: '样例购书' });
    expect(state.months['2023-04'].categories[0].actual).toBe(200);
    expect(monthRemaining(state.months['2023-04'])).toBe(990);
    expect(state.expenseRecords.length).toBe(1);
  });

  it('修改记账自动重算新旧分类实际支出', () => {
    let state = createSeedState();
    const [books, hobby] = state.months['2023-04'].categories;
    state = addExpenseRecord(state, '2023-04-05', 200, books.id, { note: '样例购书' });
    const recordId = state.expenseRecords[0].id;
    state = editExpenseRecord(state, recordId, { amount: 300, categoryId: hobby.id });
    expect(state.months['2023-04'].categories[0].actual).toBe(0);
    expect(state.months['2023-04'].categories[1].actual).toBe(300);
  });

  it('删除记账自动扣回分类实际支出', () => {
    let state = createSeedState();
    const category = state.months['2023-04'].categories[0];
    state = addExpenseRecord(state, '2023-04-05', 200, category.id);
    state = removeExpenseRecord(state, state.expenseRecords[0].id);
    expect(state.months['2023-04'].categories[0].actual).toBe(0);
    expect(state.expenseRecords.length).toBe(0);
  });

  it('拒绝记录未来日期', () => {
    const state = createEmptyLedger('9999-12');
    expect(() => addExpenseRecord(state, '9999-12-31', 1, 'irrelevant')).toThrow(/未来/);
  });

  it('小荷包划转到支出后增加分类预算', () => {
    let state = createSeedState();
    state = executeTransfer(state, 'sample-transfer-books');
    expect(state.pockets.find(p => p.id === 'sample-pocket-books')?.balance).toBe(0);
    expect(state.months['2023-04'].categories[0].budget).toBe(860);
  });

  it('旧数据自动补充 expenseRecords 并把存量实际转为期初补录', () => {
    const old = createSeedState();
    delete (old as { expenseRecords?: unknown }).expenseRecords;
    old.months['2023-04'].categories[0].actual = 100;
    const migrated = migrateLedger(old);
    expect(Array.isArray(migrated.expenseRecords)).toBe(true);
    expect(migrated.expenseRecords[0].amount).toBe(100);
    expect(migrated.expenseRecords[0].note).toBe('期初补录');
    expect(migrated.months['2023-04'].categories[0].actual).toBe(100);
    expect(() => validateImport(old)).not.toThrow();
  });

  it('复制其他月份分类会覆盖目标月分类且实际支出归零', () => {
    let state = createSeedState();
    state = copyCategoriesFromMonth(state, '2023-06', '2023-05');
    const target = state.months['2023-06'];
    const source = state.months['2023-05'];
    expect(target.categories.map(c => c.name)).toEqual(source.categories.map(c => c.name));
    expect(target.categories.map(c => c.budget)).toEqual(source.categories.map(c => c.budget));
    expect(target.categories.every(c => c.actual === 0)).toBe(true);
    expect(monthTotal(target, 'budget')).toBe(3030);
    expect(state.history[0].type).toBe('copy_categories');
  });

  it('目标月已有记账记录时禁止覆盖复制', () => {
    let state = createSeedState();
    const category = state.months['2023-04'].categories[0];
    state = addExpenseRecord(state, '2023-04-05', 50, category.id);
    expect(() => copyCategoriesFromMonth(state, '2023-04', '2023-05')).toThrow(/已有记账记录/);
  });

  it('目标月有未执行划扣指向旧分类时禁止覆盖复制', () => {
    const state = createSeedState();
    expect(() => copyCategoriesFromMonth(state, '2023-05', '2023-04')).toThrow(/未执行划扣/);
  });

  it('已结余目标月禁止覆盖复制，已结余来源月允许复制', () => {
    let state = createSeedState();
    state = finalizeMonth(state, '2023-04');
    expect(() => copyCategoriesFromMonth(state, '2023-04', '2023-05')).toThrow(/已结余/);
    state = copyCategoriesFromMonth(state, '2023-06', '2023-04');
    expect(state.months['2023-06'].categories.map(c => c.name)).toEqual(['样例图书', '样例爱好']);
  });

  it('收入记录增加分类预算且不影响实际支出', () => {
    let state = createSeedState();
    const category = state.months['2023-04'].categories[0];
    state = addExpenseRecord(state, '2023-04-05', 100, category.id, { kind: 'income', note: '小额收入' });
    expect(state.months['2023-04'].categories[0].budget).toBe(530);
    expect(state.months['2023-04'].categories[0].actual).toBe(0);
    expect(state.expenseRecords[0].kind).toBe('income');
  });

  it('支出记录改为收入时实际扣回、预算增加', () => {
    let state = createSeedState();
    const category = state.months['2023-04'].categories[0];
    state = addExpenseRecord(state, '2023-04-05', 60, category.id);
    const recordId = state.expenseRecords[0].id;
    state = editExpenseRecord(state, recordId, { kind: 'income' });
    expect(state.months['2023-04'].categories[0].budget).toBe(490);
    expect(state.months['2023-04'].categories[0].actual).toBe(0);
  });

  it('收入记录改为支出并换分类时预算扣回、新分类实际增加', () => {
    let state = createSeedState();
    const [first, second] = state.months['2023-04'].categories;
    state = addExpenseRecord(state, '2023-04-05', 80, first.id, { kind: 'income' });
    const recordId = state.expenseRecords[0].id;
    state = editExpenseRecord(state, recordId, { kind: 'expense', categoryId: second.id });
    expect(state.months['2023-04'].categories[0].budget).toBe(430);
    expect(state.months['2023-04'].categories[1].budget).toBe(760);
    expect(state.months['2023-04'].categories[1].actual).toBe(80);
  });

  it('删除收入记录扣回分类预算', () => {
    let state = createSeedState();
    const category = state.months['2023-04'].categories[0];
    state = addExpenseRecord(state, '2023-04-05', 50, category.id, { kind: 'income' });
    state = removeExpenseRecord(state, state.expenseRecords[0].id);
    expect(state.months['2023-04'].categories[0].budget).toBe(430);
  });

  it('旧记录缺少收支类型时迁移为支出', () => {
    let state = createSeedState();
    const category = state.months['2023-04'].categories[0];
    state = addExpenseRecord(state, '2023-04-05', 50, category.id);
    const legacy = {
      ...state,
      expenseRecords: [{ ...state.expenseRecords[0], kind: undefined as unknown as 'expense' }]
    };
    const migrated = migrateLedger(legacy);
    expect(migrated.expenseRecords[0].kind).toBe('expense');
  });

  it('新增小荷包并默认启用', () => {
    let state = createSeedState();
    state = addPocket(state, '餐饮基金', 88.5, '测试备注');
    const pocket = state.pockets.find(p => p.name === '餐饮基金');
    expect(pocket).toBeDefined();
    expect(pocket?.balance).toBe(88.5);
    expect(pocket?.isActive).toBe(true);
    expect(pocket?.note).toBe('测试备注');
    expect(() => addPocket(state, '  ', 1)).toThrow(/名称/);
    expect(() => addPocket(state, '负数', -1)).toThrow(/负数/);
  });

  it('余额为 0 且无未执行划扣时可删除小荷包', () => {
    let state = createSeedState();
    state = addPocket(state, '临时小荷包', 0);
    const pocketId = state.pockets.find(p => p.name === '临时小荷包')!.id;
    state = removePocket(state, pocketId);
    expect(state.pockets.some(p => p.id === pocketId)).toBe(false);
    expect(state.history[0].title).toContain('删除小荷包');
  });

  it('余额不为 0 或存在未执行划扣时禁止删除小荷包', () => {
    const state = createSeedState();
    expect(() => removePocket(state, 'sample-pocket-home')).toThrow(/余额/);
    const corrected = correctPocket(state, 'sample-pocket-home', 0);
    expect(() => removePocket(corrected, 'sample-pocket-home')).toThrow(/未执行划扣/);
  });
});
