export function openRepository(account, fixture, { beforeBackup } = {}) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('novoledger-isolated-sync-v2', 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore('workspaces');
      opening.result.createObjectStore('backups', { keyPath: ['account', 'id'] });
    };
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      db.onversionchange = () => db.close();
      const initial = () => ({
        json: fixture, generation: 0, anchor: null, pending: null, conflict: null, dirty: false
      });
      resolve({
        close: () => db.close(),
        read: () => new Promise((done, fail) => {
          const request = db.transaction('workspaces').objectStore('workspaces').get(account);
          request.onsuccess = () => done(request.result ?? initial());
          request.onerror = () => fail(request.error);
        }),
        backups: () => new Promise((done, fail) => {
          const request = db.transaction('backups').objectStore('backups').getAll(
            IDBKeyRange.bound([account, ''], [account, '\uffff'])
          );
          request.onsuccess = () => done(request.result);
          request.onerror = () => fail(request.error);
        }),
        update: transform => new Promise((done, fail) => {
          const tx = db.transaction(['workspaces', 'backups'], 'readwrite', { durability: 'strict' });
          const store = tx.objectStore('workspaces');
          let result;
          let cause;
          tx.oncomplete = () => done(result);
          tx.onabort = () => fail(cause ?? tx.error ?? new Error('本地事务未提交'));
          const request = store.get(account);
          request.onsuccess = () => {
            try {
              const backup = (json, reason) => {
                beforeBackup?.();
                tx.objectStore('backups').add({ account, id: crypto.randomUUID(), at: Date.now(), json, reason });
              };
              result = transform(request.result ?? initial(), backup);
              if (result) store.put(result, account);
            } catch (error) {
              cause = error;
              tx.abort();
            }
          };
        })
      });
    };
  });
}
