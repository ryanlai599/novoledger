import { accountFor, digest, isOperationId, isRevision, isToken, MAX_ENVELOPE_BYTES, validateEnvelope } from '../../../../src/lib/d1Crypto.js';
import { authorize, manageDevices } from './enrollment.js';

const MAX_REQUEST_BYTES = MAX_ENVELOPE_BYTES + 2048;
const response = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
});

const HEAD = 'SELECT revision, operation_id AS operationId, envelope, created_at AS createdAt FROM sync_snapshots WHERE account = ? ORDER BY revision DESC LIMIT 1';
const HEAD_METADATA = 'SELECT revision, operation_id AS operationId FROM sync_snapshots WHERE account = ? ORDER BY revision DESC LIMIT 1';

async function readPost(request, maximum = MAX_REQUEST_BYTES) {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json' || !request.body) return null;
  if (Number(request.headers.get('Content-Length')) > maximum) return null;
  const body = request.body.getReader();
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await body.read();
      if (done) return JSON.parse(text + utf8.decode());
      size += value.byteLength;
      if (size > maximum) {
        await body.cancel();
        return null;
      }
      text += utf8.decode(value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    body.releaseLock();
  }
}

export async function onRequest({ request, env }) {
  const enrolled = env.NOVO_D1_MODE === 'enrolled-preview';
  const fixture = env.NOVO_D1_ISOLATED === 'local-only';
  if ((!enrolled && !fixture) || !env.SYNC_DB) return response({ error: 'not_enabled' }, 404);
  const auth = request.headers.get('Authorization');
  const token = auth?.startsWith('Bearer ') && auth.slice(7);
  if (!isToken(token)) return response({ error: 'unauthorized' }, 401);
  try {
    const db = env.SYNC_DB;
    const identity = enrolled ? await authorize(db, token) : {};
    if (identity.status) return response({ error: identity.status === 429 ? 'rate_limited' : 'unauthorized' }, identity.status);
    const device = identity.device;
    const account = enrolled ? device.account : await accountFor(token);
    const query = new URL(request.url).searchParams;
    if (query.size === 1 && query.get('session') === '1' && request.method === 'GET' && device) {
      return response({ account, role: device.role });
    }
    if (query.size === 1 && query.get('devices') === '1' && device) {
      return await manageDevices(db, device, request.method, request.method === 'POST' ? await readPost(request, 2048) : null, response);
    }
    if (request.method === 'GET') {
      const session = db.withSession('first-primary');
      if (query.size === 0) return response(await session.prepare(HEAD).bind(account).first() ?? { revision: 0 });
      if (query.size === 1 && query.get('history') === '1') {
        const result = await session.prepare(
          'SELECT revision, operation_id AS operationId, created_at AS createdAt FROM sync_snapshots WHERE account = ? ORDER BY revision DESC LIMIT 50'
        ).bind(account).all();
        return response({ versions: result.results });
      }
      const raw = query.get('revision');
      const revision = Number(raw);
      if (query.size !== 1 || !isRevision(revision) || revision === 0 || raw !== String(revision)) {
        return response({ error: 'invalid_query' }, 400);
      }
      const snapshot = await session.prepare(
        'SELECT revision, operation_id AS operationId, envelope, created_at AS createdAt FROM sync_snapshots WHERE account = ? AND revision = ?'
      ).bind(account, revision).first();
      return snapshot ? response(snapshot) : response({ error: 'snapshot_not_found' }, 404);
    }
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
    if (query.size !== 0) return response({ error: 'invalid_query' }, 400);
    if (enrolled && env.NOVO_D1_WRITES !== 'allow-preview') return response({ error: 'writes_paused' }, 503);
    const body = await readPost(request);
    if (!body || Object.keys(body).length !== 4 || !isRevision(body.base) || body.base >= Number.MAX_SAFE_INTEGER
      || (body.base === 0 ? body.baseOperationId !== null : !isOperationId(body.baseOperationId))
      || !isOperationId(body.operationId) || (enrolled && !body.operationId.startsWith(`${body.base + 1}:`))
      || typeof body.envelope !== 'string') {
      return response({ error: 'invalid_request' }, 400);
    }
    try {
      validateEnvelope(body.envelope);
    } catch {
      return response({ error: 'invalid_envelope' }, 400);
    }
    const hash = await digest(JSON.stringify([body.base, body.baseOperationId, body.operationId, body.envelope]));
    const [write, receipt, head, stillAuthorized] = await db.batch([
      db.prepare(`
        INSERT INTO sync_snapshots(account, revision, operation_id, request_hash, envelope)
        SELECT ?1, ?2 + 1, ?3, ?4, ?5
        WHERE ?2 = COALESCE(
          (SELECT revision FROM sync_snapshots WHERE account = ?1 ORDER BY revision DESC LIMIT 1), 0
        ) AND COALESCE(
          (SELECT operation_id FROM sync_snapshots WHERE account = ?1 ORDER BY revision DESC LIMIT 1), ''
        ) = COALESCE(?6, '') AND (?7 IS NULL OR EXISTS (
          SELECT 1 FROM sync_devices WHERE id = ?7 AND account = ?1 AND revoked_at IS NULL
        )) AND NOT EXISTS (
          SELECT 1 FROM sync_receipts WHERE account = ?1 AND operation_id = ?3
        )
      `).bind(account, body.base, body.operationId, hash, body.envelope, body.baseOperationId, device?.id ?? null),
      db.prepare('SELECT revision, request_hash AS hash FROM sync_receipts WHERE account = ? AND operation_id = ?')
        .bind(account, body.operationId),
      db.prepare(HEAD_METADATA).bind(account),
      db.prepare('SELECT 1 AS allowed WHERE ?1 IS NULL OR EXISTS (SELECT 1 FROM sync_devices WHERE id = ?1 AND revoked_at IS NULL)')
        .bind(device?.id ?? null)
    ]);
    if (!stillAuthorized.results[0]) return response({ error: 'unauthorized' }, 401);
    const committed = receipt.results[0];
    const current = head.results[0] ?? { revision: 0 };
    if (committed?.hash === hash) return response({
      operationId: body.operationId, revision: committed.revision, head: current.revision, replay: write.meta.changes === 0
    });
    return response({
      error: committed ? 'operation_reused' : body.base < current.revision - 256 ? 'request_expired' : 'revision_conflict',
      ...current
    }, 409);
  } catch {
    return response({ error: 'temporarily_unavailable' }, 503);
  }
}
