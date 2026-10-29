import { HTTP_METHODS } from './constants';

export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface RequestBody {
  format: 'text' | 'json';
  content: string;
}

export interface ResponseCheck {
  includes: string[];
  excludes: string[];
  ignoreCase: boolean;
}

export type MonitorStatus = 'up' | 'down' | 'unknown' | 'paused' | 'stale';

export type ErrorCode =
  | 'timeout'
  | 'network'
  | 'unexpected_status'
  | 'redirect_limit'
  | 'blocked_target'
  | 'cloudflare_challenge'
  | 'content_mismatch'
  | 'response_too_large'
  | 'unsafe_redirect';

interface CommonConfig {
  name: string;
  groupId?: string | null;
  intervalMinutes: number;
  timeoutSeconds: number;
  enabled: boolean;
}

export type MonitorConfig = CommonConfig &
  (
    | {
        type: 'http';
        url: string;
        method: HttpMethod;
        wafBypassEnabled: boolean;
        requestHeaders: Record<string, string>;
        requestBody: RequestBody | null;
        responseCheck: ResponseCheck | null;
        expectedStatusMin: number;
        expectedStatusMax: number;
      }
    | { type: 'tcp'; hostname: string; port: number }
  );

export interface ProbeResult {
  checkedAt: number;
  ok: boolean;
  latencyMs: number;
  httpStatus: number | null;
  errorCode: ErrorCode | null;
}

export interface DailyStat {
  day: string;
  total: number;
  successful: number;
  uptime: number | null;
}

export interface PublicMonitor {
  id: string;
  groupId?: string | null;
  name: string;
  type: 'http' | 'tcp';
  status: MonitorStatus;
  intervalMinutes: number;
  lastCheckedAt: number | null;
  latencyMs: number | null;
  uptime30d: number | null;
  days: DailyStat[];
}

export type AdminMonitor = MonitorConfig & {
  id: string;
  sortOrder: number;
  version: number;
  status: MonitorStatus;
  lastCheckedAt: number | null;
  latencyMs: number | null;
  errorCode: ErrorCode | null;
};
