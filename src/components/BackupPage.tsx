import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useFinanceStore } from '../store/useStore';
import { downloadJson } from '../lib/downloadJson';
import { listRecoveryCopies } from '../lib/ledgerPersistence';
import { ledgerRepository, legacyLedgerKey, parseBackup, type LocalBackup } from '../lib/ledgerDb';
import { legacyEnvelope } from '../lib/sync';
import { Button, Card, ErrorBanner, Modal } from './ui';
import CloudSyncPanel from './CloudSyncPanel';

export default function BackupPage() {
  const exportJson = useFinanceStore(s => s.exportJson);
  const importJson = useFinanceStore(s => s.importJson);
  const resetAll = useFinanceStore(s => s.resetAll);
  const historyCount = useFinanceStore(s => s.history.length);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetArmed, setResetArmed] = useState<number | null>(null);
  const [pendingImport, setPendingImport] = useState<{ json: string; name: string; generation: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copies, setCopies] = useState<LocalBackup[]>([]);
  const workspace = useFinanceStore(s => s.workspace);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    void ledgerRepository.backups().then(result => { if (active) setCopies(result); },
      () => { if (active) setError('本机恢复副本读取失败'); });
    return () => { active = false; };
  }, [workspace?.serial]);
  let recoveries: ReturnType<typeof listRecoveryCopies> = [];
  let legacy = '';
  try {
    recoveries = listRecoveryCopies(localStorage);
    legacy = localStorage.getItem(legacyLedgerKey) ?? '';
  } catch {
    // Legacy access is only for recovery.
  }

  const handleExport = () => {
    downloadJson(exportJson(), `novoledger-backup-${new Date().toISOString().slice(0, 10)}.json`);
    setMessage('导出成功，请妥善保存这个 JSON 文件');
    setError('');
  };

  const handleImport = async (file: File) => {
    const generation = workspace!.generation;
    setError('');
    try {
      const json = await file.text();
      if (legacyEnvelope(json)) {
        setError('这是旧版加密副本。请使用下方「离线解密旧版备份」，输入加密时用的旧版同步码。');
        return;
      }
      parseBackup(json);
      setPendingImport({ json, name: file.name, generation });
    } catch (e) {
      setError(e instanceof SyntaxError ? '无法读取有效的 JSON，未修改账本。'
        : e instanceof Error ? e.message : '无法读取文件，未修改账本');
    }
  };

  const confirmImport = async () => {
    if (!pendingImport || busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    if (await importJson(pendingImport.json, pendingImport.generation)) {
      setMessage('备份检查完成；如有差异，原账本已备份并替换为选中的版本');
    } else {
      setError('未恢复：备份无效、本地存储不可用，或主账本已被另一标签页更新');
    }
    setPendingImport(null);
    setBusy(false);
  };

  return (
    <>
      <ErrorBanner message={error} />
      {message && <div className="badge badge-green" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="grid-2">
        <Card title="导出备份">
          <p>导出的 JSON 是未加密的完整账本，请保存在可信的私有位置，不要发给他人或上传到公开链接。</p>
          <div className="form-actions start">
            <Button onClick={handleExport}>
              <Download size={16} /> 导出 JSON
            </Button>
          </div>
          <div className="todo-sub" style={{ marginTop: 10 }}>当前账本共 {historyCount} 条操作记录</div>
        </Card>

        <Card title="导入恢复">
          <p>普通 JSON 无需密码。选择文件后先核对并确认；替换前会为当前账本保留一份本机副本。</p>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleImport(file);
              e.target.value = '';
            }}
          />
          <div className="form-actions start">
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={16} /> 选择备份文件
            </Button>
          </div>
        </Card>
      </div>

      <CloudSyncPanel />
      <Card title="本机恢复副本">
        <p>这里保留导入、重置前的版本，以及各标签页的最近工作副本。它们随浏览器站点数据清除而丢失，请将重要版本导出。</p>
        {legacy && <div className="form-actions start">
          <Button variant="ghost" onClick={() => downloadJson(legacy, 'novoledger-legacy-raw.json')}>导出当前旧标签页副本</Button>
          <span className="todo-sub">它不会自动进入主账本；更新后请先核对差异。</span>
          {copies.some(copy => copy.reason === '迁移前完整旧账本封套' && copy.json !== legacy) &&
            <span className="badge badge-amber">旧副本与迁移时不同，请核对</span>}
        </div>}
        {[...copies.map(copy => ({ ...copy, label: copy.reason })), ...recoveries].length === 0 && <p>暂无恢复副本。</p>}
        {[...copies.map(copy => ({ ...copy, label: copy.reason })), ...recoveries].map(copy => (
          <div key={copy.id} className="todo-item">
            <span>{copy.label}{copy.at && ` · ${new Date(copy.at).toLocaleString('zh-CN')}`}</span>
            <div className="form-actions inline">
              <Button variant="ghost" onClick={() => downloadJson(copy.json, 'novoledger-recovery.json')}>导出</Button>
              <Button variant="ghost" onClick={() => setPendingImport({
                json: copy.json, name: copy.label, generation: workspace!.generation
              })}>检查并恢复</Button>
            </div>
          </div>
        ))}
      </Card>
      <Card title="数据放在哪里">
        <p>账本默认仅存本机 IndexedDB。仅当已配对并主动点击提交时才会上传加密快照。</p>
        <p>换电脑或换手机时，先在这台设备点“导出 JSON”，再在新设备打开同一工作台点“导入恢复”。</p>
        <p>建议每月确认结余后导出一份备份，防止浏览器缓存被清理导致数据丢失。</p>
      </Card>

      <Card title="重置本机为空白账本">
        <p>先备份当前本机账本，再从空白当月开始。不会更改云端或解除配对；不要把重置结果提交给仍需保留的云账本。</p>
        <div className="form-actions start">
          <Button
            variant={resetArmed !== null ? 'danger' : 'ghost'}
            disabled={busy}
            onClick={async () => {
              if (resetArmed !== null) {
                setBusy(true);
                try {
                  await resetAll(resetArmed);
                  setMessage('本机已重置为空白账本，原账本已保存为恢复副本，未上传。');
                  setError('');
                } catch {
                  setMessage('');
                  setError('未重置：无法备份或主账本已被另一标签页更新');
                } finally {
                  setResetArmed(null);
                  setBusy(false);
                }
              } else {
                setResetArmed(workspace!.generation);
                setMessage('');
              }
            }}
          >
            {resetArmed !== null ? '再次点击确认重置' : '重置为空白账本'}
          </Button>
        </div>
      </Card>
      <Modal open={!!pendingImport} onClose={() => setPendingImport(null)} title="确认恢复备份">
        <p>{pendingImport?.name} 将用于恢复本机账本，不与当前记录合并。</p>
        <div className="form-actions">
          <Button variant="ghost" onClick={() => setPendingImport(null)}>取消</Button>
          <Button variant="danger" disabled={busy} onClick={confirmImport}>备份本地并恢复</Button>
        </div>
      </Modal>
    </>
  );
}
