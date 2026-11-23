import { beforeEach, describe, expect, it } from 'vitest';
import { useFinanceStore } from './useStore';
import { createSeedState } from '../test/ledgerFixture';

describe('finance store', () => {
  beforeEach(() => useFinanceStore.getState().importJson(JSON.stringify(createSeedState())));

  it('重置为空白，能创建月份和分类，并且重建月份不覆盖已有预算', async () => {
    const store = useFinanceStore.getState();
    await store.resetAll();
    expect(useFinanceStore.getState().incomeEvents).toEqual([]);
    expect(useFinanceStore.getState().pockets).toEqual([]);
    await store.createMonth('2020-01');
    const id = await store.addCategory('2020-01', '测试预算', 120);
    await store.createMonth('2020-01');
    expect(useFinanceStore.getState().months['2020-01'].categories[0]).toMatchObject({ id, budget: 120 });
    await store.addCategory('2020-02', '第一笔记账的分类', 0);
    expect(useFinanceStore.getState().months['2020-02'].categories).toHaveLength(1);
    await expect(store.createMonth('2020-13')).rejects.toThrow(/有效月份/);
  });

  it('确认收入后状态写入 store', async () => {
    await useFinanceStore.getState().confirmIncome('sample-event-refund', 2310);
    expect(useFinanceStore.getState().sourcePools['sample-source-refund']).toBe(2310);
  });

  it('导出和导入 JSON', async () => {
    const store = useFinanceStore.getState();
    await store.confirmIncome('sample-event-refund', 2310);
    const json = store.exportJson();
    expect(await store.importJson(json)).toBe(true);
    expect(useFinanceStore.getState().summaryBalance).toBe(2310);
  });

  it('新增来源和收入事件', async () => {
    const store = useFinanceStore.getState();
    await store.addIncomeSource('兼职收入', 'salary');
    const source = useFinanceStore.getState().incomeSources.find(s => s.name === '兼职收入');
    expect(source).toBeDefined();
    await store.addIncomeEvent({ sourceId: source!.id, title: '样例兼职收入', plannedAmount: 530, expectedAt: '2023-09' });
    expect(useFinanceStore.getState().incomeEvents.some(e => e.title === '样例兼职收入')).toBe(true);
  });

  it('删除待确认事件并拒绝删除已确认事件', async () => {
    const store = useFinanceStore.getState();
    await store.removeIncomeEvent('sample-event-refund');
    expect(useFinanceStore.getState().incomeEvents.some(e => e.id === 'sample-event-refund')).toBe(false);
    await store.confirmIncome('sample-event-contract', 940);
    await expect(store.removeIncomeEvent('sample-event-contract')).rejects.toThrow(/已确认/);
  });

  it('记账记录自动更新分类实际并随导出导入保留', async () => {
    const category = useFinanceStore.getState().months['2023-04'].categories[0];
    await useFinanceStore.getState().addExpenseRecord('2023-04-05', 100, category.id, { note: '测试' });
    expect(useFinanceStore.getState().months['2023-04'].categories[0].actual).toBe(100);
    const json = useFinanceStore.getState().exportJson();
    await useFinanceStore.getState().resetAll();
    expect(await useFinanceStore.getState().importJson(json)).toBe(true);
    expect(useFinanceStore.getState().expenseRecords.length).toBe(1);
  });

  it('通过 store 一键复制其他月份分类', async () => {
    await useFinanceStore.getState().copyCategoriesFromMonth('2023-06', '2023-05');
    const target = useFinanceStore.getState().months['2023-06'];
    const source = useFinanceStore.getState().months['2023-05'];
    expect(target.categories.map(c => c.name)).toEqual(source.categories.map(c => c.name));
    expect(target.categories.map(c => c.budget)).toEqual(source.categories.map(c => c.budget));
  });

  it('记账页新增分类返回新 id，收入记录计入该分类预算', async () => {
    const id = await useFinanceStore.getState().addCategory('2023-04', '临时收入', 0);
    expect(useFinanceStore.getState().months['2023-04'].categories.some(c => c.id === id && c.name === '临时收入')).toBe(true);
    await useFinanceStore.getState().addExpenseRecord('2023-04-05', 66, id, { kind: 'income' });
    expect(useFinanceStore.getState().months['2023-04'].categories.find(c => c.id === id)?.budget).toBe(66);
  });

  it('通过 store 新增小荷包', async () => {
    await useFinanceStore.getState().addPocket('备用金2', 10, '备注');
    expect(useFinanceStore.getState().pockets.some(p => p.name === '备用金2' && p.balance === 10 && p.note === '备注')).toBe(true);
  });

  it('同一个预算字段的过期编辑不会盖掉新值', async () => {
    const store = useFinanceStore.getState();
    const category = store.months['2023-04'].categories[0];
    await store.updateCategory('2023-04', category.id, { budget: 300 }, category.budget);
    await expect(store.updateCategory('2023-04', category.id, { budget: 400 }, category.budget)).rejects.toThrow(/未覆盖/);
    expect(useFinanceStore.getState().months['2023-04'].categories[0].budget).toBe(300);
  });

  it('通过 store 删除余额为 0 的小荷包', async () => {
    await useFinanceStore.getState().addPocket('待删除', 0);
    const pocket = useFinanceStore.getState().pockets.find(p => p.name === '待删除')!;
    await useFinanceStore.getState().removePocket(pocket.id);
    expect(useFinanceStore.getState().pockets.some(p => p.id === pocket.id)).toBe(false);
  });
});
