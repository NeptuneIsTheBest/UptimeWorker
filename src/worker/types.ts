import type { MonitorConfig, ProbeResult, ErrorCode } from '../shared/types';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  SITE_NAME?: string;
  DEV_ACCESS_BYPASS?: string;
}
export interface MonitorRow {
  id: string;
  name: string;
  type: 'http' | 'tcp';
  config_json: string;
  interval_minutes: number;
  timeout_seconds: number;
  enabled: number;
  version: number;
  created_at: number;
  updated_at: number;
  next_check_at: number;
  last_checked_at: number | null;
  last_ok: number | null;
  last_latency_ms: number | null;
  last_error_code: ErrorCode | null;
}
export interface WafBypassSettings {
  enabled: boolean;
  token: string | null;
}
export interface ProbeOptions {
  wafBypass: WafBypassSettings;
}
export type Probe = (config: MonitorConfig, options?: ProbeOptions) => Promise<ProbeResult>;
export interface Identity {
  email: string;
}
export type AppEnv = { Bindings: Env; Variables: { identity: Identity } };
