import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

export const publicCacheControl = (seconds: number) => `public, max-age=${Math.min(seconds || 60, 60)}`;
// Only explicitly public GET endpoints are cached. Query strings are not cache keys.
export const publicCache: MiddlewareHandler<AppEnv> = async (c, next) => {
  const url = new URL(c.req.url);
  url.search = '';
  const key = new Request(url.toString(), { method: 'GET' });
  // Local edits and isolated browser-test data should not reuse a previous
  // development response. Production keeps the existing shared cache policy.
  const cache =
    __LOCAL_DEV__ || typeof caches === 'undefined'
      ? undefined
      : (caches as unknown as { default?: Cache }).default;
  const hit = await cache?.match(key);
  if (hit) return new Response(hit.body, hit);
  await next();
  if (c.res.status === 200) {
    if (cache) c.executionCtx.waitUntil(cache.put(key, c.res.clone()));
  } else c.header('Cache-Control', 'no-store');
};
