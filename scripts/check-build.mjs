import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const redirect = JSON.parse(await readFile(resolve(root, '.wrangler/deploy/config.json'), 'utf8'));
const configPath = resolve(root, '.wrangler/deploy', redirect.configPath);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const source = await readFile(resolve(dirname(configPath), config.main), 'utf8');
if (
  source.includes('DEV_ACCESS_BYPASS') ||
  source.includes('local@development') ||
  source.includes('__LOCAL_DEV__')
) {
  throw new Error('Production Worker must not contain the local authentication bypass');
}
if (
  !config.d1_databases?.some((db) => db.binding === 'DB') ||
  !config.triggers?.crons?.includes('*/5 * * * *')
) {
  throw new Error('Production Worker is missing D1 or the scheduled trigger');
}
console.log('Production Worker verified: D1, Cron, and no development authentication bypass.');
