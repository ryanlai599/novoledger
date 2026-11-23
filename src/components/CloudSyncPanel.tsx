import { useState } from 'react';
import { createSyncClient, importLegacyCiphertext, type CloudVersion, type HistoryPreview } from '../lib/d1Client';
import { isToken, newAccessToken, open, tokenDigest } from '../lib/d1Crypto';
import { ledgerRepository } from '../lib/ledgerDb';
import { downloadJson } from '../lib/downloadJson';
import { legacyEnvelope } from '../lib/sync';
import { useFinanceStore } from '../store/useStore';
import { Button, Card, ErrorBanner, Modal } from './ui';
import HistoryRestorePreview from './HistoryRestorePreview';

type Device = { id: string; label: string; role: 'owner' | 'device'; revokedAt: number | null };
type Session = { token: string; account: string; role: Device['role']; emptyCloud: boolean; client: ReturnType<typeof createSyncClient> };
let unlocked: Session | null = null;

async function request(token: string, action: 'session' | 'devices', body?: object) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`/api/sync-v2?${action}=1`, {
      method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body), signal: controller.signal
    });
    if (response.status === 401) throw new Error('设备令牌尚未登记、错误或已吊销。请核对设备令牌，不要填写 Cloudflare API Token。');
    if (response.status === 429) throw new Error('请求太频繁，请稍后重试。');
    if (!response.ok) throw new Error(`云端未确认请求（${response.status}），本机账本未改变`);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error('设备请求超时；本机账本未改变，请核对后重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function ledgerSummary(json: string) {
  const ledger = JSON.parse(json) as { expenseRecords: unknown[]; incomeEvents: unknown[]; months: object };
  return `${Object.keys(ledger.months).length} 个月份 · ${ledger.expenseRecords.length} 笔记账 · ${ledger.incomeEvents.length} 个收入事件`;
}

