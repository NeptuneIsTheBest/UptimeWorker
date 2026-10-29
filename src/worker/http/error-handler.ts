import { ValidationError, errorResponse } from '../../shared/errors';
import { ConflictError } from '../errors';
import type { AppEnv } from '../types';
import type { ErrorHandler } from 'hono';

export const handleError: ErrorHandler<AppEnv> = (error, c) => {
  c.header('Cache-Control', 'no-store');
  if (error instanceof ValidationError) return c.json(errorResponse(error.code, error.params), 400);
  if (error instanceof ConflictError) return c.json(errorResponse(error.code, error.params), 409);
  if (error instanceof SyntaxError) return c.json(errorResponse('json_invalid'), 400);
  console.error(JSON.stringify({ event: 'request_failed', path: new URL(c.req.url).pathname }));
  return c.json(errorResponse('service_unavailable'), 503);
};
