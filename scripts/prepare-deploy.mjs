import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, printParseErrorCode } from 'jsonc-parser';

export function parseConfiguration(source) {
  const errors = [];
  const config = parse(source, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`Invalid Wrangler JSONC: ${printParseErrorCode(errors[0].error)}`);
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('Wrangler config must be an object');
  return config;
}

export function deploymentSettings(env) {
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD']) {
    if (!env[key]?.trim()) throw new Error(`Missing required setting: ${key}`);
  }
  if (!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID))
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID');
  const team = env.ACCESS_TEAM_DOMAIN.trim()
    .replace(/^https:\/\//, '')
    .replace(/\/$/, '');
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team))
    throw new Error('ACCESS_TEAM_DOMAIN must be your team.cloudflareaccess.com hostname');
  if (!/^[a-f0-9]{64}$/i.test(env.ACCESS_AUD.trim()))
    throw new Error('ACCESS_AUD must be the 64-character Access application AUD tag');
  const workerName = env.WORKER_NAME?.trim() || 'uptimeworker';
  const databaseName = env.D1_DATABASE_NAME?.trim() || `${workerName}-db`;
  for (const [key, name] of [
    ['WORKER_NAME', workerName],
    ['D1_DATABASE_NAME', databaseName],
  ]) {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(name))
      throw new Error(
        `${key} must contain 1–63 lowercase letters, digits, or hyphens and start with a letter`,
      );
  }
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    token: env.CLOUDFLARE_API_TOKEN,
    team,
    audience: env.ACCESS_AUD.trim(),
    workerName,
    databaseName,
    siteName: env.SITE_NAME?.trim().slice(0, 80) || 'UptimeWorker',
  };
}

export async function ensureDatabase(settings, fetchImpl = fetch) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${settings.accountId}/d1/database`;
  async function request(url, options = {}) {
    const response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
      },
    });
    const body = await response.json();
    if (!response.ok || body.success !== true) {
      const error = new Error(
        `Cloudflare D1 API failed (HTTP ${response.status}; codes: ${(body.errors ?? []).map((e) => e.code).join(', ') || 'unknown'})`,
      );
      error.status = response.status;
      throw error;
    }
    return body;
  }
  async function find() {
    const found = [];
    for (let page = 1; ; page++) {
      const body = await request(
        `${base}?name=${encodeURIComponent(settings.databaseName)}&per_page=100&page=${page}`,
      );
      if (!Array.isArray(body.result)) throw new Error('Unexpected Cloudflare D1 list response');
      found.push(...body.result.filter((db) => db.name === settings.databaseName));
      if (body.result.length < 100 || page >= (body.result_info?.total_pages ?? Infinity)) break;
    }
    if (found.length > 1)
      throw new Error(
        'Multiple databases have the exact configured name; resolve this in Cloudflare before deploying',
      );
    return found[0];
  }
  let database = await find();
  let created = false;
  if (!database) {
    try {
      const body = await request(base, {
        method: 'POST',
        body: JSON.stringify({ name: settings.databaseName }),
      });
      database = body.result;
      created = true;
    } catch (error) {
      // Another deployment may have created this name between list and create.
      if (error.status !== 400 && error.status !== 409) throw error;
      database = await find();
      if (!database) throw error;
    }
  }
  if (!database || database.name !== settings.databaseName || !/^[a-f0-9-]{36}$/i.test(database.uuid ?? ''))
    throw new Error('Cloudflare returned an invalid database identity');
  return { id: database.uuid, created };
}

export function makeDeploymentConfig(base, settings, databaseId) {
  return {
    ...base,
    name: settings.workerName,
    workers_dev: true,
    preview_urls: false,
    vars: { ACCESS_TEAM_DOMAIN: settings.team, ACCESS_AUD: settings.audience, SITE_NAME: settings.siteName },
    d1_databases: [
      {
        binding: 'DB',
        database_name: settings.databaseName,
        database_id: databaseId,
        migrations_dir: 'migrations',
      },
    ],
  };
}

export async function main() {
  const settings = deploymentSettings(process.env);
  const base = parseConfiguration(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const database = await ensureDatabase(settings);
  await writeFile(
    new URL('../wrangler.deploy.json', import.meta.url),
    `${JSON.stringify(makeDeploymentConfig(base, settings, database.id), null, 2)}\n`,
  );
  console.log(`${database.created ? 'Created' : 'Reusing'} D1 database: ${settings.databaseName}`);
  console.log(`Deployment configuration ready for Worker: ${settings.workerName}`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
