import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseGlobalSettingsPatch,
  parseWafDomains,
  wafSkipExpression,
  WAF_BYPASS_HEADER,
} from '../src/shared/settings';
import type { GlobalSettings } from '../src/shared/types';
import { createApp } from '../src/worker/app';
import { createProbe } from '../src/worker/probes';
import { createMonitor } from '../src/worker/repository';
import { runScheduled } from '../src/worker/scheduler';
import { getGlobalSettings } from '../src/worker/settings';
import type { Probe } from '../src/worker/types';
import { databaseFixture, environment, httpConfig, resetDatabase, success, timestamp } from './helpers';

const defaults: GlobalSettings = {
  version: 1,
  wafBypassEnabled: false,
  wafBypassDomains: [],
  wafBypassTokenConfigured: false,
};
const token = 'test-bypass-token-'.repeat(4);
const rotatedToken = 'rotated-bypass-token-'.repeat(4);
const config = {
  version: 1,
  wafBypassEnabled: true,
  wafBypassDomains: ['example.com'],
  wafBypassToken: token,
};
const headers = {
  'Cf-Access-Jwt-Assertion': 'valid',
  Origin: 'https://status.test',
  'Content-Type': 'application/json',
};
const path = 'https://status.test/api/admin/settings';
const verify = async (value: string) => {
  if (value !== 'valid') throw new Error('invalid identity');
  return { email: 'admin@example.com' };
};

describe('global settings validation', () => {
  it('normalizes and deduplicates complete DNS names including IDNs', () => {
    expect(
      parseWafDomains([' EXAMPLE.COM. ', 'example.com', '例子.测试', 'xn--fsqu00a.xn--0zwm56d']),
    ).toEqual(['example.com', 'xn--fsqu00a.xn--0zwm56d']);
  });
  it.each([
    '*.example.com',
    'https://example.com',
    'example.com/path',
    'example.com:443',
    'example.com?x=1',
    'a@example.com',
    'example.com#x',
    'example%2ecom',
    'example.com\\secret',
    'localhost',
    'server.internal',
    '127.0.0.1',
    '1.1.1.1',
    '[2606:4700::1111]',
    'bad domain.test',
    'example.com..',
    '',
  ])('rejects unsafe or ambiguous domain %s', (domain) => {
    expect(() => parseWafDomains([domain])).toThrow();
  });
  it.each([
    null,
    [],
    {},
    { version: 0 },
    { version: '1' },
    { version: 1, wafBypassEnabled: 'true' },
    { version: 1, wafBypassDomains: null },
    { version: 1, wafBypassDomains: ['example.com', 5] },
    { version: 1, wafBypassToken: null },
    { version: 1, wafBypassToken: 'short' },
    { version: 1, wafBypassToken: `${token}\r\nX-Injected: true` },
    { version: 1, wafBypassToken: 'x'.repeat(257) },
  ])('rejects malformed configuration %#', (value) => {
    expect(() => parseGlobalSettingsPatch(value, defaults)).toThrow();
  });
  it('requires both token and domains to enable bypass, and permits retaining an existing token', () => {
    expect(() => parseGlobalSettingsPatch({ ...config, wafBypassToken: '' }, defaults)).toThrow('密钥');
    expect(() => parseGlobalSettingsPatch({ ...config, wafBypassDomains: [] }, defaults)).toThrow('域名');
    expect(
      parseGlobalSettingsPatch(
        { ...config, wafBypassToken: '' },
        {
          ...defaults,
          wafBypassTokenConfigured: true,
        },
      ),
    ).not.toHaveProperty('wafBypassToken');
  });
  it('builds a rule constrained to domains, GET/HEAD and the exact token', () => {
    const expression = wafSkipExpression(['example.com', 'api.example.com'], token);
    expect(expression).toContain('http.host in {"example.com" "api.example.com"}');
    expect(expression).toContain('http.request.method in {"GET" "HEAD"}');
    expect(expression).toContain(`http.request.headers["x-uptimeworker-waf-bypass"][*] eq "${token}"`);
    expect(wafSkipExpression(['example.com'])).toContain('<YOUR_TOKEN>');
  });
});

