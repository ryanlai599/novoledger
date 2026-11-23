import { isOperationId, isToken, newAccessToken, tokenDigest } from '../../../../src/lib/d1Crypto.js';

export async function authorize(db, token) {
  const device = await db.prepare(`
    SELECT id, account, role FROM sync_devices WHERE token_hash = ? AND revoked_at IS NULL
  `).bind(await tokenDigest(token)).first();
  if (!device) return { status: 401 };
  const rate = await db.prepare(`
    INSERT INTO sync_device_limits(device_id, minute, uses) VALUES(?1, unixepoch() / 60, 1)
    ON CONFLICT(device_id) DO UPDATE SET minute = excluded.minute,
      uses = CASE WHEN minute = excluded.minute THEN uses + 1 ELSE 1 END
    WHERE minute <> excluded.minute OR uses < 60
    RETURNING uses
  `).bind(device.id).first();
  return rate ? { device } : { status: 429 };
}

export async function manageDevices(db, device, method, body, respond) {
  if (device?.role !== 'owner') return respond({ error: 'owner_required' }, 403);
  if (method === 'GET') {
    const result = await db.prepare(`
      SELECT id, label, role, revoked_at AS revokedAt FROM sync_devices WHERE account = ? ORDER BY label, id
    `).bind(device.account).all();
    return respond({ devices: result.results });
  }
  if (method === 'POST' && body?.action === 'issue' && typeof body.label === 'string'
      && body.label.trim().length >= 1 && body.label.trim().length <= 40
      && !/[\u0000-\u001f\u007f]/.test(body.label) && isToken(body.token)) {
    const token = body.token;
    const id = crypto.randomUUID();
    const hash = await tokenDigest(token);
    const result = await db.prepare(`
      INSERT INTO sync_devices(id, account, token_hash, label, role)
      SELECT ?1, ?2, ?3, ?4, 'device'
      WHERE EXISTS (SELECT 1 FROM sync_devices WHERE id = ?5 AND account = ?2 AND role = 'owner' AND revoked_at IS NULL)
        AND (SELECT count(*) FROM sync_devices WHERE account = ?2 AND revoked_at IS NULL) < 16
      ON CONFLICT(token_hash) DO NOTHING
    `).bind(id, device.account, hash, body.label.trim(), device.id).run();
    if (result.meta.changes === 1) return respond({ id });
    const existing = await db.prepare(`
      SELECT id FROM sync_devices WHERE token_hash = ? AND account = ? AND role = 'device' AND revoked_at IS NULL
    `).bind(hash, device.account).first();
    return existing ? respond(existing) : respond({ error: 'device_limit_or_token_unavailable' }, 409);
  }
  if (method === 'POST' && body?.action === 'revoke' && isOperationId(body.id)) {
    const result = await db.prepare(`
      UPDATE sync_devices SET revoked_at = COALESCE(revoked_at, unixepoch())
        WHERE id = ?1 AND account = ?2 AND role = 'device'
          AND EXISTS (SELECT 1 FROM sync_devices WHERE id = ?3 AND account = ?2 AND role = 'owner' AND revoked_at IS NULL)
    `).bind(body.id, device.account, device.id).run();
    return result.meta.changes === 1 ? respond({ ok: true }) : respond({ error: 'device_not_found' }, 404);
  }
  return respond({ error: 'invalid_device_request' }, 400);
}

// Called only by synthetic test harnesses; remote enrollment is an operator task.
export async function provisionFixtureOwner(db) {
  const account = newAccessToken();
  const token = newAccessToken();
  await db.prepare(`
    INSERT INTO sync_devices(id, account, token_hash, label, role) VALUES (?, ?, ?, 'Synthetic owner', 'owner')
  `).bind(crypto.randomUUID(), account, await tokenDigest(token)).run();
  return { account, token };
}
