import { ValidationError } from '../../shared/errors';
import { ConflictError } from '../errors';
import type { AppEnv } from '../types';
import type { ErrorHandler } from 'hono';

export const handleError: ErrorHandler<AppEnv> = (error, c) => {
  c.header('Cache-Control', 'no-store');
  if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
  if (error instanceof ConflictError) return c.json({ error: error.message }, 409);
  if (error instanceof SyntaxError) return c.json({ error: 'JSON 格式无效。' }, 400);
  console.error(JSON.stringify({ event: 'request_failed', path: new URL(c.req.url).pathname }));
  return c.json({ error: '服务暂时不可用，请稍后重试。' }, 503);
};
