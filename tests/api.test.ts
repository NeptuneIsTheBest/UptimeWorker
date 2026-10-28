import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/worker/app';
import { createMonitor, findMonitor } from '../src/worker/repository';
import { databaseFixture, environment, httpConfig, resetDatabase, success } from './helpers';

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
const verify = async (token: string) => {
  if (token !== 'valid') throw new Error('bad token');
  return { email: 'admin@example.com' };
};
const headers = {
  'Cf-Access-Jwt-Assertion': 'valid',
  Origin: 'https://status.test',
  'Content-Type': 'application/json',
};

describe('API boundaries', () => {
  it('keeps public endpoints accessible while denying unauthenticated admin paths', async () => {
    const app = createApp(async () => success(), verify);
    const env = environment(fixture.db);
    expect((await app.request('https://status.test/api/status', {}, env)).status).toBe(200);
    for (const path of ['/admin', '/admin/nested', '/api/admin', '/api/admin/monitors']) {
      const response = await app.request(`https://status.test${path}`, {}, env);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const response = await app.request('https://status.test/admin', { headers }, env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('fails closed when Access is unconfigured and never enables the development bypass in production', async () => {
    const app = createApp(async () => success(), verify);
    const env = environment(fixture.db);
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
    expect(
      (
        await app.request(
          'https://status.test/api/admin/monitors',
          { headers: { ...headers, 'Cf-Access-Jwt-Assertion': 'forged' } },
          env,
        )
      ).status,
    ).toBe(401);
  });
  it('allows CRUD with a verified identity, rejects cross-origin writes and detects stale versions', async () => {
    const app = createApp(async () => success(), verify);
    const env = environment(fixture.db);
    const path = 'https://status.test/api/admin/monitors';
    expect(
      (
        await app.request(
          path,
          {
            method: 'POST',
            headers: { ...headers, Origin: 'https://evil.test' },
            body: JSON.stringify(httpConfig),
          },
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          path,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'text/plain' },
            body: JSON.stringify(httpConfig),
          },
          env,
        )
      ).status,
    ).toBe(415);
    const created = await app.request(
      path,
      { method: 'POST', headers, body: JSON.stringify(httpConfig) },
      env,
    );
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; version: number };
    expect(
      (
        await app.request(
          `${path}/${row.id}`,
          { method: 'PATCH', headers, body: JSON.stringify({ version: row.version, enabled: false }) },
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `${path}/${row.id}`,
          { method: 'PATCH', headers, body: JSON.stringify({ version: row.version, enabled: true }) },
          env,
        )
      ).status,
    ).toBe(409);
    expect((await findMonitor(fixture.db, row.id))?.enabled).toBe(0);
    expect(
      (await app.request(`${path}/${row.id}`, { method: 'DELETE', headers, body: '{}' }, env)).status,
    ).toBe(200);
    expect(
      (await app.request(`${path}/${row.id}`, { method: 'DELETE', headers, body: '{}' }, env)).status,
    ).toBe(404);
  });
  it('returns JSON validation errors, body limits, missing monitors and unknown API paths', async () => {
    const app = createApp(async () => success(), verify);
    const env = environment(fixture.db);
    const path = 'https://status.test/api/admin/monitors';
    expect((await app.request(path, { method: 'POST', headers, body: '{broken' }, env)).status).toBe(400);
    expect((await app.request(path, { method: 'POST', headers, body: '{}' }, env)).status).toBe(400);
    expect(
      (
        await app.request(
          path,
          { method: 'POST', headers, body: JSON.stringify({ name: 'x'.repeat(18000) }) },
          env,
        )
      ).status,
    ).toBe(413);
    expect((await app.request('https://status.test/api/monitors/nope/history', {}, env)).status).toBe(404);
    const unknown = await app.request('https://status.test/api/not-an-endpoint', {}, env);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain('application/json');
  });
  it('manual connection testing never changes status, history or aggregates', async () => {
    const probe = vi.fn(async () => success());
    const app = createApp(probe, verify);
    const env = environment(fixture.db);
    const row = await createMonitor(fixture.db, httpConfig);
    const response = await app.request(
      `https://status.test/api/admin/monitors/${row!.id}/test`,
      { method: 'POST', headers, body: '{}' },
      env,
    );
    expect(response.status).toBe(200);
    expect(probe).toHaveBeenCalledOnce();
    expect((await findMonitor(fixture.db, row!.id))?.last_checked_at).toBeNull();
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM check_results').first('n')).toBe(0);
    expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM daily_stats').first('n')).toBe(0);
  });
  it('exposes only sanitized public projections and caches only successful public GET requests', async () => {
    const app = createApp(async () => success(), verify);
    const env = environment(fixture.db);
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
    expect(first.headers.get('cache-control')).toBe('public, max-age=60');
    const text = await first.text();
    for (const hidden of ['secret.example.com', 'private', 'config_json', 'expectedStatusMin'])
      expect(text).not.toContain(hidden);
    const second = await app.fetch(new Request('https://status.test/api/status?random=2'), env, ctx);
    expect(await second.text()).toBe(text);
    expect(put).toHaveBeenCalledOnce();
    const admin = await app.fetch(
      new Request('https://status.test/api/admin/monitors', { headers }),
      env,
      ctx,
    );
    expect(admin.headers.get('cache-control')).toBe('no-store');
    expect(put).toHaveBeenCalledOnce();
    const history = await app.request(`https://status.test/api/monitors/${row!.id}/history`, {}, env, ctx);
    expect(await history.text()).not.toContain('secret.example.com');
  });
});
