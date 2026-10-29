import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseGlobalSettingsPatch } from '../../../src/shared/settings/validation';
import { wafRuleDomains, wafSkipExpression } from '../../../src/shared/settings/waf';
import type { GlobalSettings } from '../../../src/shared/settings/types';
import { createMonitor } from '../../../src/worker/features/monitors/repository';
import { runScheduled } from '../../../src/worker/features/monitors/scheduler';
import { getGlobalSettings } from '../../../src/worker/features/settings/repository';
import { getProbeSnapshot } from '../../../src/worker/features/monitors/snapshot';
import type { Probe } from '../../../src/worker/features/monitors/types';
import { apiClient } from '../../support/api-client';
import {
  databaseFixture,
  httpConfig,
  tcpConfig,
  resetDatabase,
  success,
  timestamp,
} from '../../support/fixtures';

const defaults: GlobalSettings = {
  version: 1,
  pageRefreshSeconds: 30,
  autoIncidentAfterMinutes: 5,
  wafBypassEnabled: false,
  wafBypassTokenConfigured: false,
};
const token = 'test-bypass-token-'.repeat(4);
const rotatedToken = 'rotated-bypass-token-'.repeat(4);
const config = {
  version: 1,
  pageRefreshSeconds: 30,
  autoIncidentAfterMinutes: 5,
  wafBypassEnabled: true,
  wafBypassToken: token,
};

