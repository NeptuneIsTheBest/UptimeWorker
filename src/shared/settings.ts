import type { GlobalSettings } from './types';
import { isPublicHostname, ValidationError } from './validation';

export const WAF_BYPASS_HEADER = 'X-UptimeWorker-WAF-Bypass';

export function normalizeWafDomain(value: string): string {
  const input = value.trim();
  const invalid = () => new ValidationError('生效域名必须是完整的公网域名，不含协议、端口、路径或通配符');
  if (!input || /[\s/\\:@?#*%\[\]]/.test(input)) throw invalid();
  let hostname: string;
  try {
    hostname = new URL(`https://${input}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    throw invalid();
  }
  if (hostname.endsWith('.') || !isPublicHostname(hostname) || /^[\d.]+$/.test(hostname)) throw invalid();
  return hostname;
}

export function parseWafDomains(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    throw new ValidationError('生效域名必须是字符串列表');
  return [...new Set(value.map(normalizeWafDomain))];
}

export function isWafToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

export function parseGlobalSettingsPatch(value: unknown, current: GlobalSettings) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('全局设置必须是对象');
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.version) || Number(v.version) < 1)
    throw new ValidationError('请携带有效的设置版本号');
  const enabled = v.wafBypassEnabled === undefined ? current.wafBypassEnabled : v.wafBypassEnabled;
  if (typeof enabled !== 'boolean') throw new ValidationError('WAF 放行开关无效');
  const domains = parseWafDomains(
    v.wafBypassDomains === undefined ? current.wafBypassDomains : v.wafBypassDomains,
  );
  let token: string | undefined;
  if (v.wafBypassToken !== undefined && v.wafBypassToken !== '') {
    if (typeof v.wafBypassToken !== 'string' || !isWafToken(v.wafBypassToken))
      throw new ValidationError('放行密钥需为 32–256 位字母、数字、下划线或连字符，建议使用随机生成');
    token = v.wafBypassToken;
  }
  if (enabled && !(token || current.wafBypassTokenConfigured))
    throw new ValidationError('启用 WAF 放行前请先配置密钥');
  if (enabled && !domains.length) throw new ValidationError('启用 WAF 放行前请至少填写一个生效域名');
  return {
    version: Number(v.version),
    wafBypassEnabled: enabled,
    wafBypassDomains: domains,
    ...(token ? { wafBypassToken: token } : {}),
  };
}

export function wafSkipExpression(domains: string[], token = '<YOUR_TOKEN>'): string {
  return [
    `(http.host in {${domains.map((domain) => JSON.stringify(domain)).join(' ')}})`,
    '(http.request.method in {"GET" "HEAD"})',
    `(any(http.request.headers["${WAF_BYPASS_HEADER.toLowerCase()}"][*] eq ${JSON.stringify(token)}))`,
  ].join(' and\n');
}
