import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTTP_METHODS, MAX_RESPONSE_BODY_BYTES } from '../../../src/shared/monitors/constants';
import { WAF_BYPASS_HEADER } from '../../../src/shared/settings/constants';
import type { HttpMethod } from '../../../src/shared/monitors/types';
import { parseMonitorConfig, parseRequestHeaders } from '../../../src/shared/monitors/validation';
import { createProbe } from '../../../src/worker/features/monitors/probes';
import { bypassOptions, httpConfig } from '../../support/fixtures';

afterEach(() => vi.useRealTimers());
const body = { format: 'json' as const, content: '{ "check": "正常" }' };
const check = { includes: ['healthy', '服务正常'], excludes: ['error'], ignoreCase: false };

describe('HTTP option validation', () => {
  it('normalizes keywords and headers', () => {
    expect(
      parseMonitorConfig({
        ...httpConfig,
        requestHeaders: { 'X-Test': ' value ' },
        responseCheck: { includes: [' ok ', '', 'ok'], excludes: [], ignoreCase: false },
      }),
    ).toMatchObject({
      requestHeaders: { 'x-test': 'value' },
      responseCheck: { includes: ['ok'], excludes: [], ignoreCase: false },
    });
  });
  it.each(HTTP_METHODS)('accepts method %s', (method) => {
    expect(parseMonitorConfig({ ...httpConfig, method })).toMatchObject({ method });
  });
  it.each([
    { requestHeaders: null },
    { requestHeaders: [] },
    { requestHeaders: { 'bad name': 'v' } },
    { requestHeaders: { 'X-Test': 'a\r\nInjected: value' } },
    { requestHeaders: { 'X-Test': 1 } },
    { requestHeaders: { 'X-Test': '一' } },
    { requestHeaders: { 'X-Test': 'a', 'x-test': 'b' } },
    { requestHeaders: { 'X-Test': 'a'.repeat(8192) } },
    { method: 'GET', requestBody: body },
    { method: 'HEAD', requestBody: body },
    { method: 'POST', requestBody: { format: 'json', content: '{broken' } },
    { method: 'POST', requestBody: { format: 'text', content: '一'.repeat(5500) } },
    { method: 'POST', requestBody: { format: 'xml', content: '<ok/>' } },
    { method: 'HEAD', responseCheck: check },
    { responseCheck: { ...check, ignoreCase: 'true' } },
    { responseCheck: { ...check, includes: ['a'.repeat(257)] } },
    { responseCheck: { ...check, excludes: Array(21).fill('error') } },
    { responseCheck: { ...check, includes: ['a\nb'] } },
    { wafBypassEnabled: 'true' },
    { wafBypassEnabled: true, url: 'https://1.1.1.1/' },
    { wafBypassEnabled: true, url: 'https://[2606:4700::1111]/' },
  ])('rejects incompatible or malformed options %#', (change) => {
    expect(() => parseMonitorConfig({ ...httpConfig, ...change })).toThrow();
  });
  it.each([
    'Host',
    'Content-Length',
    'X-UptimeWorker-WAF-Bypass',
    'Connection',
    'Keep-Alive',
    'Proxy-Connection',
    'Proxy-Authenticate',
    'Proxy-Authorization',
    'TE',
    'Trailer',
    'Transfer-Encoding',
    'Upgrade',
  ])('rejects reserved header %s case-insensitively', (name) => {
    expect(() => parseRequestHeaders({ [name]: 'value' })).toThrow();
    expect(() => parseRequestHeaders({ [name.toUpperCase()]: 'value' })).toThrow();
  });
  it('preserves exact request content and accepts boundary sizes', () => {
    expect(parseMonitorConfig({ ...httpConfig, method: 'POST', requestBody: body })).toMatchObject({
      requestBody: body,
    });
    expect(
      parseMonitorConfig({
        ...httpConfig,
        method: 'POST',
        requestBody: { format: 'text', content: 'x'.repeat(16384) },
      }),
    ).toHaveProperty('requestBody');
    expect(parseRequestHeaders({ X: 'x'.repeat(8187) })).toHaveProperty('x');
    expect(
      parseMonitorConfig({ ...httpConfig, responseCheck: { ...check, includes: [], excludes: [] } }),
    ).toHaveProperty('responseCheck', null);
  });
});

