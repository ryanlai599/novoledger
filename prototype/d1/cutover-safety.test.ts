import { expect, it } from 'vitest';
import { onRequest as retiredState } from '../../functions/api/state.js';
import { onRequest as syncV2 } from '../../functions/api/sync-v2.js';

it('停写参考接口拒绝旧客户端的所有方法，不依赖旧 KV', async () => {
  for (const method of ['GET', 'PUT', 'POST', 'HEAD', 'OPTIONS']) {
    const response = await retiredState({
      request: new Request('https://ledger.invalid/api/state', { method }),
      get env() { throw new Error('停写路由不应访问任何绑定'); }
    });
    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
});

it('未启用 D1 模式时，即使写入开关开着，也不会触达账本与设备入口', async () => {
  const env = {
    NOVO_D1_WRITES: 'allow-preview',
    SYNC_DB: { prepare() { throw new Error('全停不得触达数据库'); } }
  };
  for (const path of ['', '?devices=1']) {
    const response = await syncV2({ request: new Request(`https://ledger.invalid/api/sync-v2${path}`, {
      method: 'POST', headers: { Authorization: `Bearer ${'0'.repeat(64)}` }
    }), env });
    expect(response.status).toBe(404);
  }
});
