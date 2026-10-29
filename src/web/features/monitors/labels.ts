import type { MonitorStatus, ErrorCode } from '../../../shared/monitors/types';

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
