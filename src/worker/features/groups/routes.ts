import { Hono } from 'hono';
import { object, parseVersion } from '../../../shared/validation';
import { parseGroup } from '../../../shared/groups/validation';
import { parseOrderItems } from '../../../shared/ordering';
import { saveOrder } from '../ordering/repository';
import { listGroupOrder, saveGroup, deleteGroup } from './repository';
import type { AppEnv } from '../../types';

export function registerGroupRoutes(app: Hono<AppEnv>) {
  app.get('/api/admin/groups', async (c) => c.json(await listGroupOrder(c.env.DB)));
  app.put('/api/admin/groups/order', async (c) => {
    const body = object(await c.req.json());
    await saveOrder(c.env.DB, 'monitor_groups', parseOrderItems(body.items));
    return c.json(await listGroupOrder(c.env.DB));
  });
  app.post('/api/admin/groups', async (c) =>
    c.json(await saveGroup(c.env.DB, parseGroup(await c.req.json())), 201),
  );
  app.patch('/api/admin/groups/:id', async (c) => {
    const body = object(await c.req.json());
    return c.json(await saveGroup(c.env.DB, parseGroup(body), c.req.param('id'), parseVersion(body.version)));
  });
  app.delete('/api/admin/groups/:id', async (c) => {
    const body = object(await c.req.json());
    await deleteGroup(c.env.DB, c.req.param('id'), parseVersion(body.version));
    return c.json({ ok: true });
  });
}
