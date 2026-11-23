import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startLocalD1 } from './local.mjs';
import { provisionFixtureOwner } from './functions/api/enrollment.js';
import { newAccessToken, seal, tokenDigest } from '../../src/lib/d1Crypto.js';
import { fixtureLedger } from './fixture.js';
import { enrollOwner } from './enroll-test-owner.mjs';

let runtime: Awaited<ReturnType<typeof startLocalD1>>;
beforeAll(async () => { runtime = await startLocalD1({ enrolled: true }); }, 20000);
afterAll(async () => { await runtime?.close(); });

const send = (token: string, query = '', body?: unknown) => runtime.dispatch(`/api/sync-v2${query}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
});

describe('正式应用 D1 协议（本地）', () => {
  it('登记校验值不是 Bearer；操作员登记幂等，未登记时不存在公开领令牌入口', async () => {
    const token = newAccessToken();
    const fingerprint = await tokenDigest(token);
    const registration = `novo-owner-v1:${fingerprint}`;
    const query = (sql: string, params: string[]) => runtime.db.prepare(sql).bind(...params).all();
    expect((await send(token, '?devices=1', { action: 'issue', token: newAccessToken(), label: 'unregistered' })).status).toBe(401);
    await expect(enrollOwner(query, token)).rejects.toThrow(/校验值/);
    expect(await enrollOwner(query, registration)).toBe('created');
    expect(await enrollOwner(query, registration)).toBe('already_registered');
    expect((await send(fingerprint, '?session=1')).status).toBe(401);
    expect((await (await send(token, '?session=1')).json()).role).toBe('owner');
    expect(await (await send(token)).json()).toEqual({ revision: 0 });
  });

  it('需预先发放令牌；管理员可幂等配对与吊销，设备无权发放或访问另一账本', async () => {
    const owner = await provisionFixtureOwner(runtime.db);
    const stranger = await provisionFixtureOwner(runtime.db);
    const token = newAccessToken();
    expect((await send(token, '?session=1')).status).toBe(401);
    const issue = { action: 'issue', token, label: 'Synthetic mobile' };
    const created = await (await send(owner.token, '?devices=1', issue)).json();
    expect(created).toMatchObject({ id: expect.any(String) });
    expect(await (await send(owner.token, '?devices=1', issue)).json()).toEqual(created);
    expect(await (await send(token, '?session=1')).json()).toEqual({ account: owner.account, role: 'device' });
    expect((await send(token, '?devices=1', issue)).status).toBe(403);
    expect((await send(stranger.token, '?devices=1', { action: 'revoke', id: created.id })).status).toBe(404);
    expect((await send(owner.token, '?devices=1', { action: 'revoke', id: created.id })).status).toBe(200);
    expect((await send(token)).status).toBe(401);
    expect((await send(owner.token, '?devices=1', issue)).status).toBe(409);
    expect((await send(owner.token, '?session=1')).status).toBe(200);
  });

  it('令牌限流拒绝窗口内超额请求；未授权或超限请求不能改账本', async () => {
    const owner = await provisionFixtureOwner(runtime.db);
    const requests = await Promise.all(Array.from({ length: 80 }, () => send(owner.token, '?session=1')));
    expect(requests.some(response => response.status === 429)).toBe(true);
    expect(requests.every(response => [200, 429].includes(response.status))).toBe(true);
    expect(await runtime.db.prepare('SELECT count(*) AS count FROM sync_snapshots WHERE account = ?').bind(owner.account).first()).toMatchObject({ count: 0 });
  });

  it('以版本而非时间划分收据边界：最后可重放窗口内成功，过期既不认领也不写入', async () => {
    const owner = await provisionFixtureOwner(runtime.db);
    const operationId = `1:${crypto.randomUUID()}`;
    const envelope = await seal(JSON.stringify(fixtureLedger()), 'isolated-expiry-fixture-secret',
      { account: owner.account, revision: 1, operationId });
    const original = { base: 0, baseOperationId: null, operationId, envelope };
    expect((await send(owner.token, '', original)).status).toBe(200);
    const head = async (revision: number) => runtime.db.prepare(`
      INSERT INTO sync_snapshots (account, revision, operation_id, request_hash, envelope) VALUES(?, ?, ?, ?, ?)
    `).bind(owner.account, revision, `${revision}:${crypto.randomUUID()}`, '0'.repeat(64), envelope).run();
    await head(256);
    expect(await (await send(owner.token, '', original)).json()).toMatchObject({ revision: 1, head: 256, replay: true });
    await head(257);
    const expired = await send(owner.token, '', original);
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ revision: 257, error: 'request_expired' });
    const current = await (await send(owner.token)).json();
    expect((await send(owner.token, '', { ...original, base: 257, baseOperationId: current.operationId })).status).toBe(400);
    expect(await (await send(owner.token)).json()).toMatchObject({ revision: 257 });
    expect(await runtime.db.prepare(`
      SELECT count(*) AS count FROM sync_receipts WHERE account = ? AND operation_id = ?
    `).bind(owner.account, operationId).first()).toMatchObject({ count: 0 });
  });

  it('云写入开关关闭时拒绝提交，读取和本机恢复仍可用', async () => {
    const paused = await startLocalD1({ enrolled: true, allowWrites: false });
    try {
      const owner = await provisionFixtureOwner(paused.db);
      const headers = { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' };
      const response = await paused.dispatch('/api/sync-v2', { method: 'POST', headers, body: '{}' });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'writes_paused' });
      expect(await (await paused.dispatch('/api/sync-v2', { headers })).json()).toEqual({ revision: 0 });
    } finally {
      await paused.close();
    }
  }, 15000);
});