describe('global settings validation', () => {
  it.each([0, 5, 15, 30, 60, 127, 3600])(
    'accepts a page refresh interval of %s seconds',
    (pageRefreshSeconds) => {
      expect(parseGlobalSettingsPatch({ version: 1, pageRefreshSeconds }, defaults).pageRefreshSeconds).toBe(
        pageRefreshSeconds,
      );
    },
  );
  it.each([-1, 1, 4, 3601, 15.5, '15', '', null, false])(
    'rejects an invalid page refresh interval: %j',
    (pageRefreshSeconds) => {
      expect(() => parseGlobalSettingsPatch({ version: 1, pageRefreshSeconds }, defaults)).toThrow(
        '页面刷新间隔',
      );
    },
  );
  it('preserves the current refresh interval when omitted, including disabled refresh', () => {
    for (const pageRefreshSeconds of [0, 127])
      expect(
        parseGlobalSettingsPatch({ version: 1 }, { ...defaults, pageRefreshSeconds }).pageRefreshSeconds,
      ).toBe(pageRefreshSeconds);
  });
  it('derives normalized, deduplicated rule domains from enabled WAF monitors, including paused ones', () => {
    expect(
      wafRuleDomains([
        { ...httpConfig, wafBypassEnabled: true, url: 'https://EXAMPLE.COM./health' },
        { ...httpConfig, wafBypassEnabled: true, url: 'http://example.com:8080/' },
        { ...httpConfig, wafBypassEnabled: true, url: 'https://例子.测试/' },
        { ...httpConfig, wafBypassEnabled: true, url: 'https://xn--fsqu00a.xn--0zwm56d/' },
        { ...httpConfig, wafBypassEnabled: true, enabled: false, url: 'https://paused.example.com/' },
        { ...httpConfig, url: 'https://off.example.com/' },
        { ...httpConfig, wafBypassEnabled: true, url: 'https://1.1.1.1/' },
        tcpConfig,
      ]),
    ).toEqual(['example.com', 'paused.example.com', 'xn--fsqu00a.xn--0zwm56d']);
    expect(wafRuleDomains([httpConfig, tcpConfig])).toEqual([]);
  });
  it.each([{ domains: ['redirect.example.com'] }, { domains: null }, { domains: ['*.example.com', 5] }])(
    'ignores retired domain fields in updates: %j',
    ({ domains }) => {
      expect(
        parseGlobalSettingsPatch(
          { ...config, wafBypassDomains: domains, wafBypassAutoDomains: domains },
          defaults,
        ),
      ).toEqual(config);
    },
  );
  it.each([
    null,
    [],
    {},
    { version: 0 },
    { version: '1' },
    { version: 1, wafBypassEnabled: 'true' },
    { version: 1, wafBypassToken: null },
    { version: 1, wafBypassToken: 'short' },
    { version: 1, wafBypassToken: `${token}\r\nX-Injected: true` },
    { version: 1, wafBypassToken: 'x'.repeat(257) },
  ])('rejects malformed configuration %#', (value) => {
    expect(() => parseGlobalSettingsPatch(value, defaults)).toThrow();
  });
  it('requires a token and permits retaining an existing token', () => {
    expect(() => parseGlobalSettingsPatch({ ...config, wafBypassToken: '' }, defaults)).toThrow('密钥');
    expect(parseGlobalSettingsPatch(config, defaults).wafBypassEnabled).toBe(true);
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
  it('builds a rule constrained to domains, supported methods and the exact token', () => {
    const expression = wafSkipExpression(['example.com', 'api.example.com'], token);
    expect(expression).toContain('http.host in {"example.com" "api.example.com"}');
    expect(expression).toContain(
      'http.request.method in {"GET" "HEAD" "POST" "PUT" "PATCH" "DELETE" "OPTIONS"}',
    );
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

  function client(probe?: Probe) {
    const c = apiClient(fixture.db, probe);
    return {
      ...c,
      read: () => c.request('admin/settings'),
      patch: (value: unknown) => c.request('admin/settings', 'PATCH', value),
    };
  }

  it('defaults to disabled and persists, retains, rotates and redacts the token', async () => {
    const { read, patch } = client();
    const response = await read();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(defaults);
    const saved = await patch(config);
    expect(saved.status).toBe(200);
    expect(saved.headers.get('cache-control')).toBe('no-store');
    expect(await saved.json()).toEqual({
      ...defaults,
      version: 2,
      wafBypassEnabled: true,
      wafBypassTokenConfigured: true,
    });
    expect(await (await read()).text()).not.toContain(token);
    expect((await getGlobalSettings(fixture.db)).settings.wafBypass.token).toBe(token);
    expect((await patch({ version: 2, wafBypassEnabled: false, wafBypassToken: '' })).status).toBe(200);
    expect((await getGlobalSettings(fixture.db)).settings.wafBypass).toEqual({
      enabled: false,
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

  it.each(['["redirect.example.com"]', 'broken'])(
    'ignores and preserves the retired stored domain data: %s',
    async (legacyDomains) => {
      const { read, patch } = client();
      await fixture.db
        .prepare('UPDATE global_settings SET waf_bypass_domains_json = ?')
        .bind(legacyDomains)
        .run();
      expect(await (await read()).json()).toEqual(defaults);
      const saved = await patch({ ...config, wafBypassDomains: null, wafBypassAutoDomains: ['other.test'] });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toEqual({
        version: 2,
        pageRefreshSeconds: 30,
        autoIncidentAfterMinutes: 5,
        wafBypassEnabled: true,
        wafBypassTokenConfigured: true,
      });
      expect(
        await fixture.db
          .prepare('SELECT waf_bypass_domains_json FROM global_settings')
          .first('waf_bypass_domains_json'),
      ).toBe(legacyDomains);
      expect((await getProbeSnapshot(fixture.db)).options.wafBypass).toEqual({ enabled: true, token });
    },
  );

  it('reads and updates settings independently of monitor data', async () => {
    const { read, patch } = client();
    const row = (await createMonitor(fixture.db, httpConfig, timestamp))!;
    await fixture.db.prepare('UPDATE monitors SET config_json = ? WHERE id = ?').bind('broken', row.id).run();
    expect(await (await read()).json()).toEqual(defaults);
    expect((await patch(config)).status).toBe(200);
  });

  it('persists refresh preferences, preserves them in WAF-only updates and rejects stale writes', async () => {
    const { read, patch } = client();
    let version = 1;
    for (const pageRefreshSeconds of [15, 127, 0]) {
      const saved = await patch({ version, pageRefreshSeconds });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ version: ++version, pageRefreshSeconds });
      expect(await (await read()).json()).toMatchObject({ version, pageRefreshSeconds });
    }
    expect((await patch({ version, wafBypassToken: token })).status).toBe(200);
    expect(await (await read()).json()).toMatchObject({
      version: ++version,
      pageRefreshSeconds: 0,
      wafBypassTokenConfigured: true,
    });
    expect((await patch({ version: version - 1, pageRefreshSeconds: 30 })).status).toBe(409);
    for (const pageRefreshSeconds of [4, 3601, 1.5, '30', null])
      expect((await patch({ version, pageRefreshSeconds })).status).toBe(400);
    expect(await (await read()).json()).toMatchObject({ version, pageRefreshSeconds: 0 });
    expect((await getGlobalSettings(fixture.db)).settings.wafBypass.token).toBe(token);
  });

  it('rejects invalid settings without changing stored state or exposing the token', async () => {
    const { read, patch } = client();
    for (const invalid of [
      null,
      { ...config, wafBypassToken: '' },
      { ...config, wafBypassToken: `${token}\r\n` },
    ]) {
      const response = await patch(invalid);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(token);
    }
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

  it.each(['DELETE FROM global_settings', `UPDATE global_settings SET waf_bypass_token = 'short'`])(
    'stops before probing when settings cannot be read: %s',
    async (sql) => {
      const probe = vi.fn<Probe>().mockImplementation(async () => success());
      const { request, env } = client(probe);
      const row = (await createMonitor(fixture.db, httpConfig, timestamp))!;
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      await fixture.db.prepare(sql).run();
      const response = await request(`admin/monitors/${row.id}/test`, 'POST', {});
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
