import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';
import { build } from 'vite';

const [mode, databaseId, ...extra] = process.argv.slice(2);
const release = mode === 'release';
if (extra.length || !(release
  ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(databaseId ?? '')
  : mode === 'maintenance' && databaseId === undefined)) {
  throw new Error('用法：package:pages -- release <已核验的 D1 UUID>，或 package:pages -- maintenance');
}
const project = 'novoledger-prod';
const origin = `https://${project}.pages.dev`;
const root = fileURLToPath(new URL('../', import.meta.url));
const preferred = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Temp', 'opencode');
const stage = await mkdtemp(join(preferred && existsSync(preferred) ? preferred : tmpdir(), `novoledger-prod-${mode}-`));
const dist = join(stage, 'dist');
await build({
  root, mode: 'production', envFile: false,
  define: { 'import.meta.env.VITE_ENABLE_D1_SYNC': JSON.stringify(release ? '1' : '0') },
  build: { outDir: dist, emptyOutDir: false }
});

const files = await readdir(dist, { recursive: true });
if (!files.some(file => /^assets[\\/]index-.+\.js$/.test(file))) throw new Error('缺少应用脚本');
if (files.some(file => /^_(?:worker\.js|routes\.json|redirects|headers)(?:$|[\\/])/.test(file))) {
  throw new Error('构建包含未经审核的路由配置');
}
for (const file of files.filter(file => /\.(?:js|html|json|webmanifest|map)$/i.test(file))) {
  if (/(?:sample-(?:cat|event|pocket|source|transfer)-|Local test owner)/.test(await readFile(join(dist, file), 'utf8'))) {
    throw new Error('构建包含测试夹具');
  }
}

await bundle({
  stdin: { contents: `
    ${release ? "import { onRequest as sync } from './functions/api/sync-v2.js';" : ''}
    export default {
      fetch(request, env) {
        const { origin, pathname } = new URL(request.url);
        if (pathname !== '/api' && !pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
        ${release ? `if (origin === ${JSON.stringify(origin)} && pathname === '/api/sync-v2') return sync({ request, env });` : ''}
        return new Response(null, { status: 410, headers: { 'Cache-Control': 'no-store' } });
      }
    };
  `, resolveDir: root, sourcefile: 'production-pages-worker.js' },
  outfile: join(dist, '_worker.js'), bundle: true, format: 'esm', platform: 'neutral'
});
await writeFile(join(dist, '_routes.json'), JSON.stringify({
  version: 1, include: ['/api', '/api/*'], exclude: []
}), { flag: 'wx' });
await writeFile(join(stage, 'wrangler.toml.example'), `name = "${project}"
pages_build_output_dir = "dist"
compatibility_date = "2026-08-07"

[env.preview]
vars = {}
kv_namespaces = []
d1_databases = []

[env.production]
kv_namespaces = []
${release ? `
[env.production.vars]
NOVO_D1_MODE = "enrolled-preview"
NOVO_D1_WRITES = "allow-preview"

[[env.production.d1_databases]]
binding = "SYNC_DB"
database_name = "novoledger-production"
database_id = "${databaseId}"
` : `vars = {}
d1_databases = []
`}`, { flag: 'wx' });
await writeFile(join(stage, 'target.json'), JSON.stringify({
  project, host: new URL(origin).hostname, branch: 'main', mode, databaseId: release ? databaseId : null
}, null, 2) + '\n', { flag: 'wx' });
console.log(`仅生成本地 ${mode} 产物，未部署：${stage}`);
