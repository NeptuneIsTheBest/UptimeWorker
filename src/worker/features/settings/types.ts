import type { PerformanceSettings } from '../../../shared/settings/types';

export interface WafBypassSettings {
  enabled: boolean;
  token: string | null;
}
export interface SettingsRow {
  version: number;
  page_refresh_seconds: number;
  auto_incident_after_minutes: number;
  waf_bypass_enabled: number;
  waf_bypass_token: string | null;
  workers_plan: PerformanceSettings['workersPlan'];
  probe_concurrency: number;
  max_checks_per_run: number;
  time_budget_seconds: number;
}
export interface StoredSettings {
  version: number;
  performance: PerformanceSettings;
  pageRefreshSeconds: number;
  autoIncidentAfterMinutes: number;
  wafBypass: WafBypassSettings;
}
