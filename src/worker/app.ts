import { Hono, type MiddlewareHandler } from 'hono';
import type { TokenVerifier } from './http/auth';
import type { AppEnv } from './types';
import type { Probe } from './features/monitors/types';
import { registerMiddleware } from './http/middleware';
import { registerPublicRoutes } from './features/status/routes';
import { registerMonitorRoutes } from './features/monitors/routes';
import { registerGroupRoutes } from './features/groups/routes';
import { registerEventRoutes } from './features/events/routes';
import { registerSettingsRoutes } from './features/settings/routes';
import { handleError } from './http/error-handler';

export function createApp(probe: Probe, verify?: TokenVerifier) {
  const app = new Hono<AppEnv>();
  registerMiddleware(app, verify);
  registerPublicRoutes(app);
  registerMonitorRoutes(app, probe);
  registerGroupRoutes(app);
  registerEventRoutes(app);
  registerSettingsRoutes(app);
  const adminPage: MiddlewareHandler<AppEnv> = async (c) => {
    // Preserve the navigation URL: /index.html is canonicalized to / by Assets.
    // The SPA asset fallback serves the shell at /admin without a redirect.
    const response = await c.env.ASSETS.fetch(c.req.raw);
    return new Response(response.body, response);
  };
  app.get('/admin', adminPage);
  app.get('/admin/*', adminPage);
  app.notFound((c) => c.json({ error: '接口不存在。' }, 404));
  app.onError(handleError);
  return app;
}
