import { validateImport } from './accounting.ts';
import { decryptLedger, isValidSyncCode, legacyEnvelope } from './sync.ts';
import { isOperationId, isRevision, isToken, open, seal } from './d1Crypto.js';

const normalized = json => JSON.stringify(validateImport(JSON.parse(json)));
const revisionOf = state => state.anchor?.revision ?? 0;

export async function importLegacyCiphertext(file, oldSecret) {
  const envelope = legacyEnvelope(file);
  if (!envelope) throw new Error('这不是旧版加密副本。普通 JSON 请使用「导入恢复」，不需要口令。');
  const code = oldSecret.trim();
  if (!isValidSyncCode(code)) throw new Error('请输入旧版同步码（8–32 位字母、数字、下划线或短横线）。');
  let plain;
  try { plain = await decryptLedger(envelope, code); }
  catch { throw new Error('旧同步码不匹配或文件已损坏；本机账本未修改。'); }
  return normalized(plain);
}

export function isolatedTransport({ fetcher = fetch, timeoutMs = 10000 } = {}) {
  return async (token, { query = '', operation } = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher(`/api/sync-v2${query}`, {
        method: operation ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(operation && { 'Content-Type': 'application/json' }) },
        body: operation && JSON.stringify(operation),
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal
      });
      const body = await res.json();
      if (res.status === 409 && ['revision_conflict', 'request_expired'].includes(body?.error) && isRevision(body.revision)) {
        return { ...body, conflict: true };
      }
      if (res.status === 429) throw new Error('云端请求过多，请稍后重试；本机数据未改变');
      if (res.status === 401 || res.status === 403) throw new Error('设备令牌未获授权或已吊销');
      if (!res.ok) throw new Error(`云端请求未确认 (${res.status})，待同步副本未删除`);
      return body;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('云端响应超时，保留同一请求供重试');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createSyncClient({ token, account, secret, repository, transport = isolatedTransport() }) {
  if (!isToken(token) || !isToken(account)) throw new Error('配对信息无效');

  async function decode(snapshot) {
    if (!snapshot || !isRevision(snapshot.revision) || snapshot.revision === 0
        || !isOperationId(snapshot.operationId) || typeof snapshot.envelope !== 'string') {
      throw new Error('远端快照元数据无效');
    }
    let json;
    try {
      json = normalized(await open(snapshot.envelope, secret, {
        account, revision: snapshot.revision, operationId: snapshot.operationId
      }));
    } catch {
      throw new Error('云端快照无法解密或未通过账本校验；未替换本机数据');
    }
    const { revision, operationId, envelope } = snapshot;
    return { snapshot: { revision, operationId, envelope }, json };
  }

  function assertLineage(snapshot, state) {
    if (!isRevision(snapshot?.revision) || snapshot.revision < revisionOf(state)
        || (snapshot.revision === revisionOf(state) && state.anchor && snapshot.operationId !== state.anchor.operationId)) {
      throw new Error('拒绝过期或分叉的远端版本');
    }
  }

  const checkedUpdate = fn => repository.update((state, backup) => {
    if ('account' in state && state.account !== account) throw new Error('本机工作区与已解锁账本不匹配');
    return fn(state, backup);
  });

  async function stageHead(minimum, pendingId) {
    const remote = await transport(token);
    if (!isRevision(remote?.revision) || remote.revision < minimum) throw new Error('远端响应低于已观测版本');
    const decoded = remote.revision > 0 ? await decode(remote) : null;
    await checkedUpdate((state, backup) => {
      assertLineage(remote, state);
      if (pendingId && state.pending?.operation.operationId !== pendingId) return;
      const previous = state.conflict;
      if (previous && (remote.revision < previous.snapshot.revision
          || (remote.revision === previous.snapshot.revision && remote.operationId !== previous.snapshot.operationId))) {
        throw new Error('拒绝过期或分叉的云端冲突副本');
      }
      if (!decoded) return;
      if (state.pending?.operation.operationId === remote.operationId
          && state.pending.operation.base + 1 === remote.revision
          && state.pending.operation.envelope === remote.envelope) return;
      if (remote.revision === revisionOf(state) || remote.operationId === previous?.snapshot.operationId) return;
      if (previous) backup(previous.json, '上一次已核验云端冲突副本');
      return { ...state, conflict: decoded };
    });
    return remote.revision;
  }

  async function prepare() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await repository.read();
      if ('account' in before && before.account !== account) throw new Error('本机工作区与已解锁账本不匹配');
      if (before.anchor) await decode(before.anchor);
      if (before.pending) {
        const { operation, generation, json } = before.pending;
        const decoded = await decode({ revision: operation.base + 1, operationId: operation.operationId, envelope: operation.envelope });
        if (operation.base !== revisionOf(before) || operation.baseOperationId !== (before.anchor?.operationId ?? null)
            || !isRevision(generation) || generation > before.generation || decoded.json !== json) {
          throw new Error('待同步请求校验失败；请先保留本地账本');
        }
        return before.pending;
      }
      if (before.conflict) throw new Error('请先处理相冲突的两份账本');
      if (!before.dirty) return null;
      const base = revisionOf(before);
      const operationId = 'account' in before ? `${base + 1}:${crypto.randomUUID()}` : crypto.randomUUID();
      const envelope = await seal(before.json, secret, { account, revision: base + 1, operationId });
      const pending = {
        generation: before.generation, json: before.json,
        operation: { base, baseOperationId: before.anchor?.operationId ?? null, operationId, envelope }
      };
      const stored = await checkedUpdate(state => {
        if (state.conflict || state.pending || state.generation !== before.generation
            || state.anchor?.operationId !== before.anchor?.operationId || !state.dirty) return;
        return { ...state, pending };
      });
      if (stored) return pending;
    }
    throw new Error('账本正在快速变化，请重试；本地记录未丢失');
  }

  return {
    read: repository.read,
    backups: repository.backups,
    close: repository.close,
    edit: transform => checkedUpdate(state => ({
      ...state,
      generation: state.generation + 1,
      json: normalized(JSON.stringify(transform(JSON.parse(state.json)))),
      dirty: true
    })),
    reviewCloud: () => stageHead(0),
    async submit() {
      const pending = await prepare();
      if (!pending) return { kind: 'nothing' };
      const { operation } = pending;
      const reply = await transport(token, { operation });
      if (reply?.conflict) {
        if (reply.revision < operation.base || (reply.revision === operation.base && reply.operationId !== operation.baseOperationId)) {
          throw new Error('服务端基准缺失或分叉，保留待同步数据');
        }
        if (reply.revision <= operation.base) throw new Error('远端冲突响应无效');
        await stageHead(reply.revision, operation.operationId);
        return { kind: 'conflict', revision: reply.revision, expired: reply.error === 'request_expired' };
      }
      if (reply?.operationId !== operation.operationId || reply.revision !== operation.base + 1
          || !isRevision(reply.head) || reply.head < reply.revision || typeof reply.replay !== 'boolean') {
        throw new Error('云端收据无效，待同步副本未删除');
      }
      await checkedUpdate(state => {
        if (state.pending?.operation.operationId !== operation.operationId) return;
        return {
          ...state,
          anchor: { revision: reply.revision, operationId: operation.operationId, envelope: operation.envelope },
          pending: null,
          // Another tab may already have reviewed a later, authenticated cloud version.
          conflict: state.conflict?.snapshot.revision > reply.revision ? state.conflict : null,
          dirty: state.generation !== pending.generation
        };
      });
      return { kind: 'committed', revision: reply.revision, replay: reply.replay };
    },
    async resolveConflict(choice, expectedGeneration, expectedOperationId) {
      if (choice !== 'local' && choice !== 'cloud') throw new Error('恢复选择无效');
      const before = await repository.read();
      const conflict = before.conflict;
      if (!conflict) throw new Error('没有待解决冲突');
      const remote = await decode(conflict.snapshot);
      return checkedUpdate((state, backup) => {
        if (state.generation !== expectedGeneration || expectedOperationId !== remote.snapshot.operationId
            || state.conflict?.snapshot.operationId !== remote.snapshot.operationId) {
          throw new Error('选择期间账本已变化，请重新检查');
        }
        assertLineage(remote.snapshot, state);
        backup(state.json, '冲突：本地工作账本');
        backup(remote.json, '冲突：云端副本');
        if (state.pending && state.pending.json !== state.json) backup(state.pending.json, '冲突：上一次待发快照');
        return {
          ...state, json: choice === 'cloud' ? remote.json : state.json, anchor: remote.snapshot,
          generation: state.generation + 1, dirty: choice === 'local', pending: null, conflict: null
        };
      });
    },
    async history() {
      const result = await transport(token, { query: '?history=1' });
      if (!Array.isArray(result?.versions) || result.versions.length > 50 || result.versions.some((item, i, list) =>
        !isRevision(item?.revision) || item.revision === 0 || !isOperationId(item.operationId)
        || (i > 0 && item.revision >= list[i - 1].revision)
      )) throw new Error('历史版本索引无效');
      return result.versions;
    },
    async previewHistory(revision, expectedOperationId) {
      if (!isRevision(revision) || revision === 0 || !isOperationId(expectedOperationId)) throw new Error('历史版本无效');
      const before = await repository.read();
      if (('account' in before && before.account !== account) || before.pending || before.conflict) {
        throw new Error('请先处理待发或冲突，再预览历史版本');
      }
      const remote = await decode(await transport(token, { query: `?revision=${revision}` }));
      if (remote.snapshot.revision !== revision || remote.snapshot.operationId !== expectedOperationId) {
        throw new Error('返回的历史版本不匹配，未替换本机数据');
      }
      return {
        revision, currentJson: before.json, targetJson: remote.json,
        apply: () => checkedUpdate((state, backup) => {
          if (state.serial !== before.serial || state.generation !== before.generation ||
              state.anchor?.operationId !== before.anchor?.operationId || state.pending || state.conflict) {
            throw new Error('预览后本机账本或同步状态已变化，请关闭后重新预览；未恢复。');
          }
          backup(state.json, '恢复历史前');
          return { ...state, generation: state.generation + 1, json: remote.json, dirty: true };
        })
      };
    }
  };
}
