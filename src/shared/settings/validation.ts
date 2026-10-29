import { MIN_PAGE_REFRESH_SECONDS, MAX_PAGE_REFRESH_SECONDS } from './constants';
import type { GlobalSettings } from './types';
import { ValidationError } from '../errors';
import { parsePerformancePatch } from './performance';

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
    throw new ValidationError('settings_object_required');
  const v = value as Record<string, unknown>;
  if (!Number.isSafeInteger(v.version) || Number(v.version) < 1)
    throw new ValidationError('settings_version_invalid');
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
    throw new ValidationError('auto_incident_interval_invalid');
  const pageRefreshSeconds =
    v.pageRefreshSeconds === undefined ? current.pageRefreshSeconds : v.pageRefreshSeconds;
  if (!isPageRefreshSeconds(pageRefreshSeconds)) throw new ValidationError('refresh_interval_invalid');
  const enabled = v.wafBypassEnabled === undefined ? current.wafBypassEnabled : v.wafBypassEnabled;
  if (typeof enabled !== 'boolean') throw new ValidationError('waf_enabled_invalid');
  let token: string | undefined;
  if (v.wafBypassToken !== undefined && v.wafBypassToken !== '') {
    if (typeof v.wafBypassToken !== 'string' || !isWafToken(v.wafBypassToken))
      throw new ValidationError('waf_token_invalid');
    token = v.wafBypassToken;
  }
  if (enabled && !(token || current.wafBypassTokenConfigured))
    throw new ValidationError('waf_token_required');
  return {
    version: Number(v.version),
    performance: parsePerformancePatch(v.performance, current.performance),
    autoIncidentAfterMinutes,
    pageRefreshSeconds,
    wafBypassEnabled: enabled,
    ...(token ? { wafBypassToken: token } : {}),
  };
}