describe('request options and redirects', () => {
  it.each(HTTP_METHODS)(
    'sends %s with WAF credentials, custom headers and the appropriate body',
    async (method) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
      const requestBody = ['GET', 'HEAD'].includes(method) ? null : body;
      expect(
        (
          await createProbe({ fetch: fetchMock, connect: vi.fn() })(
            {
              ...httpConfig,
              method,
              wafBypassEnabled: true,
              requestBody,
              requestHeaders: { Authorization: 'Bearer secret', 'X-Check': 'yes' },
            },
            bypassOptions,
          )
        ).ok,
      ).toBe(true);
      const init = fetchMock.mock.calls[0][1]!;
      expect(init.method).toBe(method);
      expect(init.redirect).toBe('manual');
      expect(init.body).toBe(requestBody?.content);
      expect(new Headers(init.headers).get('User-Agent')).toBe('UptimeWorker/1.0');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret');
      expect(new Headers(init.headers).get(WAF_BYPASS_HEADER)).toBe(bypassOptions.wafBypass.token);
      expect(new Headers(init.headers).get('content-type')).toBe(requestBody ? 'application/json' : null);
    },
  );
  it('uses explicit content types and defaults text bodies to UTF-8', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null));
    const probe = createProbe({ fetch: fetchMock, connect: vi.fn() });
    await probe({
      ...httpConfig,
      method: 'POST',
      requestBody: body,
      requestHeaders: { 'Content-Type': 'application/vnd.test+json' },
    });
    await probe({ ...httpConfig, method: 'POST', requestBody: { format: 'text', content: '你好' } });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Content-Type')).toBe(
      'application/vnd.test+json',
    );
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Content-Type')).toBe(
      'text/plain;charset=UTF-8',
    );
  });
  it.each<[number, HttpMethod, HttpMethod]>([
    [301, 'POST', 'GET'],
    [302, 'POST', 'GET'],
    [303, 'PUT', 'GET'],
    [303, 'OPTIONS', 'GET'],
    [301, 'PUT', 'PUT'],
    [302, 'PATCH', 'PATCH'],
    [307, 'POST', 'POST'],
    [308, 'PUT', 'PUT'],
    [303, 'HEAD', 'HEAD'],
  ])('handles %s for %s as %s', async (status, method, nextMethod) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status, headers: { Location: '/ready' } }))
      .mockResolvedValueOnce(new Response(null));
    const requestBody = method === 'HEAD' ? null : body;
    expect(
      (
        await createProbe({ fetch: fetchMock, connect: vi.fn() })({
          ...httpConfig,
          method,
          requestBody,
          requestHeaders: {
            'Content-Type': 'application/custom',
            'Content-Encoding': 'identity',
            'X-Test': 'keep',
          },
        })
      ).ok,
    ).toBe(true);
    const init = fetchMock.mock.calls[1][1]!;
    expect(init.method).toBe(nextMethod);
    expect(init.body).toBe(nextMethod === 'GET' ? undefined : requestBody?.content);
    expect(new Headers(init.headers).get('Content-Type')).toBe(
      nextMethod === 'GET' ? null : 'application/custom',
    );
    expect(new Headers(init.headers).get('Content-Encoding')).toBe(nextMethod === 'GET' ? null : 'identity');
    expect(new Headers(init.headers).get('X-Test')).toBe('keep');
  });
  it('drops every custom header across origins and never restores them on return', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: 'https://other.example.com/' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: httpConfig.url } }))
      .mockResolvedValueOnce(new Response(null));
    await createProbe({ fetch: fetchMock, connect: vi.fn() })({
      ...httpConfig,
      method: 'POST',
      requestBody: body,
      requestHeaders: { Cookie: 'session=secret', Authorization: 'secret', 'X-Api-Key': 'secret' },
    });
    for (const [, init] of fetchMock.mock.calls.slice(1)) {
      for (const key of ['Cookie', 'Authorization', 'X-Api-Key', 'Content-Type'])
        expect(new Headers(init?.headers).has(key)).toBe(false);
      expect(init?.body).toBeUndefined();
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each(['https://other.example.com/', 'http://example.com/', 'https://example.com:8443/'])(
    'blocks replaying a body to %s',
    async (location) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 307, headers: { location } }));
      expect(
        await createProbe({ fetch: fetchMock, connect: vi.fn() })({
          ...httpConfig,
          method: 'POST',
          requestBody: body,
        }),
      ).toMatchObject({ ok: false, errorCode: 'unsafe_redirect' });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );
});

