import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import type { MonitorConfig, ProbeResult } from '../src/shared/types';
import type { Env, ProbeOptions } from '../src/worker/types';

export const timestamp = Date.UTC(2026, 9, 28, 2, 0);
export const httpConfig: Extract<MonitorConfig, { type: 'http' }> = {
  name: '官方网站',
  type: 'http',
  url: 'https://example.com/health',
  method: 'GET',
  wafBypassEnabled: false,
  requestHeaders: {},
  requestBody: null,
  responseCheck: null,
  expectedStatusMin: 200,
  expectedStatusMax: 299,
  intervalMinutes: 5,
  timeoutSeconds: 10,
  enabled: true,
};
export const tcpConfig: Extract<MonitorConfig, { type: 'tcp' }> = {
  name: '数据库',
  type: 'tcp',
  hostname: 'db.example.com',
  port: 5432,
  intervalMinutes: 5,
  timeoutSeconds: 10,
  enabled: true,
};
export const bypassOptions: ProbeOptions = {
  wafBypass: { enabled: true, token: 'test-bypass-token-'.repeat(4) },
};
export const success = (checkedAt = timestamp): ProbeResult => ({
  checkedAt,
  ok: true,
  latencyMs: 42,
  httpStatus: 200,
  errorCode: null,
});
export async function databaseFixture() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: [
        {
          name: 'test-worker',
          modules: true,
          script: 'export default { fetch() { return new Response("ok") } }',
          compatibilityDate: '2026-10-26',
          d1Databases: ['DB'],
        },
      ],
    }),
  );
  const db = (await mf.getD1Database('DB')) as unknown as D1Database;
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(file, migrations), 'utf8');
    await db.batch(unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)));
  }
  return { db, dispose: () => mf.dispose() };
}
export function environment(db: D1Database): Env {
  return {
    DB: db,
    ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com',
    ACCESS_AUD: 'test-audience',
    SITE_NAME: 'Test Status',
    ASSETS: {
      fetch: async () => new Response('<html>admin</html>', { headers: { 'Content-Type': 'text/html' } }),
    } as unknown as Fetcher,
  };
}
export async function resetDatabase(db: D1Database) {
  await db.batch([
    db.prepare('DELETE FROM monitors'),
    db.prepare('UPDATE scheduler_state SET lease_owner = NULL, lease_until = 0, last_completed_slot = 0'),
    db.prepare(`INSERT INTO global_settings(id) VALUES (1) ON CONFLICT(id) DO UPDATE SET
      waf_bypass_enabled = 0, waf_bypass_token = NULL, waf_bypass_domains_json = '[]', version = 1`),
  ]);
}
