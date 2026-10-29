import { describe, expect, it, vi } from 'vitest';
import {
  deploymentSettings,
  ensureDatabase,
  main,
  makeDeploymentConfig,
  parseConfiguration,
} from '../../scripts/prepare-deploy.mjs';

const env = {
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_API_TOKEN: 'secret-token',
  ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com/',
  ACCESS_AUD: 'b'.repeat(64),
};
const uuid = '11111111-2222-3333-4444-555555555555';
const database = { name: 'uptimeworker-db', uuid };
const ok = (result, result_info) =>
  new Response(JSON.stringify({ success: true, result, result_info }), { status: 200 });
describe('deployment bootstrap', () => {
  it('reads JSONC comments and trailing commas and rejects broken configuration', () => {
    expect(parseConfiguration('// Worker config\n{"name":"uptimeworker",}')).toEqual({
      name: 'uptimeworker',
    });
    expect(() => parseConfiguration('{"name":')).toThrow('Invalid Wrangler JSONC');
  });
  it('validates configuration before any Cloudflare call and contains no password requirement', () => {
    expect(deploymentSettings(env)).toMatchObject({
      workerName: 'uptimeworker',
      databaseName: 'uptimeworker-db',
      team: 'team.cloudflareaccess.com',
    });
    for (const key of Object.keys(env)) expect(() => deploymentSettings({ ...env, [key]: '' })).toThrow(key);
    expect(() => deploymentSettings({ ...env, WORKER_NAME: '../unsafe' })).toThrow();
    expect(() =>
      deploymentSettings({ ...env, ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com.evil.test' }),
    ).toThrow();
  });
  it.each([
    [undefined, true],
    ['', true],
    [' \t\n', true],
    ['true', true],
    ['false', false],
    [' TRUE ', true],
    [' FaLsE\n', false],
  ])('parses WORKERS_DEV=%j as %s', (value, expected) => {
    expect(deploymentSettings({ ...env, WORKERS_DEV: value }).workersDev).toBe(expected);
  });
  it.each(['yes', 'no', '1', '0', 'false-ish'])('rejects invalid WORKERS_DEV=%j', (value) => {
    expect(() => deploymentSettings({ ...env, WORKERS_DEV: value })).toThrow(
      'WORKERS_DEV must be true or false',
    );
  });
  it('rejects an invalid workers.dev setting before contacting Cloudflare', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected API call'));
    try {
      for (const [key, value] of Object.entries({ ...env, WORKERS_DEV: 'invalid' })) vi.stubEnv(key, value);
      await expect(main()).rejects.toThrow('WORKERS_DEV must be true or false');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      fetchMock.mockRestore();
    }
  });
  it('creates a database on first deployment and uses its returned identifier', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok(database));
    expect(await ensureDatabase(deploymentSettings(env), fetchMock)).toEqual({ id: uuid, created: true });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ name: 'uptimeworker-db' }),
    });
  });
  it('reuses the exact matching database without a create or delete request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok([{ ...database, name: 'uptimeworker-db-backup' }, database]));
    expect(await ensureDatabase(deploymentSettings(env), fetchMock)).toEqual({ id: uuid, created: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('never treats authentication or API errors as a missing database', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, errors: [{ code: 10000 }] }), { status: 403 }),
      );
    await expect(ensureDatabase(deploymentSettings(env), fetchMock)).rejects.toThrow('403');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('recovers a concurrent create conflict by re-reading the exact name', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, errors: [{ code: 7502 }] }), { status: 409 }),
      )
      .mockResolvedValueOnce(ok([database]));
    expect(await ensureDatabase(deploymentSettings(env), fetchMock)).toEqual({ id: uuid, created: false });
  });
  it('handles pagination, and refuses invalid database identities', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        ok(
          Array.from({ length: 100 }, (_, i) => ({ name: `other-${i}` })),
          { total_pages: 2 },
        ),
      )
      .mockResolvedValueOnce(ok([database]));
    expect((await ensureDatabase(deploymentSettings(env), fetchMock)).id).toBe(uuid);
    expect(fetchMock.mock.calls[1][0]).toContain('page=2');
    await expect(
      ensureDatabase(
        deploymentSettings(env),
        vi.fn().mockResolvedValue(ok([{ ...database, uuid: undefined }])),
      ),
    ).rejects.toThrow('invalid database identity');
  });
  it.each([
    [undefined, true],
    ['true', true],
    ['false', false],
  ])('generates deployment bindings with WORKERS_DEV=%j and workers_dev=%s', (value, expected) => {
    const config = makeDeploymentConfig(
      {
        main: 'src/worker/index.ts',
        workers_dev: !expected,
        preview_urls: true,
        vars: { DEV_ACCESS_BYPASS: 'true' },
      },
      deploymentSettings({ ...env, WORKER_NAME: 'my-status', WORKERS_DEV: value }),
      uuid,
    );
    expect(config).toMatchObject({
      name: 'my-status',
      workers_dev: expected,
      preview_urls: false,
      d1_databases: [
        { binding: 'DB', database_name: 'my-status-db', database_id: uuid, migrations_dir: 'migrations' },
      ],
    });
    expect(JSON.stringify(config)).not.toContain('secret-token');
    expect(JSON.stringify(config)).not.toContain('DEV_ACCESS_BYPASS');
    expect(config.vars).not.toHaveProperty('WORKERS_DEV');
    expect(config).not.toHaveProperty('routes');
  });
});
