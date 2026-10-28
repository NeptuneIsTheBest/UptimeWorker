import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { parseMonitorConfig, ValidationError } from '../shared/validation';
import { MAX_MONITORS } from '../shared/types';
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

export function createApp(probe: Probe, verify?: TokenVerifier) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
  });
  app.use(
    '/api/*',
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: '请求内容过大。' }, 413) }),
  );
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
    const cache =
      typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: Cache }).default;
    const hit = await cache?.match(key);
    if (hit) return new Response(hit.body, hit);
    await next();
    if (c.res.status === 200) {
      c.header('Cache-Control', 'public, max-age=60');
      if (cache) c.executionCtx.waitUntil(cache.put(key, c.res.clone()));
    } else c.header('Cache-Control', 'no-store');
  };
  app.get('/api/status', publicCache, async (c) => c.json(await getStatus(c.env)));
  app.get('/api/monitors/:id/history', publicCache, async (c) => {
    const result = await getHistory(c.env.DB, c.req.param('id'));
    return result ? c.json(result) : c.json({ error: '监控不存在。' }, 404);
  });
  app.get('/api/admin/monitors', async (c) =>
    c.json({
      monitors: (await listMonitors(c.env.DB)).map((row) => adminMonitor(row)),
      identity: c.get('identity'),
      limit: MAX_MONITORS,
    }),
  );
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
    const row = await findMonitor(c.env.DB, c.req.param('id'));
    return row ? c.json(await probe(monitorConfig(row))) : c.json({ error: '监控不存在。' }, 404);
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
    if (error instanceof SyntaxError) return c.json({ error: 'JSON 格式无效。' }, 400);
    console.error(JSON.stringify({ event: 'request_failed', path: new URL(c.req.url).pathname }));
    return c.json({ error: '服务暂时不可用，请稍后重试。' }, 503);
  });
  return app;
}
