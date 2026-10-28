import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProbe, type TcpSocket } from '../src/worker/probes';
import { httpConfig, tcpConfig } from './helpers';

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
    expect((await createProbe({ fetch: unsafe, connect: vi.fn() })(httpConfig)).errorCode).toBe(
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
  it('sanitizes network exceptions', async () => {
    const result = await createProbe({
      fetch: vi.fn<typeof fetch>().mockRejectedValue(new Error('secret.example.com internal secret')),
      connect: vi.fn(),
    })(httpConfig);
    expect(result.errorCode).toBe('network');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
describe('TCP probes', () => {
  function socket(opened: Promise<unknown>): TcpSocket {
    return { opened, closed: Promise.resolve(), close: vi.fn(async () => {}) };
  }
  it('measures the handshake and closes the socket', async () => {
    const s = socket(Promise.resolve());
    const connect = vi.fn(() => s);
    expect(await createProbe({ fetch, connect })(tcpConfig)).toMatchObject({ ok: true, httpStatus: null });
    expect(connect).toHaveBeenCalledWith({ hostname: 'db.example.com', port: 5432 });
    expect(s.close).toHaveBeenCalled();
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
