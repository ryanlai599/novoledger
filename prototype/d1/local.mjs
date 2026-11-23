import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

export async function startLocalD1({ enrolled = false, allowWrites = true } = {}) {
  const entry = fileURLToPath(new URL(enrolled ? '../../functions/api/sync-v2.js' : './functions/api/sync-v2.js', import.meta.url));
  const worker = await build({
    stdin: {
      contents: `import { onRequest } from ${JSON.stringify(entry.replaceAll('\\', '/'))};
        export default { fetch(request, env) {
          if (new URL(request.url).pathname !== '/api/sync-v2') return new Response(null, { status: 404 });
          return onRequest({ request, env });
        } };`,
      resolveDir: process.cwd(),
      sourcefile: 'isolation-worker.js'
    },
    write: false, bundle: true, format: 'esm'
  });
  const miniflare = new Miniflare({
    modules: true, script: worker.outputFiles[0].text, host: '127.0.0.1', port: 0,
    compatibilityDate: '2025-01-01',
    bindings: enrolled ? { NOVO_D1_MODE: 'enrolled-preview', NOVO_D1_WRITES: allowWrites ? 'allow-preview' : 'off' }
      : { NOVO_D1_ISOLATED: 'local-only' },
    d1Databases: { SYNC_DB: 'novoledger-isolated-fixture' },
    d1Persist: false
  });
  try {
    const db = await miniflare.getD1Database('SYNC_DB');
    for (const file of ['0001_snapshots.sql', '0002_enrollment_and_receipt_window.sql']) {
      const schema = await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8');
      await db.batch(schema.split(/^-- statement\s*$/m).map(sql => db.prepare(sql.trim())));
    }
    return {
      db,
      dispatch: (path, init) => miniflare.dispatchFetch(new URL(path, 'http://127.0.0.1'), init),
      close: () => miniflare.dispose()
    };
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
}
