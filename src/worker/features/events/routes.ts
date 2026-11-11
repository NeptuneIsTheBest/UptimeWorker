import { errorResponse } from '../../../shared/errors';
import { Hono } from 'hono';
import { object, parseVersion } from '../../../shared/validation';
import {
  parseEventBulkDelete,
  parseEventConfig,
  parseEventUpdateConfig,
} from '../../../shared/events/validation';
import {
  appendEventUpdate,
  bulkDeleteEvents,
  createEvent,
  deleteEvent,
  editEvent,
  getEvent,
  listEvents,
} from './repository';
import type { AppEnv } from '../../types';
import { getPageRefreshSeconds } from '../settings/repository';

export function registerEventRoutes(app: Hono<AppEnv>) {
  app.get('/api/admin/events', async (c) => {
    const [events, pageRefreshSeconds] = await Promise.all([
      listEvents(c.env.DB, { cursor: c.req.query('cursor') }),
      getPageRefreshSeconds(c.env.DB),
    ]);
    return c.json({ ...events, pageRefreshSeconds });
  });
  app.get('/api/admin/events/:id', async (c) => {
    const event = await getEvent(c.env.DB, c.req.param('id'));
    return event ? c.json(event) : c.json(errorResponse('event_not_found'), 404);
  });
  app.post('/api/admin/events', async (c) =>
    c.json(await createEvent(c.env.DB, parseEventConfig(await c.req.json())), 201),
  );
  app.post('/api/admin/events/bulk-delete', async (c) => {
    const { items } = parseEventBulkDelete(await c.req.json());
    const deletedCount = await bulkDeleteEvents(c.env.DB, items);
    return c.json({ ok: true, deletedCount });
  });
  app.patch('/api/admin/events/:id', async (c) => {
    const body = object(await c.req.json());
    const existing = await getEvent(c.env.DB, c.req.param('id'));
    if (!existing) return c.json(errorResponse('event_not_found'), 404);
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
}
