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
}
export interface StoredSettings {
  version: number;
  pageRefreshSeconds: number;
  autoIncidentAfterMinutes: number;
  wafBypass: WafBypassSettings;
}
