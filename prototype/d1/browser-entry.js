import { addExpenseRecord } from '../../src/lib/accounting.ts';
import { createSyncClient, isolatedTransport, importLegacyCiphertext } from '../../src/lib/d1Client.js';
import { accountFor, newAccessToken } from '../../src/lib/d1Crypto.js';
import { openRepository } from './repository.js';
import { fixtureLedger } from './fixture.js';

// The isolated browser runner loads this via a loopback-only fixture page.
let client;
let mode = 'normal';
let backupFailure = 0;
const transport = isolatedTransport({
  timeoutMs: 2000,
  fetcher: async (path, options) => {
    const response = await fetch(path, options);
    if (mode === 'lose-ack' && options.method === 'POST') {
      await response.json();
      if (options.signal.aborted) throw new DOMException('aborted', 'AbortError');
      await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    }
    if (mode === 'tamper' && options.method === 'GET' && response.ok) {
      const snapshot = await response.json();
      if (snapshot.envelope) {
        const item = JSON.parse(snapshot.envelope);
        item.data = (item.data[0] === 'A' ? 'B' : 'A') + item.data.slice(1);
        snapshot.envelope = JSON.stringify(item);
      }
      return Response.json(snapshot);
    }
    return response;
  }
});

window.fixture = {
  newAccessToken,
  async connect(token, secret) {
    client?.close();
    const account = await accountFor(token);
    const repository = await openRepository(account, JSON.stringify(fixtureLedger()),
      { beforeBackup() { if (backupFailure && --backupFailure === 0) throw new Error('合成备份写入失败'); } });
    client = createSyncClient({ token, account, secret, transport, repository });
  },
  edit: amount => client.edit(ledger => addExpenseRecord(ledger, '2020-01-01', amount, 'test-category')),
  async legacy(envelope, secret) {
    const ledger = JSON.parse(await importLegacyCiphertext(envelope, secret));
    await client.edit(() => ledger);
  },
  submit: () => client.submit(),
  review: () => client.reviewCloud(),
  history: () => client.history(),
  async resolve(choice, view) {
    await client.resolveConflict(choice, view.generation, view.remoteOperation);
  },
  async restore(revision) {
    const version = (await client.history()).find(item => item.revision === revision);
    await (await client.previewHistory(revision, version.operationId)).apply();
  },
  mode(value) { mode = value; },
  failBackup(value) { backupFailure = value ? 2 : 0; },
  async view() {
    const state = await client.read();
    const amounts = json => JSON.parse(json).expenseRecords.map(record => record.amount).sort((a, b) => a - b);
    return {
      local: amounts(state.json), generation: state.generation, anchor: state.anchor?.revision ?? 0,
      dirty: state.dirty, pending: state.pending?.operation.operationId ?? null,
      remoteOperation: state.conflict?.snapshot.operationId,
      remote: state.conflict ? amounts(state.conflict.json) : null,
      backups: (await client.backups()).map(copy => amounts(copy.json))
    };
  }
};