describe('global settings API and probe integration', () => {
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

  function client(probe: Probe = async () => success()) {
    const app = createApp(probe, verify);
    const env = environment(fixture.db);
    return {
      app,
      env,
      read: () => app.request(path, { headers }, env),
      patch: (value: unknown) =>
        app.request(path, { method: 'PATCH', headers, body: JSON.stringify(value) }, env),
    };
  }

  it('defaults to disabled and persists, retains, rotates and redacts the token', async () => {
    const { read, patch } = client();
    const response = await read();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(defaults);
    const saved = await patch({ ...config, wafBypassDomains: ['Example.com.', 'example.com'] });
    expect(saved.status).toBe(200);
    expect(saved.headers.get('cache-control')).toBe('no-store');
    expect(await saved.json()).toEqual({
      ...defaults,
      version: 2,
      wafBypassEnabled: true,
      wafBypassDomains: ['example.com'],
      wafBypassTokenConfigured: true,
    });
    expect(await (await read()).text()).not.toContain(token);
    expect((await getGlobalSettings(fixture.db)).settings.wafBypass.token).toBe(token);
    expect((await patch({ version: 2, wafBypassEnabled: false, wafBypassToken: '' })).status).toBe(200);
    expect((await getGlobalSettings(fixture.db)).settings.wafBypass).toEqual({
      enabled: false,
      domains: ['example.com'],
      token,
    });
    expect((await patch({ version: 3, wafBypassEnabled: true })).status).toBe(200);
    expect((await getGlobalSettings(fixture.db)).settings.wafBypass.token).toBe(token);
    const rotated = await patch({ version: 4, wafBypassToken: rotatedToken });
    expect(rotated.status).toBe(200);
    expect(await rotated.text()).not.toContain(rotatedToken);
    expect((await getGlobalSettings(fixture.db)).settings).toMatchObject({
      version: 5,
      wafBypass: { token: rotatedToken },
    });
  });

  it('rejects unauthenticated, cross-origin and non-JSON writes', async () => {
    const { app, env } = client();
    for (const method of ['GET', 'PATCH']) {
      const response = await app.request(path, { method }, env);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    for (const [changed, status] of [
      [{ ...headers, 'Cf-Access-Jwt-Assertion': 'forged' }, 401],
      [{ ...headers, Origin: 'https://evil.test' }, 403],
      [{ ...headers, 'Content-Type': 'text/plain' }, 415],
    ] as const) {
      expect(
        (await app.request(path, { method: 'PATCH', headers: changed, body: JSON.stringify(config) }, env))
          .status,
      ).toBe(status);
    }
    expect((await getGlobalSettings(fixture.db)).settings.version).toBe(1);
  });

  it('rejects invalid and malformed updates without changing stored state', async () => {
    const { app, env, read, patch } = client();
    for (const invalid of [
      null,
      {},
      { ...config, wafBypassToken: '' },
      { ...config, wafBypassDomains: [] },
      { ...config, wafBypassDomains: ['*.example.com'] },
      { ...config, wafBypassToken: `${token}\r\n` },
    ]) {
      const response = await patch(invalid);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(token);
    }
    expect((await app.request(path, { method: 'PATCH', headers, body: '{broken' }, env)).status).toBe(400);
    expect(
      (
        await app.request(
          path,
          { method: 'PATCH', headers, body: JSON.stringify({ token: 'x'.repeat(18000) }) },
          env,
        )
      ).status,
    ).toBe(413);
    expect(await (await read()).json()).toEqual(defaults);
  });

  it('prevents concurrent updates from overwriting a newly saved token', async () => {
    const { patch } = client();
    const responses = await Promise.all([patch(config), patch({ ...config, wafBypassToken: rotatedToken })]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = responses[0].status === 200 ? token : rotatedToken;
    expect((await getGlobalSettings(fixture.db)).settings).toMatchObject({
      version: 2,
      wafBypass: { token: winner },
    });
    expect((await patch({ version: 1, wafBypassEnabled: false })).status).toBe(409);
  });

  it('uses saved settings for manual and scheduled HTTP requests without leaking secrets into outputs', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null));
    const probe = createProbe({ fetch: fetchMock, connect: vi.fn() });
    const { app, env, patch } = client(probe);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const row = (await createMonitor(fixture.db, httpConfig, timestamp))!;
    expect((await patch(config)).status).toBe(200);
    const testPath = `https://status.test/api/admin/monitors/${row.id}/test`;
    expect((await app.request(testPath, { method: 'POST', headers, body: '{}' }, env)).status).toBe(200);
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM check_results').first('n')).toBe(0);
    expect((await runScheduled(env, timestamp, probe, () => timestamp)).stored).toBe(1);
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get(WAF_BYPASS_HEADER))).toEqual(
      [token, token],
    );
    expect((await patch({ version: 2, wafBypassEnabled: false })).status).toBe(200);
    const tested = await app.request(testPath, { method: 'POST', headers, body: '{}' }, env);
    expect(await tested.text()).not.toContain(token);
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).has(WAF_BYPASS_HEADER)).toBe(false);
    for (const endpoint of [
      '/api/status',
      `/api/monitors/${row.id}/history`,
      '/api/admin/monitors',
      '/api/admin/settings',
    ]) {
      expect(
        await (await app.request(`https://status.test${endpoint}`, { headers }, env)).text(),
      ).not.toContain(token);
    }
    const history = await fixture.db.prepare('SELECT * FROM check_results').all();
    expect(JSON.stringify(history.results)).not.toContain(token);
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });

  it('keeps one settings snapshot for a round and uses rotated settings on the next round', async () => {
    const { patch } = client();
    await patch(config);
    for (let i = 0; i < 5; i++)
      await createMonitor(fixture.db, { ...httpConfig, name: `Site ${i}` }, timestamp);
    let rotated = false;
    const probe = vi.fn<Probe>().mockImplementation(async () => {
      if (!rotated) {
        rotated = true;
        expect((await patch({ version: 2, wafBypassToken: rotatedToken })).status).toBe(200);
      }
      return success();
    });
    expect((await runScheduled({ DB: fixture.db }, timestamp, probe, () => timestamp)).stored).toBe(5);
    expect(probe.mock.calls.map(([, options]) => options?.wafBypass.token)).toEqual(Array(5).fill(token));
    probe.mockClear();
    await runScheduled({ DB: fixture.db }, timestamp + 300_000, probe, () => timestamp + 300_000);
    expect(probe.mock.calls.map(([, options]) => options?.wafBypass.token)).toEqual(
      Array(5).fill(rotatedToken),
    );
  });

  it.each(['DELETE FROM global_settings', `UPDATE global_settings SET waf_bypass_domains_json = 'broken'`])(
    'stops before probing when settings cannot be read: %s',
    async (sql) => {
      const probe = vi.fn<Probe>().mockImplementation(async () => success());
      const { app, env } = client(probe);
      const row = (await createMonitor(fixture.db, httpConfig, timestamp))!;
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      await fixture.db.prepare(sql).run();
      const response = await app.request(
        `https://status.test/api/admin/monitors/${row.id}/test`,
        {
          method: 'POST',
          headers,
          body: '{}',
        },
        env,
      );
      expect(response.status).toBe(503);
      await expect(runScheduled(env, timestamp, probe, () => timestamp)).rejects.toThrow();
      expect(probe).not.toHaveBeenCalled();
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM check_results').first('n')).toBe(0);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM daily_stats').first('n')).toBe(0);
      expect(
        await fixture.db
          .prepare('SELECT lease_owner, lease_until, last_completed_slot FROM scheduler_state')
          .first(),
      ).toEqual({ lease_owner: null, lease_until: 0, last_completed_slot: 0 });
      expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    },
  );
});
