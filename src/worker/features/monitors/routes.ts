import { Hono } from 'hono';
import { parseMonitorConfig } from '../../../shared/monitors/validation';
import { MAX_MONITORS } from '../../../shared/monitors/constants';
import { listGroups } from '../groups/repository';
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
    const deleted = await deleteMonitor(c.env.DB, c.req.param('id'));
    return deleted ? c.json({ ok: true }) : c.json({ error: '监控不存在。' }, 404);
  });
  app.post('/api/admin/monitors/:id/test', async (c) => {
    const { monitors, options } = await getProbeSnapshot(c.env.DB);
    const row = monitors.find((monitor) => monitor.id === c.req.param('id'));
    if (!row) return c.json({ error: '监控不存在。' }, 404);
    return c.json(await probe(monitorConfig(row), options));
  });
}
