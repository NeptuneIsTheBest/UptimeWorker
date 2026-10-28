import {
  DEFAULT_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  HTTP_METHODS,
  MAX_REQUEST_BODY_BYTES,
  MAX_REQUEST_HEADER_BYTES,
  MAX_KEYWORDS,
  MAX_KEYWORD_LENGTH,
  WAF_BYPASS_HEADER,
  type HttpMethod,
  type MonitorConfig,
  type RequestBody,
  type ResponseCheck,
} from './types';

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

export function wafMonitorDomain(value: string): string | null {
  try {
    const hostname = parseHttpUrl(value).hostname.toLowerCase().replace(/\.$/, '');
    return hostname.includes(':') || /^[\d.]+$/.test(hostname) || hostname.endsWith('.') ? null : hostname;
  } catch {
    return null;
  }
}

const reservedHeaders = new Set([
  WAF_BYPASS_HEADER.toLowerCase(),
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
export function parseRequestHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('请求头必须是名称和值组成的对象');
  const entries: [string, string][] = [];
  const names = new Set<string>();
  let size = 0;
  for (const [name, content] of Object.entries(value)) {
    const key = name.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      typeof content !== 'string' ||
      /[^\t\x20-\x7e\x80-\xff]/.test(content)
    )
      throw new ValidationError('请求头名称或值无效，不能包含换行或不支持的字符');
    if (reservedHeaders.has(key))
      throw new ValidationError('不能覆盖 WAF 凭据、Host、Content-Length 或逐跳传输头');
    if (names.has(key)) throw new ValidationError('请求头名称不能重复（不区分大小写）');
    names.add(key);
    size += new TextEncoder().encode(`${name}: ${content}\r\n`).byteLength;
    entries.push([key, content.trim()]);
  }
  if (size > MAX_REQUEST_HEADER_BYTES) throw new ValidationError('请求头合计不能超过 8 KiB');
  return Object.fromEntries(entries);
}

function parseRequestBody(value: unknown, method: HttpMethod): RequestBody | null {
  if (value === undefined || value === null) return null;
  if (method === 'GET' || method === 'HEAD') throw new ValidationError('GET 和 HEAD 不支持请求体');
  if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('请求体格式无效');
  const body = value as Record<string, unknown>;
  if ((body.format !== 'text' && body.format !== 'json') || typeof body.content !== 'string')
    throw new ValidationError('请求体需选择文本或 JSON 格式并填写内容');
  if (new TextEncoder().encode(body.content).byteLength > MAX_REQUEST_BODY_BYTES)
    throw new ValidationError('请求体不能超过 16 KiB');
  if (body.format === 'json') {
    try {
      JSON.parse(body.content);
    } catch {
      throw new ValidationError('请求体不是有效的 JSON');
    }
  }
  return { format: body.format, content: body.content };
}

function parseKeywords(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((word) => typeof word !== 'string'))
    throw new ValidationError('关键词必须是字符串列表');
  if (value.length > MAX_KEYWORDS) throw new ValidationError('每组最多填写 20 个关键词');
  const words = value.map((word: string) => word.trim()).filter(Boolean);
  if (words.some((word) => word.length > MAX_KEYWORD_LENGTH || /[\r\n]/.test(word)))
    throw new ValidationError('每个关键词最多 256 个字符，且不能包含换行');
  return [...new Set(words)];
}

function parseResponseCheck(value: unknown, method: HttpMethod): ResponseCheck | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('响应校验配置无效');
  const check = value as Record<string, unknown>;
  if (typeof check.ignoreCase !== 'boolean') throw new ValidationError('忽略大小写选项无效');
  const includes = parseKeywords(check.includes);
  const excludes = parseKeywords(check.excludes);
  if (!includes.length && !excludes.length) return null;
  if (method === 'HEAD') throw new ValidationError('HEAD 不支持响应内容校验，请选择其他请求方法');
  return { includes, excludes, ignoreCase: check.ignoreCase };
}

export function parseMonitorConfig(value: unknown): MonitorConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('监控配置必须是对象');
  const v = value as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name || name.length > 80) throw new ValidationError('名称需为 1–80 个字符');
  const intervalMinutes = v.intervalMinutes === undefined ? DEFAULT_INTERVAL_MINUTES : v.intervalMinutes;
  if (
    typeof intervalMinutes !== 'number' ||
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < MIN_INTERVAL_MINUTES ||
    intervalMinutes > MAX_INTERVAL_MINUTES
  )
    throw new ValidationError(`检测间隔需为 ${MIN_INTERVAL_MINUTES}–${MAX_INTERVAL_MINUTES} 分钟的整数`);
  if (!Number.isInteger(v.timeoutSeconds) || Number(v.timeoutSeconds) < 1 || Number(v.timeoutSeconds) > 30)
    throw new ValidationError('超时需为 1–30 秒的整数');
  if (typeof v.enabled !== 'boolean') throw new ValidationError('启用状态无效');
  const common = {
    name,
    intervalMinutes,
    timeoutSeconds: Number(v.timeoutSeconds),
    enabled: v.enabled,
  };
  if (v.type === 'http') {
    if (typeof v.url !== 'string' || v.url.length > 2048) throw new ValidationError('URL 无效或过长');
    const url = parseHttpUrl(v.url).toString();
    const method = v.method === undefined ? 'GET' : (v.method as HttpMethod);
    if (!HTTP_METHODS.includes(method)) throw new ValidationError('请求方法无效');
    const wafBypassEnabled = v.wafBypassEnabled === undefined ? false : v.wafBypassEnabled;
    if (typeof wafBypassEnabled !== 'boolean') throw new ValidationError('WAF 放行开关无效');
    if (wafBypassEnabled && !wafMonitorDomain(url))
      throw new ValidationError('WAF 放行仅支持公网域名，不支持 IP 地址');
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
      method,
      wafBypassEnabled,
      requestHeaders: parseRequestHeaders(v.requestHeaders),
      requestBody: parseRequestBody(v.requestBody, method),
      responseCheck: parseResponseCheck(v.responseCheck, method),
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
