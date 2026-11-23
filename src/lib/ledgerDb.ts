import { createEmptyLedger } from '../data/seed';
import { validateImport } from './accounting';
import { isOperationId } from './d1Crypto';
import type { LedgerState } from '../types';

export const legacyLedgerKey = 'finance-workbench-v1';
export const migrationFence = 'novoledger-idb-authority-v1';
export const databaseName = 'novoledger-ledger-v1';
const backupId = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');

export interface Snapshot { revision: number; operationId: string; envelope: string }
export interface Workspace {
  json: string;
  generation: number;
  serial: number;
  account: string | null;
  anchor: Snapshot | null;
  pending: {
    generation: number;
    json: string;
    operation: { base: number; baseOperationId: string | null; operationId: string; envelope: string };
  } | null;
  conflict: { snapshot: Snapshot; json: string } | null;
  dirty: boolean;
}
export interface LocalBackup { id: string; at: number; json: string; reason: string; raw?: true }
type Backup = (json: string, reason: string, raw?: true) => void;
type Transform = (state: Workspace, backup: Backup) => Workspace | undefined;
type MigrationStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function prepareMigration(storage: MigrationStorage, blank: LedgerState) {
  if (storage.getItem(migrationFence) !== null) {
    throw new Error('主账本缺失：请从独立 JSON 或已验证的云端备份明确恢复；不会重用旧本机账本');
  }
  const raw = storage.getItem(legacyLedgerKey);
  const json = JSON.stringify(raw === null ? blank : validateImport(JSON.parse(raw).state));
  storage.setItem(migrationFence, '1');
  return { json, raw };
}

const initial = (json: string): Workspace => ({
  json, generation: 0, serial: 0, account: null, anchor: null, pending: null, conflict: null, dirty: true
});
const valid = (data: unknown): Workspace => {
  const state = data as Workspace | null;
  const version = (value: number) => Number.isSafeInteger(value) && value >= 0;
  const snapshot = (value: Snapshot | null) => value === null || !!value && version(value.revision)
    && value.revision > 0 && isOperationId(value.operationId) && value.operationId.startsWith(`${value.revision}:`)
    && typeof value.envelope === 'string';
  if (!state || typeof state.json !== 'string' || !version(state.serial) || !version(state.generation)
      || state.generation > state.serial || typeof state.dirty !== 'boolean'
      || (state.account !== null && (typeof state.account !== 'string' || !/^[0-9a-f]{64}$/.test(state.account)))
      || !snapshot(state.anchor) || (state.account === null && (state.anchor || state.pending || state.conflict))
      || (state.pending !== null && (!state.pending?.operation || typeof state.pending.json !== 'string'
        || !version(state.pending.generation) || state.pending.generation > state.generation
        || !isOperationId(state.pending.operation.operationId)
        || !state.pending.operation.operationId.startsWith(`${(state.anchor?.revision ?? 0) + 1}:`)
        || typeof state.pending.operation.envelope !== 'string'
        || state.pending.operation.base !== (state.anchor?.revision ?? 0)
        || state.pending.operation.baseOperationId !== (state.anchor?.operationId ?? null)))
      || (state.conflict !== null && (!state.conflict?.snapshot || !snapshot(state.conflict.snapshot)
        || typeof state.conflict.json !== 'string'))) {
    throw new Error('主账本元数据无法校验，请导出原始数据并从备份恢复');
  }
  validateImport(JSON.parse(state.json));
  if (state.pending) validateImport(JSON.parse(state.pending.json));
  if (state.conflict) validateImport(JSON.parse(state.conflict.json));
  return state;
};

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('ledger');
      request.result.createObjectStore('backups', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('另一标签页正在使用旧版数据库，请关闭后重试'));
  });
}

export interface LedgerRepository {
  read: () => Promise<Workspace>;
  update: (fn: Transform) => Promise<Workspace | undefined>;
  backups: () => Promise<LocalBackup[]>;
  close: () => void;
}

let dbPromise: Promise<IDBDatabase> | undefined;
const getDb = () => dbPromise ??= openDb().catch(error => {
  dbPromise = undefined;
  throw error;
});
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('novoledger-ledger-changed-v1') : undefined;
const listeners = new Set<() => void>();
function notify() { for (const listener of listeners) listener(); }
if (channel) channel.onmessage = notify;
export function onLedgerChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

type RawTransform = (data: unknown, backup: Backup) => Workspace | undefined;
async function transaction(transform: RawTransform) {
  const db = await getDb();
  return new Promise<Workspace | undefined>((resolve, reject) => {
    const tx = db.transaction(['ledger', 'backups'], 'readwrite', { durability: 'strict' });
    const store = tx.objectStore('ledger');
    const request = store.get('main');
    let result: Workspace | undefined;
    let cause: unknown;
    tx.onabort = () => reject(cause ?? tx.error ?? new Error('本机账本事务未提交'));
    tx.oncomplete = () => {
      if (result) {
        notify();
        channel?.postMessage(null);
      }
      resolve(result);
    };
    request.onsuccess = () => {
      try {
        result = transform(request.result, (json, reason, raw) => {
          tx.objectStore('backups').add({ id: backupId(), at: Date.now(), json, reason, raw });
        });
        if (result) store.put(valid(result), 'main');
      } catch (error) {
        cause = error;
        tx.abort();
      }
    };
  });
}

async function rawWorkspace(): Promise<unknown> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('ledger').objectStore('ledger').get('main');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function initializeLedger() {
  await transaction((raw, backup) => {
    if (raw !== undefined) {
      valid(raw);
      // Restore the fence if only localStorage was cleared.
      if (localStorage.getItem(migrationFence) === null) localStorage.setItem(migrationFence, '1');
      return;
    }
    const candidate = prepareMigration(localStorage, createEmptyLedger());
    if (candidate.raw !== null) backup(candidate.raw, '迁移前完整旧账本封套', true);
    return initial(candidate.json);
  });
  return ledgerRepository.read();
}

export async function readOriginalWorkspace() {
  const raw = await rawWorkspace();
  return raw === undefined ? null : JSON.stringify(raw);
}

export async function recoverUnavailableLedger(json: string) {
  const replacement = initial(JSON.stringify(parseBackup(json)));
  await transaction((raw, backup) => {
    if (raw !== undefined) {
      let readable = false;
      try { valid(raw); readable = true; } catch { /* keep damaged bytes below */ }
      if (readable) throw new Error('主账本已可读取，请在数据备份页恢复');
      backup(JSON.stringify(raw), '恢复前损坏的 IndexedDB 原始数据', true);
    }
    const legacy = localStorage.getItem(legacyLedgerKey);
    if (legacy !== null) backup(legacy, '恢复前旧账本封套', true);
    localStorage.setItem(migrationFence, '1');
    return replacement;
  });
}

export function parseBackup(json: string) {
  const parsed = JSON.parse(json);
  return validateImport(parsed?.version === 0 && 'state' in parsed ? parsed.state : parsed);
}

export const ledgerRepository: LedgerRepository = {
  read: async () => valid(await rawWorkspace()),
  update: fn => transaction((raw, backup) => {
    const state = valid(raw);
    const next = fn(state, backup);
    return next && { ...next, serial: state.serial + 1 };
  }),
  backups: async () => {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction('backups').objectStore('backups').getAll();
      request.onsuccess = () => resolve((request.result as LocalBackup[]).sort((a, b) => b.at - a.at));
      request.onerror = () => reject(request.error);
    });
  },
  close: () => { /* application owns the shared connection */ }
};
