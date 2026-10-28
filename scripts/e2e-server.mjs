import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseConfiguration } from './prepare-deploy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const configDir = resolve(root, '.wrangler/e2e');
const configPath = resolve(configDir, 'wrangler.json');
const persistPath = resolve(root, '.wrangler/e2e-state');
await mkdir(configDir, { recursive: true });
await rm(persistPath, { recursive: true, force: true });
const base = parseConfiguration(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
await writeFile(
  configPath,
  JSON.stringify({
    ...base,
    name: 'uptimeworker-e2e',
    main: resolve(root, 'src/worker/index.ts'),
    vars: { ...base.vars, DEV_ACCESS_BYPASS: 'true' },
    d1_databases: [
      {
        binding: 'DB',
        database_name: 'uptimeworker-e2e-db',
        database_id: '11111111-1111-1111-1111-111111111111',
        migrations_dir: resolve(root, 'migrations'),
      },
    ],
  }),
);
const env = {
  ...process.env,
  UPTIME_WRANGLER_CONFIG: configPath,
  UPTIME_PERSIST_PATH: persistPath,
  WRANGLER_LOG_PATH: resolve(root, '.wrangler/e2e.log'),
  WRANGLER_SEND_METRICS: 'false',
};
const migration = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
    'd1',
    'migrations',
    'apply',
    'DB',
    '--local',
    '--config',
    configPath,
    '--persist-to',
    persistPath,
  ],
  { cwd: root, env, stdio: 'inherit' },
);
const exit = await new Promise((resolveExit) => migration.on('exit', resolveExit));
if (exit !== 0) process.exit(1);
const server = spawn(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4173'],
  { cwd: root, env, stdio: 'inherit' },
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.kill(signal);
  });
server.on('exit', (code) => {
  process.exitCode = code || 0;
});
