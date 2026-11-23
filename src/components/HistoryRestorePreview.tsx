import type { ExpenseRecord, LedgerState } from '../types';
import { compareLedgers } from '../lib/ledgerComparison';
import { parseBackup } from '../lib/ledgerDb';
import { fmtMoney } from '../lib/format';

function describe(record: ExpenseRecord, ledger: LedgerState) {
  const category = ledger.months[record.date.slice(0, 7)]?.categories.find(item => item.id === record.categoryId)?.name;
  return `${record.date} · ${record.kind === 'income' ? '收入' : '支出'} ${fmtMoney(record.amount)} 元${category ? ` · ${category}` : ''}${record.note ? ` · ${record.note}` : ''}`;
}

export default function HistoryRestorePreview({ currentJson, targetJson, revision }: {
  currentJson: string; targetJson: string; revision: number;
}) {
  const current = parseBackup(currentJson);
  const target = parseBackup(targetJson);
  const diff = compareLedgers(current, target);
  const rows = [
    ['记账笔数', diff.current.records, diff.target.records],
    ['支出记录合计（元）', fmtMoney(diff.current.expense), fmtMoney(diff.target.expense)],
    ['小额收入记录合计（元）', fmtMoney(diff.current.income), fmtMoney(diff.target.income)],
    ['已确认总结余（元）', fmtMoney(diff.current.balance), fmtMoney(diff.target.balance)]
  ];
  return <>
    <p>确认后会先备份当前账本，再用版本 {revision} <strong>整份替换本机账本</strong>，不会合并或上传。之后若手动提交成功，会创建新版本，不会回拨云端版本号；如果云端已变化，需先核对冲突。</p>
    <div className="table-wrap">
      <table className="table" aria-label="历史恢复前后对比">
        <thead><tr><th>核对项</th><th>当前本机</th><th>恢复后</th></tr></thead>
        <tbody>{rows.map(([label, before, after]) =>
          <tr key={label}><th scope="row">{label}</th><td>{before}</td><td>{after}</td></tr>)}</tbody>
      </table>
    </div>
    <ul>
      <li>恢复后不在当前账本：{diff.onlyCurrent.length} 笔</li>
      <li>恢复后重新出现：{diff.onlyTarget.length} 笔</li>
      <li>同一笔内容会改变：{diff.modified.length} 笔</li>
    </ul>
    {([
      ['恢复后不在当前账本', diff.onlyCurrent],
      ['恢复后重新出现', diff.onlyTarget],
      ['同一笔内容会改变', diff.modified]
    ] as const).map(([label, entries], index) => entries.length > 0 &&
      <details key={label} open={index === 0}>
        <summary>{label}的明细（{entries.length} 笔）</summary>
        <ul>{entries.slice(0, 10).map(item => 'current' in item
          ? <li key={item.current.id}>当前：{describe(item.current, current)}<br />恢复后：{describe(item.target, target)}</li>
          : <li key={item.id}>{describe(item, index === 0 ? current : target)}</li>)}</ul>
        {entries.length > 10 && <p>这里只显示前 10 笔。请私下导出两份 JSON 查看完整明细。</p>}
      </details>)}
    {diff.affected.length > 0 && <p>还会改变：{diff.affected.join('、')}。可导出两份 JSON 核对。</p>}
  </>;
}
