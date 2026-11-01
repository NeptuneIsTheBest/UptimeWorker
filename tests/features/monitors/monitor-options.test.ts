import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProbe } from '../../../src/worker/features/monitors/probes';
import { findMonitor, monitorConfig } from '../../../src/worker/features/monitors/repository';
import { getHistory } from '../../../src/worker/features/status/queries';
import { runScheduled } from '../../../src/worker/features/monitors/scheduler';
import { WAF_BYPASS_HEADER } from '../../../src/shared/settings/constants';
import type { AdminMonitor } from '../../../src/shared/monitors/types';
import type { GlobalSettings } from '../../../src/shared/settings/types';
import { apiClient } from '../../support/api-client';
import { databaseFixture, httpConfig, resetDatabase, timestamp } from '../../support/fixtures';

let fixture: Awaited<ReturnType<typeof databaseFixture>>;
beforeAll(async () => {
  fixture = await databaseFixture();
});
afterAll(async () => {
  await fixture?.dispose();
});
beforeEach(async () => {
  await resetDatabase(fixture.db);
});
afterEach(() => vi.restoreAllMocks());
const token = 'private-waf-token-'.repeat(4);

function client(fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response('healthy'))) {
  const probe = createProbe({ fetch: fetchMock, connect: vi.fn(), now: () => timestamp });
  const { request, env } = apiClient(fixture.db, probe);
  const create = async (changes: Record<string, unknown> = {}) => {
    const response = await request('admin/monitors', 'POST', { ...httpConfig, ...changes });
    expect(response.status).toBe(201);
    return (await response.json()) as AdminMonitor;
  };
  const settings = async () => (await (await request('admin/settings')).json()) as GlobalSettings;
  const configure = async (changes: Record<string, unknown> = {}) => {
    const current = await settings();
    const response = await request('admin/settings', 'PATCH', {
      version: current.version,
      wafBypassEnabled: true,
      wafBypassToken: token,
      ...changes,
    });
    expect(response.status).toBe(200);
  };
  return { request, create, settings, configure, fetchMock, probe, env };
}

