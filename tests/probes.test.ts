import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProbe, type TcpSocket } from '../src/worker/probes';
import { bypassOptions, httpConfig, tcpConfig } from './helpers';
import { WAF_BYPASS_HEADER } from '../src/shared/settings';
const wafConfig = { ...httpConfig, wafBypassEnabled: true };

afterEach(() => vi.useRealTimers());
describe('HTTP probes', () => {
  it('checks a response without consuming its body, and releases the connection', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status: 200 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    const result = await createProbe({ fetch: fetchMock, connect: vi.fn() })(httpConfig);
    expect(result).toMatchObject({ ok: true, httpStatus: 200, errorCode: null });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has(WAF_BYPASS_HEADER)).toBe(false);
  });
  it('supports HEAD and configurable expected statuses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const result = await createProbe({ fetch: fetchMock, connect: vi.fn() })({
      ...httpConfig,
      type: 'http',
      method: 'HEAD',
      expectedStatusMin: 204,
      expectedStatusMax: 204,
    });
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('HEAD');
  });
  it('records a bad status as an unsuccessful check', async () => {
    const probe = createProbe({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
      connect: vi.fn(),
    });
    expect(await probe(httpConfig)).toMatchObject({
      ok: false,
      httpStatus: 503,
      errorCode: 'unexpected_status',
    });
  });
  it('follows relative redirects and records the final status', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/ready' } }))
      .mockResolvedValueOnce(new Response('ok'));
    expect((await createProbe({ fetch: fetchMock, connect: vi.fn() })(httpConfig)).ok).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/ready');
  });
  it('stops after three redirects and rejects redirected private addresses', async () => {
    const looping = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(null, { status: 301, headers: { location: '/again' } }));
    expect((await createProbe({ fetch: looping, connect: vi.fn() })(httpConfig)).errorCode).toBe(
      'redirect_limit',
    );
    expect(looping).toHaveBeenCalledTimes(4);
    const unsafe = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }),
      );
    expect((await createProbe({ fetch: unsafe, connect: vi.fn() })(wafConfig, bypassOptions)).errorCode).toBe(
      'blocked_target',
    );
    expect(unsafe).toHaveBeenCalledOnce();
  });
  it('aborts a request at its deadline', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = createProbe({ fetch: fetchMock, connect: vi.fn() })({ ...httpConfig, timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ ok: false, errorCode: 'timeout', latencyMs: 1000 });
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it('sanitizes network exceptions containing target details and WAF credentials', async () => {
    const result = await createProbe({
      fetch: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error(`secret.example.com internal secret ${bypassOptions.wafBypass.token}`)),
      connect: vi.fn(),
    })(wafConfig, bypassOptions);
    expect(result.errorCode).toBe('network');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain(bypassOptions.wafBypass.token);
  });
});
describe('WAF bypass requests', () => {
  it.each([
    ['https://example.com/health', true, true],
    ['https://example.com/health', false, false],
    ['http://example.com/health', true, false],
    ['https://other.test/health', true, true],
    ['https://child.example.com/health', true, true],
    ['https://example.com.evil.test/health', true, true],
    ['https://1.1.1.1/health', true, false],
    ['https://EXAMPLE.COM./health', true, true],
    ['https://例子.测试/health', true, true],
  ])('scopes the token for %s with enabled=%s', async (url, enabled, expected) => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null));
    const probe = createProbe({ fetch: fetchMock, connect: vi.fn() });
    expect(
      (await probe({ ...wafConfig, url }, { wafBypass: { ...bypassOptions.wafBypass, enabled } })).ok,
    ).toBe(true);
    const init = fetchMock.mock.calls[0][1]!;
    const headers = new Headers(init.headers);
    expect(headers.get(WAF_BYPASS_HEADER)).toBe(expected ? bypassOptions.wafBypass.token : null);
    expect(headers.get('User-Agent')).toBe('UptimeWorker/1.0');
    expect(init.redirect).toBe('manual');
  });

  it.each([
    { config: httpConfig, options: bypassOptions },
    { config: wafConfig, options: { wafBypass: { enabled: true, token: null } } },
    { config: wafConfig, options: { wafBypass: { enabled: true, token: '' } } },
    { config: wafConfig, options: undefined },
  ])(
    'does not send credentials without the monitor switch or a configured token: %#',
    async ({ config, options }) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
      expect((await createProbe({ fetch: fetchMock, connect: vi.fn() })(config, options)).ok).toBe(true);
      expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has(WAF_BYPASS_HEADER)).toBe(false);
    },
  );

  it.each([
    ['https://example.com/', 'https://child.example.com/', false],
    ['https://example.com/', 'https://example.com.evil.test/', false],
    ['https://child.example.com/', 'https://example.com/', false],
    ['https://example.com/', 'https://EXAMPLE.COM.:8443/path', true],
    ['https://EXAMPLE.COM./', 'https://example.com/path', true],
    ['https://例子.测试/', 'https://xn--fsqu00a.xn--0zwm56d:8443/path', true],
    ['https://xn--fsqu00a.xn--0zwm56d/', 'https://例子.测试/path', true],
  ])('checks the monitor domain on redirect from %s to %s', async (url, target, expected) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: encodeURI(target) } }))
      .mockResolvedValueOnce(new Response(null));
    const result = await createProbe({ fetch: fetchMock, connect: vi.fn() })(
      { ...wafConfig, url },
      bypassOptions,
    );
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get(WAF_BYPASS_HEADER))).toEqual(
      [bypassOptions.wafBypass.token, expected ? bypassOptions.wafBypass.token : null],
    );
  });

  it('rebuilds headers at each cross-domain and HTTPS downgrade redirect', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://other.test/path' } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://example.com/path' } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://example.com/path' } }),
      )
      .mockResolvedValueOnce(new Response(null));
    const result = await createProbe({ fetch: fetchMock, connect: vi.fn() })(wafConfig, bypassOptions);
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get(WAF_BYPASS_HEADER))).toEqual(
      [bypassOptions.wafBypass.token, null, bypassOptions.wafBypass.token, null],
    );
  });

  it('adds the token only after an HTTP upgrade, then retains it on a relative redirect', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: 'https://example.com/health' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/ready' } }))
      .mockResolvedValueOnce(new Response(null));
    expect(
      (
        await createProbe({ fetch: fetchMock, connect: vi.fn() })(
          {
            ...wafConfig,
            url: 'http://example.com/health',
          },
          bypassOptions,
        )
      ).ok,
    ).toBe(true);
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get(WAF_BYPASS_HEADER))).toEqual(
      [null, bypassOptions.wafBypass.token, bypassOptions.wafBypass.token],
    );
  });

  it.each([200, 302, 403, 503])(
    'rejects a challenge with HTTP %s even inside the expected status range',
    async (status) => {
      const cancel = vi.fn();
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new ReadableStream({ cancel }), {
          status,
          headers: { 'cf-mitigated': 'challenge', location: '/challenge' },
        }),
      );
      const result = await createProbe({ fetch: fetchMock, connect: vi.fn() })(
        {
          ...wafConfig,
          expectedStatusMin: 100,
          expectedStatusMax: 599,
        },
        bypassOptions,
      );
      expect(result).toMatchObject({ ok: false, httpStatus: status, errorCode: 'cloudflare_challenge' });
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain(bypassOptions.wafBypass.token);
    },
  );
});
describe('TCP probes', () => {
  function socket(opened: Promise<unknown>): TcpSocket {
    return { opened, closed: Promise.resolve(), close: vi.fn(async () => {}) };
  }
  it('measures the handshake and closes the socket without applying HTTP or WAF options', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const s = socket(Promise.resolve());
    const connect = vi.fn(() => s);
    expect(await createProbe({ fetch: fetchMock, connect })(tcpConfig, bypassOptions)).toMatchObject({
      ok: true,
      httpStatus: null,
    });
    expect(connect).toHaveBeenCalledWith({ hostname: 'db.example.com', port: 5432 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(s.close).toHaveBeenCalledOnce();
  });
  it('handles connection refusal and still closes the socket', async () => {
    const s = socket(Promise.reject(new Error('connection refused')));
    expect((await createProbe({ fetch, connect: () => s })(tcpConfig)).errorCode).toBe('network');
    expect(s.close).toHaveBeenCalled();
  });
  it('times out pending handshakes and releases the socket', async () => {
    vi.useFakeTimers();
    const s = socket(new Promise(() => {}));
    const pending = createProbe({ fetch, connect: () => s })({ ...tcpConfig, timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).errorCode).toBe('timeout');
    expect(s.close).toHaveBeenCalled();
  });
  it('distinguishes platform restrictions and tolerates a failed close', async () => {
    const s = socket(
      Promise.reject(new Error('proxy request failed, cannot connect to the specified address')),
    );
    s.close = vi.fn().mockRejectedValue(new Error('already closed'));
    expect((await createProbe({ fetch, connect: () => s })(tcpConfig)).errorCode).toBe('blocked_target');
  });
});
