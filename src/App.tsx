import { useEffect, useState, type ReactNode } from 'react';
import AppShell, { type PageKey } from './components/AppShell';
import Dashboard from './components/Dashboard';
import ExpenseRecordsPage from './components/ExpenseRecordsPage';
import MonthPlan from './components/MonthPlan';
import IncomePage from './components/IncomePage';
import PocketsPage from './components/PocketsPage';
import HistoryPage from './components/HistoryPage';
import BackupPage from './components/BackupPage';
import { loadFinanceStore, useFinanceStore } from './store/useStore';
import { ledgerRepository, legacyLedgerKey, readOriginalWorkspace, recoverUnavailableLedger } from './lib/ledgerDb';
import { downloadJson } from './lib/downloadJson';
import { todayLocalDate } from './lib/format';
import { Button, Card } from './components/ui';

export default function App() {
  const [page, setPage] = useState<PageKey>('dashboard');
  const [monthKey, setMonthKey] = useState(() => todayLocalDate().slice(0, 7));
  const notice = useFinanceStore(state => state.persistenceNotice);
  const status = useFinanceStore(state => state.status);
  const months = useFinanceStore(state => state.months);
  const activeMonth = months[monthKey] ? monthKey : Object.keys(months).sort()[0] ?? monthKey;
  const [legacyChanged, setLegacyChanged] = useState(false);
  useEffect(() => {
    const change = (event: StorageEvent) => { if (event.key === legacyLedgerKey) setLegacyChanged(true); };
    window.addEventListener('storage', change);
    return () => window.removeEventListener('storage', change);
  }, []);
  const [recoveryError, setRecoveryError] = useState('');
  const [recovery, setRecovery] = useState<{ name: string; json: string } | null>(null);

  if (status !== 'ready') return <main className="main-area">
    <Card title="NovoLedger · 本机账本">
      {status === 'loading' ? <p role="status">正在核验本机账本…</p> : <>
        <p role="alert">{notice}。不要清除站点数据。</p>
        <p>如需从云端恢复，可在独立浏览器配置解锁并导出已核对的云端 JSON，再回到此处导入。</p>
        {recoveryError && <p role="alert">{recoveryError}</p>}
        <div className="form-actions start">
          <Button onClick={() => {
            try {
              const raw = localStorage.getItem(legacyLedgerKey);
              if (!raw) throw new Error('本机没有旧账本封套');
              downloadJson(raw, 'novoledger-legacy-raw.json');
            } catch (e) { setRecoveryError(e instanceof Error ? e.message : '读取失败'); }
          }}>导出旧账本原文</Button>
          <Button variant="ghost" onClick={async () => {
            try {
              const raw = await readOriginalWorkspace();
              const copies = await ledgerRepository.backups();
              if (raw === null && copies.length === 0) throw new Error('没有可读取的 IndexedDB 副本');
              downloadJson(JSON.stringify({ workspace: raw, copies }, null, 2), 'novoledger-local-recovery.json');
            } catch (e) { setRecoveryError(e instanceof Error ? e.message : '读取失败'); }
          }}>导出 IndexedDB 恢复资料</Button>
        </div>
        <label>选择已核对的 JSON 账本 <input type="file" accept=".json,application/json" onChange={async event => {
          const file = event.target.files?.[0];
          if (file) {
            try { setRecovery({ name: file.name, json: await file.text() }); }
            catch { setRecoveryError('无法读取所选文件'); }
          }
        }} /></label>
        {recovery && <div>
          <p>将从「{recovery.name}」恢复；可读取的原始数据会先保留。</p>
          <Button variant="danger" onClick={async () => {
            try { await recoverUnavailableLedger(recovery.json); await loadFinanceStore(); }
            catch (e) { setRecoveryError(e instanceof Error ? e.message : '无法恢复'); }
          }}>确认恢复主账本</Button>
        </div>}
      </>}
    </Card>
  </main>;

  const pages: Record<PageKey, ReactNode> = {
    dashboard: <Dashboard monthKey={activeMonth} onNavigate={setPage} />,
    records: <ExpenseRecordsPage monthKey={activeMonth} />,
    month: <MonthPlan monthKey={activeMonth} onMonthChange={setMonthKey} />,
    income: <IncomePage />,
    pockets: <PocketsPage monthKey={activeMonth} />,
    history: <HistoryPage />,
    backup: <BackupPage />
  };

  return (
    <>
      <AppShell page={page} onPageChange={setPage} monthKey={activeMonth} onMonthChange={setMonthKey}>
        {legacyChanged && <p className="error-banner" role="alert">
          检测到旧标签页修改了独立旧副本，主账本未改变。请从数据备份导出两份核对。
        </p>}
        {notice && <div className="error-banner" role="alert">{notice}</div>}
        {pages[page]}
      </AppShell>
    </>
  );
}
