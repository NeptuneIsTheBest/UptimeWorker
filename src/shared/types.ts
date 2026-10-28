export const INTERVALS = [5, 10, 15, 30, 60] as const;
export const MAX_MONITORS = 10;
export type MonitorStatus = 'up' | 'down' | 'unknown' | 'paused' | 'stale';
export type ErrorCode = 'timeout' | 'network' | 'unexpected_status' | 'redirect_limit' | 'blocked_target';

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
        method: 'GET' | 'HEAD';
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
};
