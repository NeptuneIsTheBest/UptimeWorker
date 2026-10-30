import { errorResponse } from '../../../shared/errors';
import { Hono } from 'hono';
import { parseMonitorConfig } from '../../../shared/monitors/validation';
import { object } from '../../../shared/validation';
import { parseOrderGroup, parseOrderItems } from '../../../shared/ordering';
import { saveOrder } from '../ordering/repository';
import { listGroupOrder } from '../groups/repository';
import {
  adminMonitor,
  createMonitor,
  findMonitor,
  listMonitors,
  monitorConfig,
  updateMonitor,
  deleteMonitor,
} from './repository';
import type { AppEnv } from '../../types';
import type { Probe } from './types';
import { getPageRefreshSeconds } from '../settings/repository';
import { getProbeSnapshot } from './snapshot';

export function registerMonitorRoutes(app: Hono<AppEnv>, probe: Probe) {
  app.put('/api/admin/monitors/order', async (c) => {
    const body = object(await c.req.json());
    const groupId = parseOrderGroup(body.groupId);
    await saveOrder(c.env.DB, 'monitors', parseOrderItems(body.items), groupId);
    const monitors = (await listMonitors(c.env.DB))
      .filter((row) => row.group_id === groupId)
      .map((row) => adminMonitor(row));
    return c.json({ groupId, monitors });
  });
  app.get('/api/admin/monitors', async (c) => {
    const [monitors, pageRefreshSeconds, groupOrder] = await Promise.all([
      listMonitors(c.env.DB),
      getPageRefreshSeconds(c.env.DB),
      listGroupOrder(c.env.DB),
    ]);
    return c.json({
      pageRefreshSeconds,
      ...groupOrder,
      monitors: monitors.map((row) => adminMonitor(row)),
      identity: c.get('identity'),
    });
  });
  app.post('/api/admin/monitors', async (c) => {
    const config = parseMonitorConfig(await c.req.json());
    const row = await createMonitor(c.env.DB, config);
    return row ? c.json(adminMonitor(row), 201) : c.json(errorResponse('monitor_conflict'), 409);
  });
  app.patch('/api/admin/monitors/:id', async (c) => {
    const row = await findMonitor(c.env.DB, c.req.param('id'));
    if (!row) return c.json(errorResponse('monitor_not_found'), 404);
    const body = await c.req.json<Record<string, unknown>>();
    if (body?.version !== row.version) return c.json(errorResponse('monitor_conflict'), 409);
    const config = parseMonitorConfig({ ...monitorConfig(row), ...body });
    const updated = await updateMonitor(c.env.DB, row.id, row.version, config);
    return updated ? c.json(adminMonitor(updated)) : c.json(errorResponse('monitor_conflict'), 409);
  });
  app.delete('/api/admin/monitors/:id', async (c) => {
    const deleted = await deleteMonitor(c.env.DB, c.req.param('id'));
    return deleted ? c.json({ ok: true }) : c.json(errorResponse('monitor_not_found'), 404);
  });
  app.post('/api/admin/monitors/:id/test', async (c) => {
    const { monitors, options } = await getProbeSnapshot(c.env.DB, { id: c.req.param('id') });
    const row = monitors.find((monitor) => monitor.id === c.req.param('id'));
    if (!row) return c.json(errorResponse('monitor_not_found'), 404);
    return c.json(await probe(monitorConfig(row), options));
  });
}
