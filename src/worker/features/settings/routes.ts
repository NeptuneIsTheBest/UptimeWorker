import { Hono } from 'hono';
import { parseGlobalSettingsPatch } from '../../../shared/settings/validation';
import type { AppEnv } from '../../types';
import { adminSettings, getGlobalSettings, updateGlobalSettings } from './repository';

export function registerSettingsRoutes(app: Hono<AppEnv>) {
  app.get('/api/admin/settings', async (c) => {
    const { settings } = await getGlobalSettings(c.env.DB);
    return c.json(adminSettings(settings));
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
}
