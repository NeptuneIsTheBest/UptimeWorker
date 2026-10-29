import { MAX_HTTP_REDIRECTS, MAX_RESPONSE_BODY_BYTES } from '../../../shared/monitors/constants';
import type { MonitorConfig, ProbeResult, ErrorCode } from '../../../shared/monitors/types';
import { parseHttpUrl, wafMonitorDomain } from '../../../shared/monitors/validation';
import { ValidationError } from '../../../shared/errors';
import { WAF_BYPASS_HEADER } from '../../../shared/settings/constants';
import type { ProbeOptions } from './types';

export interface TcpSocket {
  opened: Promise<unknown>;
  closed: Promise<unknown>;
  close(): Promise<void>;
}
type TcpConnect = (address: { hostname: string; port: number }) => TcpSocket;
interface ProbeDependencies {
  fetch: typeof fetch;
  connect: TcpConnect;
  now?: () => number;
}

class ProbeError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

export function createProbe(deps: ProbeDependencies) {
  return async (config: MonitorConfig, options?: ProbeOptions): Promise<ProbeResult> => {
    const now = deps.now ?? Date.now;
    const started = now();
    const controller = new AbortController();
    let socket: TcpSocket | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancelReader = () => {
      void reader?.cancel().catch(() => {});
    };
    let closing: Promise<void> | undefined;
    const closeSocket = () => {
      if (socket && !closing)
        closing = Promise.resolve()
          .then(() => socket!.close())
          .catch(() => {});
      return closing;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let httpStatus: number | null = null;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ProbeError('timeout'));
        controller.abort();
        cancelReader();
        void closeSocket();
      }, config.timeoutSeconds * 1000);
    });
    const result = (ok: boolean, errorCode: ErrorCode | null): ProbeResult => ({
      checkedAt: started,
      ok,
      latencyMs: Math.max(0, Math.round(now() - started)),
      httpStatus,
      errorCode,
    });
    try {
      const operation = async () => {
        if (config.type === 'tcp') {
          socket = deps.connect({ hostname: config.hostname, port: config.port });
          void socket.closed.catch(() => {});
          await socket.opened;
          return;
        }
        let url = parseHttpUrl(config.url);
        const wafDomain = config.wafBypassEnabled ? wafMonitorDomain(config.url) : null;
        let method = config.method;
        let body = config.requestBody;
        let customHeaders = new Headers(config.requestHeaders);
        for (let redirects = 0; ; redirects++) {
          controller.signal.throwIfAborted();
          // Build fresh headers for every hop so redirects cannot forward the token outside its scope.
          const headers = new Headers({
            'User-Agent': 'UptimeWorker/1.0',
            'Cache-Control': 'no-cache',
          });
          customHeaders.forEach((value, name) => headers.set(name, value));
          if (body && !headers.has('Content-Type'))
            headers.set(
              'Content-Type',
              body.format === 'json' ? 'application/json' : 'text/plain;charset=UTF-8',
            );
          const bypass = options?.wafBypass;
          if (
            wafDomain &&
            bypass?.enabled &&
            bypass.token &&
            url.protocol === 'https:' &&
            wafDomain === wafMonitorDomain(url.toString())
          )
            headers.set(WAF_BYPASS_HEADER, bypass.token);
          const response = await deps.fetch(url.toString(), {
            method,
            body: body?.content,
            redirect: 'manual',
            signal: controller.signal,
            headers,
            cf: { cacheTtl: 0, cacheEverything: false },
          });
          try {
            controller.signal.throwIfAborted();
            httpStatus = response.status;
            if (response.headers.get('cf-mitigated') === 'challenge')
              throw new ProbeError('cloudflare_challenge');
            const location = response.headers.get('location');
            if ([301, 302, 303, 307, 308].includes(response.status) && location) {
              if (redirects >= MAX_HTTP_REDIRECTS) throw new ProbeError('redirect_limit');
              const target = parseHttpUrl(new URL(location, url).toString());
              if (
                ([301, 302].includes(response.status) && method === 'POST') ||
                (response.status === 303 && method !== 'GET' && method !== 'HEAD')
              ) {
                method = 'GET';
                body = null;
                for (const name of [
                  'Content-Encoding',
                  'Content-Language',
                  'Content-Location',
                  'Content-Type',
                ])
                  customHeaders.delete(name);
              }
              if (target.origin !== url.origin) {
                if (body) throw new ProbeError('unsafe_redirect');
                customHeaders = new Headers();
              }
              url = target;
              continue;
            }
            if (response.status < config.expectedStatusMin || response.status > config.expectedStatusMax)
              throw new ProbeError('unexpected_status');
            const check = config.responseCheck;
            if (check && (check.includes.length || check.excludes.length)) {
              let text = '';
              let bytes = 0;
              const decoder = new TextDecoder();
              reader = response.body?.getReader();
              try {
                while (reader) {
                  controller.signal.throwIfAborted();
                  const chunk = await reader.read();
                  controller.signal.throwIfAborted();
                  if (chunk.done) break;
                  bytes += chunk.value.byteLength;
                  if (bytes > MAX_RESPONSE_BODY_BYTES) throw new ProbeError('response_too_large');
                  text += decoder.decode(chunk.value, { stream: true });
                }
                text += decoder.decode();
              } finally {
                cancelReader();
                reader?.releaseLock();
                reader = undefined;
              }
              const normalize = (value: string) => (check.ignoreCase ? value.toLowerCase() : value);
              text = normalize(text);
              if (
                !check.includes.every((word) => text.includes(normalize(word))) ||
                check.excludes.some((word) => text.includes(normalize(word)))
              )
                throw new ProbeError('content_mismatch');
            }
            return;
          } finally {
            // Also release redirect, failed and uninspected response bodies.
            if (response.body && !response.body.locked) await response.body.cancel().catch(() => {});
          }
        }
      };
      await Promise.race([operation(), deadline]);
      return result(true, null);
    } catch (error) {
      const code =
        error instanceof ProbeError
          ? error.code
          : error instanceof ValidationError
            ? 'blocked_target'
            : /disallowed|prohibited|proxy request failed|TCP Loop/i.test(
                  error instanceof Error ? error.message : '',
                )
              ? 'blocked_target'
              : controller.signal.aborted
                ? 'timeout'
                : 'network';
      return result(false, code);
    } finally {
      clearTimeout(timer);
      controller.abort();
      cancelReader();
      await closeSocket();
    }
  };
}
