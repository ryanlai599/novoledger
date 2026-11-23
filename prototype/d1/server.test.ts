import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalD1 } from './local.mjs';
import { accountFor, open, seal, newAccessToken } from '../../src/lib/d1Crypto.js';
import { fixtureLedger } from './fixture.js';

let runtime: Awaited<ReturnType<typeof startLocalD1>>;
beforeAll(async () => { runtime = await startLocalD1(); }, 20000);
afterAll(async () => { await runtime?.close(); });

const secret = 'fixture-encryption-secret-independent-from-token';
async function fixture() {
  const token = newAccessToken();
  const account = await accountFor(token);
  return {
    token, account,
    async operation(base: number, amount: number, baseOperationId: string | null = null) {
      const operationId = crypto.randomUUID();
      const envelope = await seal(JSON.stringify({ ...fixtureLedger(), summaryBalance: amount }), secret,
        { account, revision: base + 1, operationId });
      return { base, baseOperationId, operationId, envelope };
    }
  };
}

function request(token: string, body?: unknown, query = '') {
  return runtime.dispatch(`/api/sync-v2${query}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

describe('D1 原子协议（Miniflare/workerd）', () => {
  it('并发初始化恰好一个成功；已初始化后并发提交同一基准也只有一个成功', async () => {
    const f = await fixture();
    let parent: string | null = null;
    for (const base of [0, 1]) {
      const operations = await Promise.all([f.operation(base, 101, parent), f.operation(base, 202, parent)]);
      const results = await Promise.all(operations.map(op => request(f.token, op)));
      expect(results.map(res => res.status).sort()).toEqual([200, 409]);
      const winner = operations[results.findIndex(res => res.status === 200)];
      expect(await (await request(f.token)).json()).toMatchObject({ revision: base + 1, operationId: winner.operationId });
      parent = winner.operationId;
    }
  });

  it('成功后丢弃响应，后续重试返回原收据，不新增版本，变更同 ID 的请求被拒', async () => {
    const f = await fixture();
    const first = await f.operation(0, 41);
    expect((await request(f.token, first)).status).toBe(200);
    expect((await request(f.token, await f.operation(1, 42, first.operationId))).status).toBe(200);
    expect(await (await request(f.token, first)).json()).toMatchObject({ revision: 1, head: 2, replay: true });
    const changed = { ...await f.operation(0, 43), operationId: first.operationId };
    expect(await (await request(f.token, changed)).json()).toMatchObject({ error: 'operation_reused' });
    expect((await request(f.token, await f.operation(1, 100, first.operationId))).status).toBe(409);
    expect(await (await request(f.token, undefined, '?revision=1')).json()).toMatchObject({ envelope: first.envelope });
  });

  it('同版本不同基准 ID 不可提交；令牌不通过 URL；不同令牌相互隔离', async () => {
    const f = await fixture();
    expect((await request(f.token, await f.operation(0, 5))).status).toBe(200);
    expect((await request(f.token, await f.operation(1, 7, crypto.randomUUID()))).status).toBe(409);
    expect((await request('', undefined, '?token=not-a-credential')).status).toBe(401);
    expect(await (await request(newAccessToken())).json()).toEqual({ revision: 0 });
    expect((await request(f.token, { ...await f.operation(0, 5), envelope: '{}' })).status).toBe(400);
  });

  it('保留最近 20 版与近期每日末版，淘汰后仍能重放旧收据', async () => {
    const f = await fixture();
    const first = await f.operation(0, 1);
    expect((await request(f.token, first)).status).toBe(200);
    const day = new Date(Date.now() - 26 * 3600000).toISOString().slice(0, 10);
    await runtime.db.prepare('UPDATE sync_snapshots SET day = ? WHERE account = ?').bind(day, f.account).run();
    let parent = first.operationId;
    let second;
    // 重用结构有效的合成信封，保留测试不在循环中重复 KDF。
    for (let base = 1; base <= 21; base++) {
      const op = { base, baseOperationId: parent, envelope: first.envelope, operationId: crypto.randomUUID() };
      expect((await request(f.token, op)).status).toBe(200);
      if (base === 1) {
        second = op;
        await runtime.db.prepare('UPDATE sync_snapshots SET day = ? WHERE account = ? AND revision = 2').bind(day, f.account).run();
      }
      parent = op.operationId;
    }
    const { versions } = await (await request(f.token, undefined, '?history=1')).json();
    expect(versions.map((item: { revision: number }) => item.revision)).toEqual([
      ...Array.from({ length: 20 }, (_, index) => 22 - index), 2
    ]);
    expect((await request(f.token, undefined, '?revision=1')).status).toBe(404);
    expect(await (await request(f.token, first)).json()).toMatchObject({ revision: 1, replay: true });
    expect(await (await request(f.token, second)).json()).toMatchObject({ revision: 2, replay: true });
  });

  it('接近容量上限的快照可落库；密文不能换绑版本、操作或账本', async () => {
    const f = await fixture();
    const operationId = crypto.randomUUID();
    const metadata = { account: f.account, revision: 1, operationId };
    const json = JSON.stringify({ ...fixtureLedger(), history: [
      { id: 'synthetic', at: '2020-01-01', type: 'other', title: 'x'.repeat(390000) }
    ] });
    const envelope = await seal(json, secret, metadata);
    expect((await request(f.token, { base: 0, baseOperationId: null, operationId, envelope })).status).toBe(200);
    const remote = await (await request(f.token)).json();
    expect(await open(remote.envelope, secret, metadata)).toBe(json);
    await expect(open(remote.envelope, secret, { ...metadata, revision: 2 })).rejects.toThrow();
    await expect(open(remote.envelope, secret, { ...metadata, operationId: crypto.randomUUID() })).rejects.toThrow();
    await expect(open(remote.envelope, secret, { ...metadata, account: await accountFor(newAccessToken()) })).rejects.toThrow();
    await expect(seal('x'.repeat(400000), secret, metadata)).rejects.toThrow(/容量/);
    expect(await (await request(f.token)).json()).toMatchObject({ revision: 1 });
  });
});