export default function CloudSyncPanel() {
  const canEncrypt = !!globalThis.crypto?.subtle;
  const enabled = import.meta.env.VITE_ENABLE_D1_SYNC === '1' && canEncrypt;
  const workspace = useFinanceStore(s => s.workspace)!;
  const importJson = useFinanceStore(s => s.importJson);
  const [session, setSession] = useState(unlocked);
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [secretAgain, setSecretAgain] = useState('');
  const [ownerDraft, setOwnerDraft] = useState<{ token: string; registration: string } | null>(null);
  const [showOwner, setShowOwner] = useState(false);
  const [savedOwner, setSavedOwner] = useState(false);
  const [emptyCloud, setEmptyCloud] = useState(unlocked?.emptyCloud ?? false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<CloudVersion[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [issued, setIssued] = useState<{ token: string; confirmed: boolean; label: string } | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: 'local' | 'cloud'; generation: number; operationId: string } |
    { kind: 'history'; preview: HistoryPreview } |
    { kind: 'revoke'; device: Device } | null
  >(null);
  const [legacyBlob, setLegacyBlob] = useState('');
  const [legacyCode, setLegacyCode] = useState('');
  const [legacyError, setLegacyError] = useState('');
  const [legacy, setLegacy] = useState<{ json: string; generation: number } | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : '操作未确认；请核对凭证或备份，本机数据未改变'); }
    finally { setBusy(false); }
  };

  const pair = () => run(async () => {
    const credential = token.trim();
    if (!isToken(credential) || secret.length < 16) throw new Error('需要有效的设备访问令牌和至少 16 字符的独立加密口令');
    if (secret === credential) throw new Error('独立加密口令不能使用设备令牌。');
    if (ownerDraft?.token === credential && (!savedOwner || secret !== secretAgain)) {
      throw new Error('请先安全保存管理员令牌，并输入两次相同的加密口令。');
    }
    const identity = await request(credential, 'session');
    if (!isToken(identity?.account) || !['owner', 'device'].includes(identity.role)) throw new Error('云端配对信息不合法');
    const before = await ledgerRepository.read();
    if (before.account && before.account !== identity.account) throw new Error('此设备已绑定另一账本。请先导出，在独立浏览器配置中配对；本机未改动');
    if (before.anchor) {
      await open(before.anchor.envelope, secret, {
        account: identity.account, revision: before.anchor.revision, operationId: before.anchor.operationId
      });
    }
    await ledgerRepository.update(current => {
      if (current.account && current.account !== identity.account) throw new Error('另一标签页已经绑定不同账本');
      if (current.anchor?.operationId !== before.anchor?.operationId) throw new Error('本机同步基准已变化，请重新解锁。');
      if (current.account === identity.account) return;
      return { ...current, account: identity.account };
    });
    unlocked = { account: identity.account, role: identity.role, token: credential, emptyCloud: false,
      client: createSyncClient({ token: credential, account: identity.account, secret, repository: ledgerRepository }) };
    setSession(unlocked);
    setToken('');
    setSecret('');
    setSecretAgain('');
    setOwnerDraft(null);
    setShowOwner(false);
    setSavedOwner(false);
    setEmptyCloud(false);
    setMessage('已解锁本页同步；不会自动上传。建议先检查云端，再决定提交或恢复。');
  });

  const act = () => run(async () => {
    if (!session || !confirm) return;
    if (confirm.kind === 'revoke') {
      await request(session.token, 'devices', { action: 'revoke', id: confirm.device.id });
      setDevices((await request(session.token, 'devices')).devices);
      setMessage('设备已吊销。已下载的本机账本不会被远程删除。');
    } else if (confirm.kind === 'history') {
      await confirm.preview.apply();
      setMessage('历史版本已恢复为本机草稿，请核对后再决定是否提交');
    } else {
      await session.client.resolveConflict(confirm.kind, confirm.generation, confirm.operationId);
      setMessage(confirm.kind === 'local' ? '两份已备份，保留本机；如需采用此版本请再次提交' : '两份已备份，选中的云端副本已恢复到本机');
    }
    setConfirm(null);
  });

  const conflict = workspace.conflict;
  const noBase = !workspace.anchor && !workspace.pending;
  const firstUpload = noBase && session?.role === 'owner' && emptyCloud;
  return <>
    <Card title="云同步 · 加密账本">
      <ErrorBanner message={error} />
      {message && <p role="status">{message}</p>}
      <p aria-label="同步状态">
        基准版本 {workspace.anchor?.revision ?? 0} · {workspace.dirty ? '有未同步修改' : '本机无待提交修改'}
        {workspace.pending && ` · 已保存待确认请求（基准 ${workspace.pending.operation.base}）`}
        {conflict && ` · 待核对云端版本 ${conflict.snapshot.revision}`}
      </p>
      {workspace.pending && <div className="form-actions start">
        <Button variant="ghost" onClick={() => downloadJson(workspace.pending!.json, 'novoledger-pending-ledger.json')}>导出待发账本副本</Button>
        <span className="todo-sub">这是未加密的账本副本；原请求仍保留在本机，请勿清除站点数据。</span>
      </div>}
      {!enabled ? <p>此构建未启用云端连接，或当前地址不是安全的 HTTPS 环境。仍可本机记账和导出 JSON。</p> : !session ? <>
        {!workspace.account && <details>
          <summary>首次使用：创建云端账本</summary>
          <ol>
            <li>在此生成管理员令牌，并把令牌私下保存在密码管理器。只把「登记校验值」交给获授权的操作员登记。</li>
            <li>登记成功后，用管理员令牌和新建的独立加密口令解锁。建议用密码管理器生成至少 20 个字符，不沿用旧同步码。</li>
            <li>点击「检查云端」。显示还没有同步版本时，核对本机内容，再主动提交第 1 版。</li>
          </ol>
          {!ownerDraft ? <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
            const value = newAccessToken();
            const registration = `novo-owner-v1:${await tokenDigest(value)}`;
            setOwnerDraft({ token: value, registration });
            setToken(value);
            setSecretAgain('');
          })}>生成管理员令牌</Button> : <>
            <div className="field"><label htmlFor="new-owner-token">管理员令牌（私下保存，刷新后无法重看）</label>
              <input id="new-owner-token" type={showOwner ? 'text' : 'password'} readOnly value={ownerDraft.token} autoComplete="off" />
              <Button variant="ghost" onClick={() => setShowOwner(!showOwner)}>{showOwner ? '隐藏管理员令牌' : '显示管理员令牌'}</Button>
            </div>
            <div className="field"><label htmlFor="owner-registration">登记校验值（可交给获授权的操作员，不能登录）</label>
              <input id="owner-registration" readOnly value={ownerDraft.registration} spellCheck={false} />
              {navigator.clipboard && <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
                await navigator.clipboard.writeText(ownerDraft.registration);
                setMessage('已复制登记校验值，不含管理员令牌。');
              })}>复制登记校验值</Button>}
            </div>
            <label><input type="checkbox" checked={savedOwner} onChange={e => setSavedOwner(e.target.checked)} /> 已私下保存管理员令牌</label>
          </>}
        </details>}
        <p>已有云账本：请用管理员发给这台设备的令牌，以及同一账本的加密口令。两台设备使用不同令牌、同一个加密口令。</p>
        <div className="field"><label htmlFor="d1-token">设备访问令牌</label>
          <input id="d1-token" type="password" value={token} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={e => setToken(e.target.value)} /></div>
        <div className="field"><label htmlFor="d1-secret">独立加密口令</label>
          <input id="d1-secret" type="password" value={secret} autoComplete="off" onChange={e => setSecret(e.target.value)} /></div>
        {ownerDraft && ownerDraft.token === token.trim() && <div className="field">
          <label htmlFor="d1-secret-again">再次输入新加密口令</label>
          <input id="d1-secret-again" type="password" value={secretAgain} autoComplete="off" onChange={e => setSecretAgain(e.target.value)} />
        </div>}
        <p>不要填写 Cloudflare 部署 API Token。加密口令只在本机使用，遗失后无法从云端找回明文。请保留独立 JSON 备份。</p>
        <Button onClick={pair} disabled={busy || !token || !secret}>解锁云同步</Button>
        <details>
          <summary>丢失凭证怎么办？</summary>
          <p>普通设备令牌丢失时，由管理员在设备列表吊销后重新发放。管理员令牌没有自助重置；先从密码管理器或安全备份找回。加密口令丢失时，可从仍可读取的设备导出 JSON，或使用独立 JSON 备份；不要清除站点数据。吊销不会删除设备已经保存的本机账本。</p>
        </details>
      </> : <>
        {noBase && !conflict && <p>{firstUpload ? '云端还没有版本。核对本机账本后，可提交为第 1 版。'
          : '先点「检查云端」。新设备若看到已有云端版本，请核对并选用云端，不要用空白账本覆盖。'}</p>}
        <div className="form-actions start">
        <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
          session.emptyCloud = false;
          setEmptyCloud(false);
          const revision = await session.client.reviewCloud();
          session.emptyCloud = revision === 0;
          setEmptyCloud(session.emptyCloud);
          setMessage(revision === 0
            ? '云端还没有同步版本；请在首台设备核对账本后初始化。'
            : `已检查云端版本 ${revision}，未自动替换本机账本。`);
        })}>检查云端</Button>
        <Button disabled={busy || (noBase && !firstUpload) || (!workspace.dirty && !workspace.pending) || (!!conflict && !workspace.pending)} onClick={() => run(async () => {
          const result = await session.client.submit();
          setMessage(result.kind === 'conflict'
            ? result.expired ? '待发请求已超过保留窗口；不能判定旧提交结果，请核对双方副本' : '云端已更新，两份账本仍保留，请人工核对'
            : result.kind === 'committed' ? `已确认云端版本 ${result.revision}${result.replay ? '（原请求收据）' : ''}` : '没有待提交修改');
        })}>{workspace.pending ? '重试待发请求' : '提交本机修改'}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => {
          unlocked = null; setSession(null); setEmptyCloud(false); setVersions([]); setDevices([]); setIssued(null);
        }}>锁定云同步</Button>
        </div>
      </>}
      {conflict && <div className="modal-body">
        <h4>本机与云端不一致</h4>
        <div>本机：{ledgerSummary(workspace.json)}</div>
        <div>云端版本 {conflict.snapshot.revision}：{ledgerSummary(conflict.json)}</div>
        <div className="form-actions start">
          <Button variant="ghost" onClick={() => downloadJson(workspace.json, 'novoledger-local-branch.json')}>导出本机分支</Button>
          <Button variant="ghost" onClick={() => downloadJson(conflict.json, 'novoledger-cloud-branch.json')}>导出云端分支</Button>
          {session && (['local', 'cloud'] as const).map(kind => (
            <Button variant="ghost" key={kind} disabled={busy} onClick={() => setConfirm({
              kind, generation: workspace.generation, operationId: conflict.snapshot.operationId
            })}>{kind === 'local' ? '保留本机' : '选用云端'}</Button>
          ))}
        </div>
      </div>}
      {session && <div className="modal-body">
        <Button variant="ghost" disabled={busy} onClick={() => run(async () => { setVersions(await session.client.history()); })}>读取云端历史</Button>
        {versions.map(item => <div className="todo-item" key={item.operationId}>
          <span>版本 {item.revision} · {new Date(item.createdAt * 1000).toLocaleString('zh-CN')}</span>
          <Button variant="ghost" disabled={busy || !!conflict || !!workspace.pending} onClick={() => run(async () => {
            const preview = await session.client.previewHistory(item.revision, item.operationId);
            setConfirm({ kind: 'history', preview });
          })}>预览并恢复</Button>
        </div>)}
      </div>}
    </Card>
    {session?.role === 'owner' && <Card title="同步设备管理">
      <p>在首台设备提交第 1 版后，为手机等另一台设备发放单独的令牌。请通过安全渠道交付令牌，另行传递同一独立加密口令。</p>
      <Button variant="ghost" disabled={busy} onClick={() => run(async () => { setDevices((await request(session.token, 'devices')).devices); })}>刷新设备列表</Button>
      {devices.map(device => <div className="todo-item" key={device.id}>
        <span>{device.label} · {device.revokedAt ? '已吊销' : device.role === 'owner' ? '管理员' : '有效'}</span>
        {!device.revokedAt && device.role === 'device' && <Button variant="danger" disabled={busy}
          onClick={() => setConfirm({ kind: 'revoke', device })}>吊销设备</Button>}
      </div>)}
      <div className="field"><label htmlFor="device-label">新设备名称</label>
        <input id="device-label" value={deviceLabel} maxLength={40} onChange={e => setDeviceLabel(e.target.value)} /></div>
      <Button disabled={busy || !workspace.anchor || (!issued && !deviceLabel.trim()) || !!issued?.confirmed} onClick={() => run(async () => {
        const candidate = issued ?? { token: newAccessToken(), confirmed: false, label: deviceLabel.trim() };
        setIssued(candidate);
        await request(session.token, 'devices', { action: 'issue', label: candidate.label, token: candidate.token });
        setIssued({ ...candidate, confirmed: true });
        setMessage('已发放新令牌，请仅交给目标设备，并另行传递加密口令');
      })}>{issued && !issued.confirmed ? '重试发放同一令牌' : '发放设备令牌'}</Button>
      {issued && <div className="field">
        <label htmlFor="issued-token">{issued.confirmed ? '已发放令牌（离开页面后不再显示）' : '候选令牌（尚未确认，勿分享）'}</label>
        <input id="issued-token" readOnly value={issued.token} autoComplete="off" spellCheck={false} />
        {issued.confirmed && navigator.clipboard && <Button variant="ghost" disabled={busy} onClick={() => run(async () => {
          await navigator.clipboard.writeText(issued.token);
          setMessage('已复制新设备令牌。请只在安全渠道发送，使用后清理剪贴板。');
        })}>复制新设备令牌</Button>}
        <Button variant="ghost" disabled={busy} onClick={() => setIssued(null)}>清除显示</Button>
      </div>}
    </Card>}
    <Card title="离线解密旧版备份">
      <ErrorBanner message={legacyError} />
      <p>只有旧版加密副本才需要在这里解密。解密码就是加密这份文件时的旧版同步码，不是新版口令或设备令牌。</p>
      <p>普通 JSON 请用「导入恢复」，不需要口令。这里不会连接旧云端，也不会发送你的同步码。</p>
      {!canEncrypt && <p>当前地址不支持本机解密，请使用 HTTPS 或 localhost。</p>}
      <div className="field"><label htmlFor="legacy-envelope">旧加密文件</label>
        <input id="legacy-envelope" type="file" accept=".json,application/json" onChange={async e => {
          const field = e.currentTarget;
          const file = field.files?.[0];
          setLegacyBlob('');
          setLegacyError('');
          if (!file) return;
          try {
            const text = await file.text();
            if (field.files?.[0] !== file) return;
            if (!legacyEnvelope(text)) throw new Error('这不是可识别的旧加密副本。普通 JSON 无需口令，请使用「导入恢复」。');
            setLegacyBlob(text);
          }
          catch (e) { if (field.files?.[0] === file) setLegacyError(e instanceof Error ? e.message : '旧加密文件读取失败'); }
        }} />
      </div>
      <div className="field"><label htmlFor="legacy-code">旧版同步码（8–32 位）</label>
        <input id="legacy-code" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={legacyCode} onChange={e => setLegacyCode(e.target.value)} /></div>
      <Button variant="ghost" disabled={!canEncrypt || busy || !legacyBlob || !legacyCode} onClick={() => run(async () => {
        const code = legacyCode;
        setLegacyCode('');
        setLegacyError('');
        try {
          const json = await importLegacyCiphertext(legacyBlob, code);
          setLegacy({ json, generation: workspace.generation });
        } catch (e) {
          setLegacyError(e instanceof Error ? e.message : '无法解密，未修改本机账本');
        }
      })}>解密并预览旧备份</Button>
    </Card>
    <Modal open={!!confirm} title={confirm?.kind === 'history' ? `恢复预览：云端版本 ${confirm.preview.revision}` : '确认恢复或设备操作'}
      onClose={() => { if (!busy) setConfirm(null); }}>
      {confirm?.kind === 'history' ? <>
        <HistoryRestorePreview {...confirm.preview} />
        <ErrorBanner message={error} />
        <p>导出的 JSON 未加密，请单独妥善保存，不要公开分享。</p>
        <div className="form-actions start">
          <Button variant="ghost" onClick={() => downloadJson(confirm.preview.currentJson, 'novoledger-before-history.json')}>导出当前 JSON</Button>
          <Button variant="ghost" onClick={() => downloadJson(confirm.preview.targetJson, `novoledger-revision-${confirm.preview.revision}.json`)}>导出历史 JSON</Button>
        </div>
        <div className="form-actions">
          <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>取消</Button>
          <Button variant="danger" disabled={busy} onClick={act}>备份当前账本并恢复草稿</Button>
        </div>
      </> : <>
        <p>{confirm?.kind === 'revoke' ? `将吊销「${confirm.device.label}」的云端访问；此操作不能撤销。`
          : '此操作会先保留备份，不自动上传、不合并账本。若本机账本变化，需要重新确认。'}</p>
        <Button variant="danger" disabled={busy} onClick={act}>确认执行</Button>
      </>}
    </Modal>
    <Modal open={!!legacy} title="旧备份预览" onClose={() => { if (!busy) setLegacy(null); }}>
      {legacy && <><p>{ledgerSummary(legacy.json)}。可先导出 JSON 核对，不会自动替换。</p>
        <Button variant="ghost" onClick={() => downloadJson(legacy.json, 'novoledger-legacy-decoded.json')}>导出解密 JSON</Button>
        <Button variant="danger" disabled={busy} onClick={() => run(async () => {
          if (!await importJson(legacy.json, legacy.generation)) throw new Error('恢复失败或本机账本已变化');
          setLegacy(null);
          setMessage('旧备份已恢复至本机，未上传');
        })}>备份本机并恢复旧账本</Button></>}
    </Modal>
  </>;
}
