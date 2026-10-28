import {
  HTTP_METHODS,
  MIN_PAGE_REFRESH_SECONDS,
  MAX_PAGE_REFRESH_SECONDS,
  WAF_BYPASS_HEADER,
  type GlobalSettings,
  type MonitorConfig,
} from './types';
import { ValidationError, wafMonitorDomain } from './validation';

export { WAF_BYPASS_HEADER } from './types';

// These domains are only used to generate the Cloudflare rule template.
export function wafRuleDomains(monitors: readonly MonitorConfig[]): string[] {
  return [
    ...new Set(
      monitors.flatMap((monitor) => {
        if (monitor.type !== 'http' || !monitor.wafBypassEnabled) return [];
        const domain = wafMonitorDomain(monitor.url);
        return domain ? [domain] : [];
      }),
    ),
  ].sort();
}

export function isWafToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

export function isPageRefreshSeconds(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (value === 0 || (value >= MIN_PAGE_REFRESH_SECONDS && value <= MAX_PAGE_REFRESH_SECONDS))
  );
}

export function parseGlobalSettingsPatch(value: unknown, current: GlobalSettings) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('全局设置必须是对象');
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.version) || Number(v.version) < 1)
    throw new ValidationError('请携带有效的设置版本号');
  const autoIncidentAfterMinutes =
    v.autoIncidentAfterMinutes === undefined
      ? (current.autoIncidentAfterMinutes ?? 5)
      : v.autoIncidentAfterMinutes;
  if (
    typeof autoIncidentAfterMinutes !== 'number' ||
    !Number.isInteger(autoIncidentAfterMinutes) ||
    autoIncidentAfterMinutes < 0 ||
    autoIncidentAfterMinutes > 1440
  )
    throw new ValidationError('自动事件阈值需为 1–1440 分钟的整数，或设为 0 关闭');
  const pageRefreshSeconds =
    v.pageRefreshSeconds === undefined ? current.pageRefreshSeconds : v.pageRefreshSeconds;
  if (!isPageRefreshSeconds(pageRefreshSeconds))
    throw new ValidationError('页面刷新间隔需为 5–3600 秒的整数，或设为 0 关闭自动刷新');
  const enabled = v.wafBypassEnabled === undefined ? current.wafBypassEnabled : v.wafBypassEnabled;
  if (typeof enabled !== 'boolean') throw new ValidationError('WAF 放行开关无效');
  let token: string | undefined;
  if (v.wafBypassToken !== undefined && v.wafBypassToken !== '') {
    if (typeof v.wafBypassToken !== 'string' || !isWafToken(v.wafBypassToken))
      throw new ValidationError('放行密钥需为 32–256 位字母、数字、下划线或连字符，建议使用随机生成');
    token = v.wafBypassToken;
  }
  if (enabled && !(token || current.wafBypassTokenConfigured))
    throw new ValidationError('启用 WAF 放行前请先配置密钥');
  return {
    version: Number(v.version),
    autoIncidentAfterMinutes,
    pageRefreshSeconds,
    wafBypassEnabled: enabled,
    ...(token ? { wafBypassToken: token } : {}),
  };
}

export function wafSkipExpression(domains: string[], token = '<YOUR_TOKEN>'): string {
  return [
    `(http.host in {${domains.map((domain) => JSON.stringify(domain)).join(' ')}})`,
    `(http.request.method in {${HTTP_METHODS.map((method) => JSON.stringify(method)).join(' ')}})`,
    `(any(http.request.headers["${WAF_BYPASS_HEADER.toLowerCase()}"][*] eq ${JSON.stringify(token)}))`,
  ].join(' and\n');
}
