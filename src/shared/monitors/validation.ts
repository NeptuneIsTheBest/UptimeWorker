import {
  DEFAULT_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  HTTP_METHODS,
  MAX_REQUEST_BODY_BYTES,
  MAX_REQUEST_HEADER_BYTES,
  MAX_KEYWORDS,
  MAX_KEYWORD_LENGTH,
} from './constants';
import { WAF_BYPASS_HEADER } from '../settings/constants';
import type { HttpMethod, MonitorConfig, RequestBody, ResponseCheck } from './types';
import { ValidationError } from '../errors';

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
    throw new ValidationError('http_url_invalid');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !isPublicHostname(url.hostname)
  ) {
    throw new ValidationError('http_url_not_public');
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
    throw new ValidationError('headers_object_required');
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
      throw new ValidationError('header_invalid');
    if (reservedHeaders.has(key)) throw new ValidationError('header_reserved');
    if (names.has(key)) throw new ValidationError('header_duplicate');
    names.add(key);
    size += new TextEncoder().encode(`${name}: ${content}\r\n`).byteLength;
    entries.push([key, content.trim()]);
  }
  if (size > MAX_REQUEST_HEADER_BYTES) throw new ValidationError('headers_too_large');
  return Object.fromEntries(entries);
}

function parseRequestBody(value: unknown, method: HttpMethod): RequestBody | null {
  if (value === undefined || value === null) return null;
  if (method === 'GET' || method === 'HEAD') throw new ValidationError('body_method_unsupported');
  if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('body_invalid');
  const body = value as Record<string, unknown>;
  if ((body.format !== 'text' && body.format !== 'json') || typeof body.content !== 'string')
    throw new ValidationError('body_content_required');
  if (new TextEncoder().encode(body.content).byteLength > MAX_REQUEST_BODY_BYTES)
    throw new ValidationError('body_too_large');
  if (body.format === 'json') {
    try {
      JSON.parse(body.content);
    } catch {
      throw new ValidationError('body_json_invalid');
    }
  }
  return { format: body.format, content: body.content };
}

function parseKeywords(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((word) => typeof word !== 'string'))
    throw new ValidationError('keywords_invalid');
  if (value.length > MAX_KEYWORDS) throw new ValidationError('keywords_too_many');
  const words = value.map((word: string) => word.trim()).filter(Boolean);
  if (words.some((word) => word.length > MAX_KEYWORD_LENGTH || /[\r\n]/.test(word)))
    throw new ValidationError('keyword_invalid');
  return [...new Set(words)];
}

function parseResponseCheck(value: unknown, method: HttpMethod): ResponseCheck | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('response_check_invalid');
  const check = value as Record<string, unknown>;
  if (typeof check.ignoreCase !== 'boolean') throw new ValidationError('ignore_case_invalid');
  const includes = parseKeywords(check.includes);
  const excludes = parseKeywords(check.excludes);
  if (!includes.length && !excludes.length) return null;
  if (method === 'HEAD') throw new ValidationError('head_response_check_unsupported');
  return { includes, excludes, ignoreCase: check.ignoreCase };
}

export function parseMonitorConfig(value: unknown): MonitorConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('monitor_object_required');
  const v = value as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name || name.length > 80) throw new ValidationError('monitor_name_invalid');
  const groupId = v.groupId ?? null;
  if (groupId !== null && (typeof groupId !== 'string' || !groupId || groupId.length > 100))
    throw new ValidationError('group_invalid');
  const intervalMinutes = v.intervalMinutes === undefined ? DEFAULT_INTERVAL_MINUTES : v.intervalMinutes;
  if (
    typeof intervalMinutes !== 'number' ||
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < MIN_INTERVAL_MINUTES ||
    intervalMinutes > MAX_INTERVAL_MINUTES
  )
    throw new ValidationError('monitor_interval_invalid', {
      min: MIN_INTERVAL_MINUTES,
      max: MAX_INTERVAL_MINUTES,
    });
  if (!Number.isInteger(v.timeoutSeconds) || Number(v.timeoutSeconds) < 1 || Number(v.timeoutSeconds) > 30)
    throw new ValidationError('timeout_invalid');
  if (typeof v.enabled !== 'boolean') throw new ValidationError('enabled_invalid');
  const common = {
    name,
    groupId,
    intervalMinutes,
    timeoutSeconds: Number(v.timeoutSeconds),
    enabled: v.enabled,
  };
  if (v.type === 'http') {
    if (typeof v.url !== 'string' || v.url.length > 2048) throw new ValidationError('url_too_long');
    const url = parseHttpUrl(v.url).toString();
    const method = v.method === undefined ? 'GET' : (v.method as HttpMethod);
    if (!HTTP_METHODS.includes(method)) throw new ValidationError('http_method_invalid');
    const wafBypassEnabled = v.wafBypassEnabled === undefined ? false : v.wafBypassEnabled;
    if (typeof wafBypassEnabled !== 'boolean') throw new ValidationError('waf_enabled_invalid');
    if (wafBypassEnabled && !wafMonitorDomain(url)) throw new ValidationError('waf_domain_required');
    if (
      !Number.isInteger(v.expectedStatusMin) ||
      !Number.isInteger(v.expectedStatusMax) ||
      Number(v.expectedStatusMin) < 100 ||
      Number(v.expectedStatusMax) > 599 ||
      Number(v.expectedStatusMin) > Number(v.expectedStatusMax)
    )
      throw new ValidationError('status_range_invalid');
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
      throw new ValidationError('hostname_required');
    const raw = v.hostname;
    if (raw.includes(':') && !raw.startsWith('[') && raw.split(':').length === 2)
      throw new ValidationError('port_separate');
    const address = raw.includes(':') && !raw.startsWith('[') ? `[${raw}]` : raw;
    if (address.startsWith('[') && !address.endsWith(']')) throw new ValidationError('port_separate');
    let hostname: string;
    try {
      hostname = new URL(`http://${address}/`).hostname;
    } catch {
      throw new ValidationError('hostname_invalid');
    }
    if (!isPublicHostname(hostname) || new URL(`http://${address}/`).port)
      throw new ValidationError('hostname_not_public');
    if (!Number.isInteger(v.port) || Number(v.port) < 1 || Number(v.port) > 65535 || Number(v.port) === 25)
      throw new ValidationError('port_invalid');
    return { ...common, type: 'tcp', hostname: hostname.replace(/^\[|\]$/g, ''), port: Number(v.port) };
  }
  throw new ValidationError('monitor_type_invalid');
}
