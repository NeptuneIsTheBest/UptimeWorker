import { errorResponse } from '../../shared/errors';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { createMiddleware } from 'hono/factory';
import type { AppEnv, Env, Identity } from '../types';

const keySets = new Map<string, JWTVerifyGetKey>();
export function accessIssuer(domain: string): string {
  const value = domain.trim().replace(/\/$/, '');
  const issuer = value.startsWith('https://') ? value : `https://${value}`;
  const url = new URL(issuer);
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Invalid Access domain');
  return url.origin;
}
export async function verifyAccessToken(
  token: string,
  env: Pick<Env, 'ACCESS_TEAM_DOMAIN' | 'ACCESS_AUD'>,
  keys?: JWTVerifyGetKey,
): Promise<Identity> {
  const issuer = accessIssuer(env.ACCESS_TEAM_DOMAIN);
  if (!env.ACCESS_AUD) throw new Error('Missing Access audience');
  if (!keys) {
    if (!keySets.has(issuer))
      keySets.set(
        issuer,
        createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 }),
      );
    keys = keySets.get(issuer)!;
  }
  const { payload } = await jwtVerify(token, keys, {
    issuer,
    audience: env.ACCESS_AUD,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub'],
  });
  if (typeof payload.email !== 'string' || !payload.email) throw new Error('A user identity is required');
  return { email: payload.email };
}

export type TokenVerifier = typeof verifyAccessToken;
export function requireAccess(verify: TokenVerifier = verifyAccessToken) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    // This entire branch is compiled out of the production Worker.
    if (
      __LOCAL_DEV__ &&
      c.env.DEV_ACCESS_BYPASS === 'true' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)
    ) {
      c.set('identity', { email: 'local@development' });
    } else {
      try {
        accessIssuer(c.env.ACCESS_TEAM_DOMAIN || '');
        if (!c.env.ACCESS_AUD) throw new Error();
      } catch {
        return c.json(errorResponse('access_unconfigured'), 503);
      }
      const token = c.req.header('Cf-Access-Jwt-Assertion');
      if (!token) return c.json(errorResponse('auth_required'), 401);
      try {
        c.set('identity', await verify(token, c.env));
      } catch {
        return c.json(errorResponse('auth_expired'), 401);
      }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      if (c.req.header('Origin') !== new URL(c.req.url).origin)
        return c.json(errorResponse('cross_site_request'), 403);
      if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json'))
        return c.json(errorResponse('json_required'), 415);
    }
    await next();
    c.header('Cache-Control', 'no-store');
  });
}