describe('response content checks', () => {
  it.each([
    ['healthy 服务正常', false, true],
    ['HEALTHY 服务正常', false, false],
    ['HEALTHY 服务正常', true, true],
    ['healthy 服务正常 ERROR', true, false],
    ['healthy 服务正常 error', false, false],
    ['', false, false],
  ])('matches full text %s, ignoreCase=%s', async (text, ignoreCase, ok) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(text));
    expect(
      await createProbe({ fetch: fetchMock, connect: vi.fn() })({
        ...httpConfig,
        responseCheck: { ...check, ignoreCase },
      }),
    ).toMatchObject({ ok, errorCode: ok ? null : 'content_mismatch' });
  });
  it('finds UTF-8 keywords split between bytes and matches only the final response', async () => {
    const bytes = new TextEncoder().encode('healthy 服务正常');
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }),
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('error', { status: 302, headers: { location: '/final' } }))
      .mockResolvedValueOnce(response);
    expect(
      (await createProbe({ fetch: fetchMock, connect: vi.fn() })({ ...httpConfig, responseCheck: check })).ok,
    ).toBe(true);
  });
  it('accepts an empty response for exclusion-only checks', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    expect(
      (
        await createProbe({ fetch: fetchMock, connect: vi.fn() })({
          ...httpConfig,
          responseCheck: { ...check, includes: [] },
        })
      ).ok,
    ).toBe(true);
  });
  it('reads to the end to detect excluded content even after all required words match', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('healthy 服务正常' + 'x'.repeat(20000) + 'error'));
    expect(
      (await createProbe({ fetch: fetchMock, connect: vi.fn() })({ ...httpConfig, responseCheck: check }))
        .errorCode,
    ).toBe('content_mismatch');
  });
  it('enforces the response byte limit and cancels oversized streams', async () => {
    const cancel = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('x'.repeat(MAX_RESPONSE_BODY_BYTES)))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_RESPONSE_BODY_BYTES + 1));
            },
            cancel,
          }),
        ),
      );
    const probe = createProbe({ fetch: fetchMock, connect: vi.fn() });
    const config = { ...httpConfig, responseCheck: { includes: [], excludes: ['error'], ignoreCase: false } };
    expect((await probe(config)).ok).toBe(true);
    expect((await probe(config)).errorCode).toBe('response_too_large');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('includes response reads in the deadline and cancels a stalled stream', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = createProbe({ fetch: fetchMock, connect: vi.fn() })({
      ...httpConfig,
      timeoutSeconds: 1,
      responseCheck: check,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ errorCode: 'timeout', httpStatus: 200 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('reports stream errors without leaking response data', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error('sensitive response data'));
          },
        }),
      ),
    );
    const result = await createProbe({ fetch: fetchMock, connect: vi.fn() })({
      ...httpConfig,
      responseCheck: check,
    });
    expect(result.errorCode).toBe('network');
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });
  it.each([
    ['unexpected_status', 503, {}],
    ['cloudflare_challenge', 200, { 'cf-mitigated': 'challenge' }],
  ] as const)('prioritizes %s over content matching', async (errorCode, status, headers) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('healthy 服务正常', { status, headers }));
    expect(
      (await createProbe({ fetch: fetchMock, connect: vi.fn() })({ ...httpConfig, responseCheck: check }))
        .errorCode,
    ).toBe(errorCode);
  });
});
