export const DEFAULT_INTERVAL_MINUTES = 1;
export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 60;
export const MAX_MONITORS = 10;
export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export const WAF_BYPASS_HEADER = 'X-UptimeWorker-WAF-Bypass';
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;
export const MAX_REQUEST_HEADER_BYTES = 8 * 1024;
export const MAX_RESPONSE_BODY_BYTES = 1024 * 1024;
export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD_LENGTH = 256;
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

export interface GlobalSettings {
  version: number;
  wafBypassEnabled: boolean;
  wafBypassTokenConfigured: boolean;
}
export interface GlobalSettingsPatch {
  version: number;
  wafBypassEnabled?: boolean;
  wafBypassToken?: string;
}

export interface CommonConfig {
  name: string;
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
  name: string;
  type: 'http' | 'tcp';
  status: MonitorStatus;
  intervalMinutes: number;
  lastCheckedAt: number | null;
  latencyMs: number | null;
  uptime30d: number | null;
  days: DailyStat[];
}
export interface StatusResponse {
  siteName: string;
  generatedAt: number;
  monitors: PublicMonitor[];
}
export type AdminMonitor = MonitorConfig & {
  id: string;
  version: number;
  status: MonitorStatus;
  lastCheckedAt: number | null;
  latencyMs: number | null;
  errorCode: ErrorCode | null;
};
export interface HistoryResponse {
  monitor: PublicMonitor;
  checks: ProbeResult[];
  generatedAt: number;
}
export const STATUS_LABELS: Record<MonitorStatus, string> = {
  up: '运行正常',
  down: '服务异常',
  unknown: '等待检测',
  paused: '已暂停',
  stale: '数据过期',
};
export const ERROR_LABELS: Record<ErrorCode, string> = {
  timeout: '检测超时',
  network: '连接失败',
  unexpected_status: 'HTTP 状态码不符合预期',
  redirect_limit: '重定向超过 3 次',
  blocked_target: '此目标受到网络或 Cloudflare TCP 限制',
  cloudflare_challenge: '请求被 Cloudflare 验证拦截，请检查目标站点的 WAF Skip 规则',
  content_mismatch: '响应内容不符合关键词要求',
  response_too_large: '响应内容超过 1 MiB，无法完成关键词校验',
  unsafe_redirect: '跨源重定向不能转发请求体，请直接配置最终检测地址',
};
