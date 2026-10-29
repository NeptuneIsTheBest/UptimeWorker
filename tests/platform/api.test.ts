import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMonitor, findMonitor } from '../../src/worker/features/monitors/repository';
import { createEvent } from '../../src/worker/features/events/repository';
import type { AdminMonitor } from '../../src/shared/monitors/types';
import { adminHeaders as headers, apiClient } from '../support/api-client';
import { databaseFixture, httpConfig, tcpConfig, resetDatabase } from '../support/fixtures';

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
afterEach(() => vi.unstubAllGlobals());

const settingsUpdate = { version: 1, wafBypassEnabled: true, wafBypassToken: 'test-token-'.repeat(4) };
const writes = [
  ['admin/monitors', 'POST', httpConfig],
  ['admin/settings', 'PATCH', settingsUpdate],
] as const;

describe('API boundaries', () => {
  it('keeps public endpoints accessible while denying unauthenticated admin paths', async () => {
    const { app, env, request } = apiClient(fixture.db);
    expect((await request('status', 'GET', undefined, { headers: {} })).status).toBe(200);
    for (const [path, method] of [
      ['/admin', 'GET'],
      ['/admin/nested', 'GET'],
      ['/api/admin', 'GET'],
      ['/api/admin/monitors', 'GET'],
      ['/api/admin/monitors', 'POST'],
      ['/api/admin/settings', 'GET'],
      ['/api/admin/settings', 'PATCH'],
    ]) {
      const response = await app.request(`https://status.test${path}`, { method }, env);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const response = await app.request('https://status.test/admin', { headers }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('fails closed when Access is unconfigured and never enables the development bypass in production', async () => {
    const { app, env } = apiClient(fixture.db);
    expect(
      (await app.request('https://status.test/api/admin/monitors', { headers }, { ...env, ACCESS_AUD: '' }))
        .status,
    ).toBe(503);
    expect(
      (
        await app.request(
          'http://localhost/api/admin/monitors',
          { headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com' } },
          { ...env, DEV_ACCESS_BYPASS: 'true' },
        )
      ).status,
    ).toBe(401);
  });

  it.each(writes)(
    'protects %s writes from forged identities, other origins and non-JSON content',
    async (path, method, body) => {
      const { request } = apiClient(fixture.db);
      for (const [changed, status] of [
        [{ ...headers, 'Cf-Access-Jwt-Assertion': 'forged' }, 401],
        [{ ...headers, Origin: 'https://evil.test' }, 403],
        [{ ...headers, 'Content-Type': 'text/plain' }, 415],
      ] as const) {
        const response = await request(path, method, body, { headers: changed });
        expect(response.status).toBe(status);
        expect(response.headers.get('cache-control')).toBe('no-store');
      }
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM monitors').first('n')).toBe(0);
      expect(await fixture.db.prepare('SELECT version FROM global_settings').first('version')).toBe(1);
    },
  );

  it('allows CRUD with a verified identity and detects stale monitor versions', async () => {
    const { request } = apiClient(fixture.db);
    const created = await request('admin/monitors', 'POST', httpConfig);
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; version: number };
    const path = `admin/monitors/${row.id}`;
    expect((await request(path, 'PATCH', { version: row.version, enabled: false })).status).toBe(200);
    expect((await request(path, 'PATCH', { version: row.version, enabled: true })).status).toBe(409);
    expect(await findMonitor(fixture.db, row.id)).toMatchObject({ enabled: 0, interval_minutes: 5 });
    expect((await request(path, 'DELETE', {})).status).toBe(200);
    expect((await request(path, 'DELETE', {})).status).toBe(404);
  });

  it.each([httpConfig, tcpConfig])(
    'defaults and edits custom intervals for $type monitors',
    async (config) => {
      const { request } = apiClient(fixture.db);
      const created = await request('admin/monitors', 'POST', { ...config, intervalMinutes: undefined });
      expect(created.status).toBe(201);
      const row = (await created.json()) as AdminMonitor;
      expect(row.intervalMinutes).toBe(1);
      const path = `admin/monitors/${row.id}`;
      const updated = await request(path, 'PATCH', { version: 1, intervalMinutes: 7 });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ intervalMinutes: 7, version: 2 });
      const renamed = await request(path, 'PATCH', { version: 2, name: '自定义间隔' });
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toMatchObject({ intervalMinutes: 7, version: 3 });
      expect(await findMonitor(fixture.db, row.id)).toMatchObject({ interval_minutes: 7, version: 3 });
    },
  );

  it('rejects invalid intervals on creation and editing without modifying saved configuration', async () => {
    const { request } = apiClient(fixture.db);
    const row = (await createMonitor(fixture.db, { ...httpConfig, intervalMinutes: 2 }))!;
    for (const intervalMinutes of [0, 61, 1.5, '1', null]) {
      const created = await request('admin/monitors', 'POST', { ...httpConfig, intervalMinutes });
      expect(created.status).toBe(400);
      expect(await created.json()).toHaveProperty('error', '检测间隔需为 1–60 分钟的整数');
      const updated = await request(`admin/monitors/${row.id}`, 'PATCH', { version: 1, intervalMinutes });
      expect(updated.status).toBe(400);
    }
    expect(await findMonitor(fixture.db, row.id)).toMatchObject({ interval_minutes: 2, version: 1 });
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM monitors').first('n')).toBe(1);
  });

  it('returns JSON errors for malformed writes, missing monitors and unknown API paths', async () => {
    const { request } = apiClient(fixture.db);
    for (const [path, method] of writes) {
      for (const body of ['{broken', '{}']) {
        const response = await request(path, method, undefined, { body });
        expect(response.status).toBe(400);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(await response.json()).toHaveProperty('error');
      }
    }
    expect((await request('monitors/nope/history')).status).toBe(404);
    const unknown = await request('not-an-endpoint');
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain('application/json');
    expect(await fixture.db.prepare('SELECT version FROM global_settings').first('version')).toBe(1);
  });

  it('allows larger monitor JSON envelopes while enforcing field and route-specific limits', async () => {
    const { request } = apiClient(fixture.db);
    // Escaping makes this valid 16 KiB body exceed the ordinary API envelope limit.
    const requestBody = { format: 'text', content: '\t'.repeat(16384) };
    const created = await request('admin/monitors', 'POST', { ...httpConfig, method: 'POST', requestBody });
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; version: number };
    expect(row).toHaveProperty('requestBody', requestBody);
    const path = `admin/monitors/${row.id}`;
    expect((await request(path, 'PATCH', { version: row.version, requestBody })).status).toBe(200);
    expect(
      (
        await request(path, 'PATCH', {
          version: 2,
          requestBody: { format: 'text', content: 'x'.repeat(16385) },
        })
      ).status,
    ).toBe(400);
    for (const [target, method] of [
      ['admin/monitors', 'POST'],
      [path, 'PATCH'],
    ])
      expect((await request(target, method, { padding: 'x'.repeat(256 * 1024) })).status).toBe(413);
    for (const [target, method] of [
      ['admin/settings', 'PATCH'],
      [`${path}/test`, 'POST'],
      [path, 'DELETE'],
    ])
      expect((await request(target, method, { padding: 'x'.repeat(16 * 1024) })).status).toBe(413);
    expect(await fixture.db.prepare('SELECT version FROM global_settings').first('version')).toBe(1);
  });

  it.each([0, 5, 15, 30, 60, 127, 3600])(
    'returns the global refresh interval of %s seconds with matching public cache lifetimes',
    async (pageRefreshSeconds) => {
      const { request } = apiClient(fixture.db);
      const row = (await createMonitor(fixture.db, httpConfig))!;
      const event = await createEvent(fixture.db, {
        title: '公开事件',
        body: '检查详情缓存',
        type: 'incident',
        monitorIds: [row.id],
        startsAt: null,
        endsAt: null,
      });
      expect(
        (await request('admin/settings', 'PATCH', { ...settingsUpdate, pageRefreshSeconds })).status,
      ).toBe(200);
      for (const path of ['status', `monitors/${row.id}/history`, `events/${event.id}`, 'admin/monitors']) {
        const response = await request(path);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe(
          path.startsWith('admin/')
            ? 'no-store'
            : `public, max-age=${Math.min(pageRefreshSeconds || 60, 60)}`,
        );
        const body = (await response.json()) as Record<string, unknown>;
        expect(body.pageRefreshSeconds).toBe(pageRefreshSeconds);
        for (const field of ['wafBypassEnabled', 'wafBypassToken', 'wafBypassTokenConfigured', 'version'])
          expect(body).not.toHaveProperty(field);
        expect(JSON.stringify(body)).not.toContain(settingsUpdate.wafBypassToken);
      }
    },
  );

  it('exposes only sanitized public projections and caches only successful public GET requests', async () => {
    const { app, env, request } = apiClient(fixture.db);
    const row = await createMonitor(fixture.db, {
      ...httpConfig,
      url: 'https://secret.example.com/health?token=private',
    });
    const stored = new Map<string, Response>();
    const put = vi.fn(async (request: Request, response: Response) => {
      stored.set(request.url, response);
    });
    vi.stubGlobal('caches', {
      default: { match: async (request: Request) => stored.get(request.url)?.clone(), put },
    });
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (task: Promise<unknown>) => pending.push(task),
      passThroughOnException() {},
    } as unknown as ExecutionContext;
    const first = await app.fetch(new Request('https://status.test/api/status?random=1'), env, ctx);
    await Promise.all(pending);
    expect(first.headers.get('cache-control')).toBe('public, max-age=30');
    const text = await first.text();
    for (const hidden of ['secret.example.com', 'private', 'config_json', 'expectedStatusMin'])
      expect(text).not.toContain(hidden);
    // Existing cache entries keep their old setting until their original TTL expires.
    expect((await request('admin/settings', 'PATCH', { version: 1, pageRefreshSeconds: 15 })).status).toBe(
      200,
    );
    const second = await app.fetch(new Request('https://status.test/api/status?random=2'), env, ctx);
    expect(await second.text()).toBe(text);
    expect(put).toHaveBeenCalledOnce();
    const admin = await app.fetch(
      new Request('https://status.test/api/admin/monitors', { headers }),
      env,
      ctx,
    );
    expect(admin.headers.get('cache-control')).toBe('no-store');
    expect(await admin.json()).toMatchObject({ pageRefreshSeconds: 15 });
    expect(put).toHaveBeenCalledOnce();
    const history = await app.request(`https://status.test/api/monitors/${row!.id}/history`, {}, env, ctx);
    expect(history.headers.get('cache-control')).toBe('public, max-age=15');
    expect(await history.text()).not.toContain('secret.example.com');
    const event = await createEvent(fixture.db, {
      title: '公开事件',
      body: '检查事件缓存',
      type: 'incident',
      monitorIds: [row!.id],
      startsAt: null,
      endsAt: null,
    });
    const eventDetail = await app.request(
      `https://status.test/api/events/${event.id}?random=1`,
      {},
      env,
      ctx,
    );
    expect(eventDetail.headers.get('cache-control')).toBe('public, max-age=15');
    const detailText = await eventDetail.text();
    for (const hidden of ['secret.example.com', 'private', 'version', 'write_token'])
      expect(detailText).not.toContain(hidden);
    await Promise.all(pending);
    const puts = put.mock.calls.length;
    const cachedEvent = await app.request(
      `https://status.test/api/events/${event.id}?random=2`,
      {},
      env,
      ctx,
    );
    expect(await cachedEvent.text()).toBe(detailText);
    expect(put).toHaveBeenCalledTimes(puts);
    const missingEvent = await app.request('https://status.test/api/events/missing', {}, env, ctx);
    expect(missingEvent.status).toBe(404);
    expect(missingEvent.headers.get('cache-control')).toBe('no-store');
    expect(put).toHaveBeenCalledTimes(puts);
    const missing = await app.request('https://status.test/api/monitors/missing/history', {}, env, ctx);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    expect(put).toHaveBeenCalledTimes(puts);
    stored.clear();
    const renewed = await app.fetch(new Request('https://status.test/api/status'), env, ctx);
    expect(renewed.headers.get('cache-control')).toBe('public, max-age=15');
    expect(await renewed.json()).toMatchObject({ pageRefreshSeconds: 15 });
    await Promise.all(pending);
  });
});
