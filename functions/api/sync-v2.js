import { onRequest as syncRequest } from '../../prototype/d1/functions/api/sync-v2.js';

// The synthetic fixture bypass is intentionally unreachable from the application endpoint.
export const onRequest = ({ request, env }) => syncRequest({
  request, env: { SYNC_DB: env.SYNC_DB, NOVO_D1_MODE: env.NOVO_D1_MODE, NOVO_D1_WRITES: env.NOVO_D1_WRITES }
});
