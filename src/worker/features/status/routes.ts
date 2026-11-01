import { errorResponse } from '../../../shared/errors';
import { Hono } from 'hono';
import type { EventDetailResponse } from '../../../shared/events/types';
import { getEvent, publicEvent } from '../events/repository';
import { getHistory, getStatus } from './queries';
import type { AppEnv } from '../../types';
import { getPageRefreshSeconds } from '../settings/repository';
import { publicCache, publicCacheControl } from '../../http/cache';

export function registerPublicRoutes(app: Hono<AppEnv>) {
  app.get('/api/status', publicCache, async (c) => {
    const result = await getStatus(c.env);
    return c.json(result, 200, { 'Cache-Control': publicCacheControl(result.pageRefreshSeconds) });
  });
  app.get('/api/monitors/:id/history', publicCache, async (c) => {
    const result = await getHistory(c.env, c.req.param('id'));
    return result
      ? c.json(result, 200, { 'Cache-Control': publicCacheControl(result.pageRefreshSeconds) })
      : c.json(errorResponse('monitor_not_found'), 404);
  });
  app.get('/api/events/:id', publicCache, async (c) => {
    const [event, pageRefreshSeconds] = await Promise.all([
      getEvent(c.env.DB, c.req.param('id')),
      getPageRefreshSeconds(c.env.DB),
    ]);
    if (!event) return c.json(errorResponse('event_not_found'), 404);
    const result: EventDetailResponse = {
      siteName: c.env.SITE_NAME || 'UptimeWorker',
      event: publicEvent(event),
      generatedAt: Date.now(),
      pageRefreshSeconds,
    };
    return c.json(result, 200, { 'Cache-Control': publicCacheControl(pageRefreshSeconds) });
  });
}