describe('monitor options API and scheduling', () => {
  it.each(['method', 'wafBypassEnabled', 'requestHeaders', 'requestBody', 'responseCheck'])(
    'rejects HTTP creation without %s and leaves the database unchanged',
    async (field) => {
      const config: Record<string, unknown> = { ...httpConfig };
      delete config[field];
      const response = await client().request('admin/monitors', 'POST', config);
      expect(response.status).toBe(400);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM monitors').first('n')).toBe(0);
    },
  );
  it('persists HTTP options, preserves partial updates and rejects incomplete stored configurations', async () => {
    const c = client();
    const row = await c.create({
      method: 'POST',
      wafBypassEnabled: true,
      requestHeaders: { Authorization: 'Bearer private-value' },
      requestBody: { format: 'json', content: '{ "key": 1 }' },
      responseCheck: { includes: ['healthy'], excludes: ['error'], ignoreCase: true },
    });
    const patched = await c.request(`admin/monitors/${row.id}`, 'PATCH', {
      version: row.version,
      enabled: false,
    });
    expect(await patched.json()).toMatchObject({ ...row, version: 2, enabled: false, status: 'paused' });
    const incomplete = { ...httpConfig } as Record<string, unknown>;
    for (const key of ['method', 'wafBypassEnabled', 'requestHeaders', 'requestBody', 'responseCheck'])
      delete incomplete[key];
    await fixture.db
      .prepare('UPDATE monitors SET config_json = ? WHERE id = ?')
      .bind(JSON.stringify(incomplete), row.id)
      .run();
    const stored = (await findMonitor(fixture.db, row.id))!;
    expect(() => monitorConfig(stored)).toThrow();
  });

  it('uses a changed monitor domain without updating global settings', async () => {
    const c = client();
    await c.configure();
    const row = await c.create({ wafBypassEnabled: true });
    const settings = await c.settings();
    expect((await c.request(`admin/monitors/${row.id}/test`, 'POST', {})).status).toBe(200);
    expect(
      (await c.request(`admin/monitors/${row.id}`, 'PATCH', { version: 1, url: 'https://new.example.com/' }))
        .status,
    ).toBe(200);
    expect((await c.request(`admin/monitors/${row.id}/test`, 'POST', {})).status).toBe(200);
    expect(c.fetchMock.mock.calls.map(([url]) => url)).toEqual([httpConfig.url, 'https://new.example.com/']);
    expect(
      c.fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get(WAF_BYPASS_HEADER)),
    ).toEqual([token, token]);
    expect(await c.settings()).toEqual(settings);
  });

  it('requires both switches even for two monitors sharing a domain', async () => {
    const c = client();
    const on = await c.create({ wafBypassEnabled: true });
    const off = await c.create();
    await c.configure();
    expect((await c.request(`admin/monitors/${on.id}/test`, 'POST', {})).status).toBe(200);
    await c.request(`admin/monitors/${off.id}/test`, 'POST', {});
    await c.configure({ wafBypassEnabled: false });
    const disabled = await c.request(`admin/monitors/${on.id}/test`, 'POST', {});
    expect(disabled.status).toBe(200);
    expect(await disabled.text()).not.toContain(token);
    expect(
      c.fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get(WAF_BYPASS_HEADER)),
    ).toEqual([token, null, null]);
  });

  it.each([true, false])(
    'does not send credentials to another WAF monitor or an unrelated domain (other monitor enabled=%s)',
    async (enabled) => {
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = new URL(String(input));
        const location =
          url.hostname === 'example.com'
            ? 'https://auto.example.com/'
            : url.hostname === 'auto.example.com'
              ? 'https://manual.example.com/'
              : null;
        return location
          ? new Response(null, { status: 302, headers: { location } })
          : new Response('healthy');
      });
      const c = client(fetchMock);
      const row = await c.create({ wafBypassEnabled: true });
      const other = await c.create({ wafBypassEnabled: true, enabled, url: 'https://auto.example.com/' });
      await c.configure();
      expect(await (await c.request(`admin/monitors/${row.id}/test`, 'POST', {})).json()).toMatchObject({
        ok: true,
      });
      expect(
        fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get(WAF_BYPASS_HEADER)),
      ).toEqual([token, null, null]);
      fetchMock.mockClear();
      await fixture.db
        .prepare('UPDATE monitors SET next_check_at = ? WHERE id = ?')
        .bind(timestamp + 300000, other.id)
        .run();
      expect((await runScheduled(c.env, timestamp, c.probe, () => timestamp)).stored).toBe(1);
      expect(
        fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get(WAF_BYPASS_HEADER)),
      ).toEqual([token, null, null]);
    },
  );

  it('keeps monitor configurations stable during a scheduled round and updates the next round', async () => {
    const c = client();
    const rows = await Promise.all(
      Array.from({ length: 5 }, (_, i) => c.create({ name: `Site ${i}`, wafBypassEnabled: true })),
    );
    await c.configure();
    let edited = false;
    const probe = vi.fn<typeof c.probe>().mockImplementation(async (config, options) => {
      if (!edited) {
        edited = true;
        await c.request(`admin/monitors/${rows[0].id}`, 'PATCH', {
          version: 1,
          url: 'https://changed.example.com/',
        });
      }
      return c.probe(config, options);
    });
    await runScheduled(c.env, timestamp, probe, () => timestamp);
    expect(probe.mock.calls).toHaveLength(5);
    expect(probe.mock.calls.map(([config]) => config.type === 'http' && config.url)).toEqual(
      Array(5).fill(httpConfig.url),
    );
    probe.mockClear();
    await runScheduled(c.env, timestamp + 300000, probe, () => timestamp + 300000);
    expect(probe.mock.calls.map(([config]) => config.type === 'http' && config.url).sort()).toEqual([
      'https://changed.example.com/',
      ...Array(4).fill(httpConfig.url),
    ]);
    for (const [, init] of c.fetchMock.mock.calls)
      expect(new Headers(init?.headers).get(WAF_BYPASS_HEADER)).toBe(token);
  });

  it.each([
    ['healthy', true, null],
    ['private-keyword', false, 'content_mismatch'],
  ] as const)(
    'keeps manual checks transient and scheduled results private for keyword %s',
    async (keyword, ok, errorCode) => {
      const c = client();
      const log = vi.spyOn(console, 'info').mockImplementation(() => {});
      const row = await c.create({
        method: 'POST',
        wafBypassEnabled: true,
        requestHeaders: { Authorization: 'Bearer private-value' },
        requestBody: { format: 'json', content: '{"secret":"private-body"}' },
        responseCheck: { includes: [keyword], excludes: [], ignoreCase: false },
      });
      await c.configure();
      const manual = await c.request(`admin/monitors/${row.id}/test`, 'POST', {});
      expect(manual.status).toBe(200);
      const manualResult = await manual.json();
      expect(manualResult).toMatchObject({ ok, errorCode });
      expect(c.fetchMock).toHaveBeenCalledOnce();
      expect((await findMonitor(fixture.db, row.id))?.last_checked_at).toBeNull();
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM check_results').first('n')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM daily_stats').first('n')).toBe(0);
      expect((await runScheduled(c.env, timestamp, c.probe, () => timestamp)).stored).toBe(1);
      expect(await findMonitor(fixture.db, row.id)).toMatchObject({
        last_ok: Number(ok),
        last_error_code: errorCode,
      });
      expect(c.fetchMock).toHaveBeenCalledTimes(2);
      for (const [, init] of c.fetchMock.mock.calls) {
        expect(init).toMatchObject({ method: 'POST', body: '{"secret":"private-body"}' });
        expect(new Headers(init?.headers).get(WAF_BYPASS_HEADER)).toBe(token);
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-value');
      }
      const outputs = [
        JSON.stringify(manualResult),
        await (await c.request('status')).text(),
        await (await c.request(`monitors/${row.id}/history`)).text(),
        JSON.stringify(await getHistory(c.env, row.id, timestamp)),
        JSON.stringify(log.mock.calls),
        JSON.stringify((await fixture.db.prepare('SELECT * FROM check_results').all()).results),
      ];
      for (const output of outputs)
        for (const secret of [token, 'private-value', 'private-body', 'private-keyword', 'healthy'])
          expect(output).not.toContain(secret);
      for (const endpoint of ['admin/monitors', 'admin/settings'])
        expect(await (await c.request(endpoint)).text()).not.toContain(token);
    },
  );
});
