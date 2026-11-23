import { validateImport } from './accounting';
import type { LedgerState } from '../types';

type LocalStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>;
export const ledgerStorageKey = 'finance-workbench-v1';
const prefix = 'novoledger-recovery-v1:';

export interface RecoveryCopy {
  id: string;
  at: string;
  label: string;
  json: string;
}

export function listRecoveryCopies(storage: LocalStorage): RecoveryCopy[] {
  const copies: RecoveryCopy[] = [];
  for (let index = 0; index < storage.length; index++) {
    const id = storage.key(index);
    if (!id?.startsWith(prefix)) continue;
    try {
      const item = JSON.parse(storage.getItem(id) ?? 'null') as RecoveryCopy | null;
      if (item?.id === id && typeof item.json === 'string' && typeof item.at === 'string') copies.push(item);
    } catch {
      // Leave unreadable copies untouched.
    }
  }
  const legacy = storage.getItem('finance-sync-local-backup');
  if (legacy) copies.push({ id: 'legacy', at: '', label: '旧版云同步备份', json: legacy });
  return copies.sort((a, b) => b.at.localeCompare(a.at));
}

export function createLedgerPersistence(storage: LocalStorage, tabId: string) {
  let baseline = storage.getItem(ledgerStorageKey);
  let unreadable = false;
  const journalId = `${prefix}tab:${tabId}`;
  let sequence = 0;

  const writeCopy = (id: string, json: string, label: string) =>
    storage.setItem(id, JSON.stringify({ id, at: new Date().toISOString(), label, json }));

  return {
    load: () => {
      try {
        return baseline === null ? undefined : validateImport(JSON.parse(baseline).state);
      } catch (error) {
        unreadable = true;
        throw error;
      }
    },
    backup: (state: LedgerState, label: string) =>
      writeCopy(`${prefix}backup:${tabId}:${++sequence}`, JSON.stringify(state), label),
    save: (state: LedgerState, requireCurrent = false): 'saved' | 'branch' => {
      const json = JSON.stringify(state);
      const serialized = JSON.stringify({ state, version: 0 });
      const current = storage.getItem(ledgerStorageKey);
      if (current !== baseline && requireCurrent) throw new Error('另一标签页已更新主账本，请重新打开并检查恢复副本');
      if (unreadable && baseline !== null) {
        writeCopy(`${prefix}backup:${tabId}:${++sequence}`, baseline, '无法读取的原始本地数据');
        unreadable = false;
      }
      writeCopy(journalId, json, current === baseline ? '标签页工作副本' : '标签页冲突副本');
      if (storage.getItem(ledgerStorageKey) !== baseline) {
        if (requireCurrent) throw new Error('另一标签页已更新主账本');
        return 'branch';
      }
      try {
        storage.setItem(ledgerStorageKey, serialized);
      } catch (error) {
        if (requireCurrent) throw error;
        return 'branch';
      }
      baseline = serialized;
      return 'saved';
    }
  };
}
