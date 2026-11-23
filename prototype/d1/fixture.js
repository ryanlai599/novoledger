export const fixtureLedger = () => ({
  version: 1, incomeSources: [], incomeEvents: [], sourcePools: {}, pockets: [],
  corrections: [], expenseRecords: [], transfers: [], summaryBalance: 0,
  nextMonthCharges: {}, history: [],
  months: {
    '2020-01': {
      key: '2020-01', label: '合成测试月', status: 'draft', funding: [],
      categories: [{ id: 'test-category', name: '合成分类', budget: 1000, actual: 0 }]
    }
  }
});
