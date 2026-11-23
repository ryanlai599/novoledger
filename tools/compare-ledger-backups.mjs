import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function main() {
  if (process.argv.length !== 4) throw new Error('用法：node tools/compare-ledger-backups.mjs "第一份.json" "第二份.json"');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { outputFiles } = await build({
    stdin: {
      contents: `export { parseBackup } from './src/lib/ledgerDb';
        export { compareLedgers } from './src/lib/ledgerComparison';
        export { canonicalLedgerJson } from './src/lib/ledgerSchema';`,
      resolveDir: root
    },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent'
  });
  const { parseBackup, compareLedgers, canonicalLedgerJson } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`);
  const hash = value => createHash('sha256').update(value).digest('hex');
  const copies = await Promise.all(process.argv.slice(2).map(async (path, index) => {
    try {
      const raw = await readFile(path);
      const ledger = parseBackup(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      return {
        ledger, rawHash: hash(raw), contentHash: hash(canonicalLedgerJson(ledger)),
        size: Buffer.byteLength(JSON.stringify(ledger))
      };
    } catch {
      throw new Error(`第 ${index + 1} 份无法读取或未通过账本结构校验。请保留原件，确认它是已解密的 JSON。`);
    }
  }));
  const [first, second] = copies;
  const diff = compareLedgers(first.ledger, second.ledger);
  for (const [i, copy] of copies.entries()) {
    const totals = i === 0 ? diff.current : diff.target;
    console.log(`第 ${i + 1} 份：${totals.records} 笔 · 支出记录 ${totals.expense.toFixed(2)} 元 · 小额收入记录 ${totals.income.toFixed(2)} 元 · 已确认总结余 ${totals.balance.toFixed(2)} 元`);
    console.log(`  原文件 SHA-256：${copy.rawHash}\n  规范内容 SHA-256：${copy.contentHash}\n  紧凑 JSON：${copy.size} B${copy.size > 393120 ? '（超过当前客户端快照上限，停止迁移）' : ''}`);
  }
  console.log(first.contentHash === second.contentHash ? '结论：规范内容一致。' : '结论：内容不同，须逐项核对。');
  console.log(`记账：仅第一份 ${diff.onlyCurrent.length} 笔 · 仅第二份 ${diff.onlyTarget.length} 笔 · 同标识内容不同 ${diff.modified.length} 笔`);
  console.log(`其他差异：${diff.affected.join('、') || '无'}`);
}

try { await main(); }
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
