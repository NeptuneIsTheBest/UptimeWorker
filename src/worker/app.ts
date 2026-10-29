import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { parseMonitorConfig, ValidationError } from '../shared/validation';
import { MAX_MONITORS } from '../shared/types';
import { parseGlobalSettingsPatch } from '../shared/settings';
import { object, parseEventConfig, parseEventUpdateConfig, parseGroup, parseVersion } from '../shared/events';
import {
  appendEventUpdate,
  ConflictError,
  createEvent,
  deleteEvent,
  editEvent,
  getEvent,
  listEvents,
  listGroups,
  saveGroup,
} from './events';
import { requireAccess, type TokenVerifier } from './auth';
import {
  adminMonitor,
  createMonitor,
  findMonitor,
  getHistory,
  getStatus,
  listMonitors,
  monitorConfig,
  updateMonitor,
} from './repository';
import type { AppEnv, Probe } from './types';
import {
  adminSettings,
  getGlobalSettings,
  getPageRefreshSeconds,
  getProbeSnapshot,
  updateGlobalSettings,
} from './settings';

const publicCacheControl = (seconds: number) => `public, max-age=${Math.min(seconds || 60, 60)}`;

export function createApp(probe: Probe, verify?: TokenVerifier) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
  });
  app.use('/api/*', async (c, next) => {
    const monitorWrite =
      (c.req.method === 'POST' && c.req.path === '/api/admin/monitors') ||
      (c.req.method === 'PATCH' && /^\/api\/admin\/monitors\/[^/]+$/.test(c.req.path));
    return bodyLimit({
      maxSize: (monitorWrite ? 256 : 16) * 1024,
      onError: (context) => context.json({ error: '请求内容过大。' }, 413),
    })(c, next);
  });
  const auth = requireAccess(verify);
  app.use('/api/admin', auth);
  app.use('/api/admin/*', auth);
  app.use('/admin', auth);
  app.use('/admin/*', auth);

  // Only explicitly public GET endpoints are cached. Query strings are not cache keys.
  const publicCache: MiddlewareHandler<AppEnv> = async (c, next) => {
    const url = new URL(c.req.url);
    url.search = '';
    const key = new Request(url.toString(), { method: 'GET' });
    // Local edits and isolated browser-test data should not reuse a previous
    // development response. Production keeps the existing shared cache policy.
    const cache =
      __LOCAL_DEV__ || typeof caches === 'undefined'
        ? undefined
        : (caches as unknown as { default?: Cache }).default;
    const hit = await cache?.match(key);
    if (hit) return new Response(hit.body, hit);
    await next();
    if (c.res.status === 200) {
      if (cache) c.executionCtx.waitUntil(cache.put(key, c.res.clone()));
    } else c.header('Cache-Control', 'no-store');
  };
  app.get('/api/status', publicCache, async (c) => {
    const result = await getStatus(c.env);
    return c.json(result, 200, { 'Cache-Control': publicCacheControl(result.pageRefreshSeconds) });
  });
  app.get('/api/monitors/:id/history', publicCache, async (c) => {
    const result = await getHistory(c.env.DB, c.req.param('id'));
    return result
      ? c.json(result, 200, { 'Cache-Control': publicCacheControl(result.pageRefreshSeconds) })
      : c.json({ error: '监控不存在。' }, 404);
  });
  app.get('/api/admin/monitors', async (c) => {
    const [monitors, pageRefreshSeconds, groups] = await Promise.all([
      listMonitors(c.env.DB),
      getPageRefreshSeconds(c.env.DB),
      listGroups(c.env.DB),
    ]);
    return c.json({
      pageRefreshSeconds,
      groups,
      monitors: monitors.map((row) => adminMonitor(row)),
      identity: c.get('identity'),
      limit: MAX_MONITORS,
    });
  });
  app.get('/api/admin/settings', async (c) => {
    const { settings } = await getGlobalSettings(c.env.DB);
    return c.json(adminSettings(settings));
  });
  app.get('/api/admin/groups', async (c) => c.json({ groups: await listGroups(c.env.DB) }));
  app.post('/api/admin/groups', async (c) =>
    c.json(await saveGroup(c.env.DB, parseGroup(await c.req.json())), 201),
  );
  app.patch('/api/admin/groups/:id', async (c) => {
    const body = object(await c.req.json());
    return c.json(await saveGroup(c.env.DB, parseGroup(body), c.req.param('id'), parseVersion(body.version)));
  });
  app.delete('/api/admin/groups/:id', async (c) => {
    const body = object(await c.req.json());
    const deleted = await c.env.DB.prepare('DELETE FROM monitor_groups WHERE id = ? AND version = ?')
      .bind(c.req.param('id'), parseVersion(body.version))
      .run();
    if (!deleted.meta.changes) throw new ConflictError('分组已变更，请刷新后重试。');
    return c.json({ ok: true });
  });
  app.get('/api/admin/events', async (c) => {
    const [events, pageRefreshSeconds] = await Promise.all([
      listEvents(c.env.DB, { cursor: c.req.query('cursor') }),
      getPageRefreshSeconds(c.env.DB),
    ]);
    return c.json({ ...events, pageRefreshSeconds });
  });
  app.get('/api/admin/events/:id', async (c) => {
    const event = await getEvent(c.env.DB, c.req.param('id'));
    return event ? c.json(event) : c.json({ error: '事件不存在。' }, 404);
  });
  app.post('/api/admin/events', async (c) =>
    c.json(await createEvent(c.env.DB, parseEventConfig(await c.req.json())), 201),
  );
  app.patch('/api/admin/events/:id', async (c) => {
    const body = object(await c.req.json());
    const existing = await getEvent(c.env.DB, c.req.param('id'));
    if (!existing) return c.json({ error: '事件不存在。' }, 404);
    return c.json(
      await editEvent(
        c.env.DB,
        existing.id,
        parseVersion(body.version),
        parseEventConfig(
          body,
          existing.monitors.some((monitor) => monitor.id === null),
        ),
      ),
    );
  });
  app.post('/api/admin/events/:id/updates', async (c) => {
    const body = object(await c.req.json());
    return c.json(
      await appendEventUpdate(
        c.env.DB,
        c.req.param('id'),
        parseVersion(body.version),
        parseEventUpdateConfig(body),
      ),
    );
  });
  app.delete('/api/admin/events/:id', async (c) => {
    const body = object(await c.req.json());
    await deleteEvent(c.env.DB, c.req.param('id'), parseVersion(body.version));
    return c.json({ ok: true });
  });
  app.patch('/api/admin/settings', async (c) => {
    const body = await c.req.json();
    const { settings } = await getGlobalSettings(c.env.DB);
    const patch = parseGlobalSettingsPatch(body, adminSettings(settings));
    if (patch.version !== settings.version)
      return c.json({ error: '全局设置已被修改，请重新加载后重试。' }, 409);
    const updated = await updateGlobalSettings(c.env.DB, patch);
    return updated
      ? c.json(adminSettings(updated))
      : c.json({ error: '全局设置已被修改，请重新加载后重试。' }, 409);
  });
  app.post('/api/admin/monitors', async (c) => {
    const config = parseMonitorConfig(await c.req.json());
    const row = await createMonitor(c.env.DB, config);
    return row
      ? c.json(adminMonitor(row), 201)
      : c.json({ error: `免费优先模式最多支持 ${MAX_MONITORS} 个监控，请先删除不再使用的项目。` }, 409);
  });
  app.patch('/api/admin/monitors/:id', async (c) => {
    const row = await findMonitor(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ error: '监控不存在。' }, 404);
    const body = await c.req.json<Record<string, unknown>>();
    if (body?.version !== row.version) return c.json({ error: '监控已被修改，请刷新后重试。' }, 409);
    const config = parseMonitorConfig({ ...monitorConfig(row), ...body });
    const updated = await updateMonitor(c.env.DB, row.id, row.version, config);
    return updated ? c.json(adminMonitor(updated)) : c.json({ error: '监控已被修改，请刷新后重试。' }, 409);
  });
  app.delete('/api/admin/monitors/:id', async (c) => {
    const result = await c.env.DB.prepare('DELETE FROM monitors WHERE id = ?').bind(c.req.param('id')).run();
    return result.meta.changes ? c.json({ ok: true }) : c.json({ error: '监控不存在。' }, 404);
  });
  app.post('/api/admin/monitors/:id/test', async (c) => {
    const { monitors, options } = await getProbeSnapshot(c.env.DB);
    const row = monitors.find((monitor) => monitor.id === c.req.param('id'));
    if (!row) return c.json({ error: '监控不存在。' }, 404);
    return c.json(await probe(monitorConfig(row), options));
  });
  const adminPage: MiddlewareHandler<AppEnv> = async (c) => {
    // Preserve the navigation URL: /index.html is canonicalized to / by Assets.
    // The SPA asset fallback serves the shell at /admin without a redirect.
    const response = await c.env.ASSETS.fetch(c.req.raw);
    return new Response(response.body, response);
  };
  app.get('/admin', adminPage);
  app.get('/admin/*', adminPage);
  app.notFound((c) => c.json({ error: '接口不存在。' }, 404));
  app.onError((error, c) => {
    c.header('Cache-Control', 'no-store');
    if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
    if (error instanceof ConflictError) return c.json({ error: error.message }, 409);
    if (error instanceof SyntaxError) return c.json({ error: 'JSON 格式无效。' }, 400);
    console.error(JSON.stringify({ event: 'request_failed', path: new URL(c.req.url).pathname }));
    return c.json({ error: '服务暂时不可用，请稍后重试。' }, 503);
  });
  return app;
}
