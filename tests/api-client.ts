import { createApp } from '../src/worker/app';
import type { Probe } from '../src/worker/types';
import { environment, success } from './helpers';

export const adminHeaders = {
  'Cf-Access-Jwt-Assertion': 'valid',
  Origin: 'https://status.test',
  'Content-Type': 'application/json',
};

export function apiClient(db: D1Database, probe: Probe = async () => success()) {
  const app = createApp(probe, async (token) => {
    if (token !== 'valid') throw new Error('invalid identity');
    return { email: 'admin@example.com' };
  });
  const env = environment(db);
  const request = (path: string, method = 'GET', data?: unknown, init: RequestInit = {}) =>
    app.request(
      `https://status.test/api/${path}`,
      {
        method,
        headers: adminHeaders,
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        ...init,
      },
      env,
    );
  return { app, env, request };
}
