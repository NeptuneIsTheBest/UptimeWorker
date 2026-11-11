import { errorResponse } from '../../shared/errors';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireAccess, type TokenVerifier } from './auth';
import type { AppEnv } from '../types';

export function registerMiddleware(app: Hono<AppEnv>, verify?: TokenVerifier) {
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
    const orderWrite =
      c.req.method === 'PUT' && ['/api/admin/monitors/order', '/api/admin/groups/order'].includes(c.req.path);
    const bulkEventDelete = c.req.method === 'POST' && c.req.path === '/api/admin/events/bulk-delete';
    return bodyLimit({
      maxSize: (monitorWrite || orderWrite || bulkEventDelete ? 256 : 16) * 1024,
      onError: (context) => context.json(errorResponse('request_too_large'), 413),
    })(c, next);
  });
  const auth = requireAccess(verify);
  app.use('/api/admin', auth);
  app.use('/api/admin/*', auth);
  app.use('/admin', auth);
  app.use('/admin/*', auth);
}
