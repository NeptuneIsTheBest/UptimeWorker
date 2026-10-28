import { INTERVALS, type MonitorConfig } from './types';

export class ValidationError extends Error {}

export function isPublicHostname(input: string): boolean {
  const hostname = input
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || /\.(localhost|local|internal|lan)$/.test(hostname))
    return false;
  if (hostname.includes(':')) {
    // Permit only global-unicast IPv6; reject IPv4-mapped, loopback, ULA, and link-local addresses.
    return /^[23][0-9a-f]{3}:/.test(hostname) && !hostname.startsWith('2001:db8:');
  }
  if (/^[\d.]+$/.test(hostname)) {
    const octets = hostname.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
      return false;
    const [a, b] = octets;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    hostname.length <= 253 &&
    hostname.includes('.') &&
    hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  );
}

export function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('请输入完整的 HTTP 或 HTTPS 地址');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !isPublicHostname(url.hostname)
  ) {
    throw new ValidationError('仅支持公网 HTTP/HTTPS 地址，不能包含用户名或密码');
  }
  url.hash = '';
  return url;
}

export function parseMonitorConfig(value: unknown): MonitorConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('监控配置必须是对象');
  const v = value as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name || name.length > 80) throw new ValidationError('名称需为 1–80 个字符');
  if (!INTERVALS.includes(v.intervalMinutes as (typeof INTERVALS)[number]))
    throw new ValidationError('检测间隔必须为 5、10、15、30 或 60 分钟');
  if (!Number.isInteger(v.timeoutSeconds) || Number(v.timeoutSeconds) < 1 || Number(v.timeoutSeconds) > 30)
    throw new ValidationError('超时需为 1–30 秒的整数');
  if (typeof v.enabled !== 'boolean') throw new ValidationError('启用状态无效');
  const common = {
    name,
    intervalMinutes: Number(v.intervalMinutes),
    timeoutSeconds: Number(v.timeoutSeconds),
    enabled: v.enabled,
  };
  if (v.type === 'http') {
    if (typeof v.url !== 'string' || v.url.length > 2048) throw new ValidationError('URL 无效或过长');
    const url = parseHttpUrl(v.url).toString();
    if (v.method !== 'GET' && v.method !== 'HEAD') throw new ValidationError('仅支持 GET 和 HEAD');
    if (
      !Number.isInteger(v.expectedStatusMin) ||
      !Number.isInteger(v.expectedStatusMax) ||
      Number(v.expectedStatusMin) < 100 ||
      Number(v.expectedStatusMax) > 599 ||
      Number(v.expectedStatusMin) > Number(v.expectedStatusMax)
    )
      throw new ValidationError('期望状态码范围无效');
    return {
      ...common,
      type: 'http',
      url,
      method: v.method,
      expectedStatusMin: Number(v.expectedStatusMin),
      expectedStatusMax: Number(v.expectedStatusMax),
    };
  }
  if (v.type === 'tcp') {
    if (typeof v.hostname !== 'string' || /[\s/@?#]/.test(v.hostname))
      throw new ValidationError('请输入公网域名或 IP，不包含协议和路径');
    const raw = v.hostname;
    if (raw.includes(':') && !raw.startsWith('[') && raw.split(':').length === 2)
      throw new ValidationError('端口请单独填写');
    const address = raw.includes(':') && !raw.startsWith('[') ? `[${raw}]` : raw;
    if (address.startsWith('[') && !address.endsWith(']')) throw new ValidationError('端口请单独填写');
    let hostname: string;
    try {
      hostname = new URL(`http://${address}/`).hostname;
    } catch {
      throw new ValidationError('主机地址无效');
    }
    if (!isPublicHostname(hostname) || new URL(`http://${address}/`).port)
      throw new ValidationError('请输入公网主机地址，端口请单独填写');
    if (!Number.isInteger(v.port) || Number(v.port) < 1 || Number(v.port) > 65535 || Number(v.port) === 25)
      throw new ValidationError('端口需为 1–65535，Cloudflare 不支持 TCP 端口 25');
    return { ...common, type: 'tcp', hostname: hostname.replace(/^\[|\]$/g, ''), port: Number(v.port) };
  }
  throw new ValidationError('检测类型必须为 HTTP 或 TCP');
}
