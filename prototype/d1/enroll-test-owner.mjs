import { newAccessToken } from '../../src/lib/d1Crypto.js';

export async function enrollOwner(query, registration) {
  const hash = /^novo-owner-v1:([0-9a-f]{64})$/.exec(registration ?? '')?.[1];
  if (!hash) throw new Error('测试登记需要有效的登记校验值');
  const inserted = await query(`INSERT INTO sync_devices(id, account, token_hash, label, role)
    VALUES (?, ?, ?, 'Local test owner', 'owner') ON CONFLICT(token_hash) DO NOTHING`,
  [crypto.randomUUID(), newAccessToken(), hash]);
  if (inserted.meta.changes === 1) return 'created';
  const found = await query('SELECT role, revoked_at FROM sync_devices WHERE token_hash = ?', [hash]);
  if (found.results?.[0]?.role === 'owner' && found.results[0].revoked_at === null) return 'already_registered';
  throw new Error('测试登记失败；未修改已登记设备');
}
