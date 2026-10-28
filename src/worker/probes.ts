import type { MonitorConfig, ProbeResult, ErrorCode } from '../shared/types';
import { parseHttpUrl, ValidationError } from '../shared/validation';

export interface TcpSocket {
  opened: Promise<unknown>;
  closed: Promise<unknown>;
  close(): Promise<void>;
}
export type TcpConnect = (address: { hostname: string; port: number }) => TcpSocket;
export interface ProbeDependencies {
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
  return async (config: MonitorConfig): Promise<ProbeResult> => {
    const now = deps.now ?? Date.now;
    const started = now();
    const controller = new AbortController();
    let socket: TcpSocket | undefined;
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
        for (let redirects = 0; ; redirects++) {
          const response = await deps.fetch(url.toString(), {
            method: config.method,
            redirect: 'manual',
            signal: controller.signal,
            headers: { 'User-Agent': 'UptimeWorker/1.0', 'Cache-Control': 'no-cache' },
            cf: { cacheTtl: 0, cacheEverything: false },
          });
          httpStatus = response.status;
          const location = response.headers.get('location');
          // Release the body before opening the next connection, including on errors.
          if (response.body) await response.body.cancel();
          if ([301, 302, 303, 307, 308].includes(response.status) && location) {
            if (redirects >= 3) throw new ProbeError('redirect_limit');
            url = parseHttpUrl(new URL(location, url).toString());
            continue;
          }
          if (response.status < config.expectedStatusMin || response.status > config.expectedStatusMax)
            throw new ProbeError('unexpected_status');
          return;
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
      await closeSocket();
    }
  };
}
