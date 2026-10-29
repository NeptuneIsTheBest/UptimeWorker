import type { MonitorConfig, ProbeResult, ErrorCode } from '../../../shared/monitors/types';
import type { WafBypassSettings } from '../settings/types';

export interface MonitorRow {
  id: string;
  sort_order: number;
  group_id: string | null;
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
export interface ProbeOptions {
  wafBypass: WafBypassSettings;
}
export type Probe = (config: MonitorConfig, options?: ProbeOptions) => Promise<ProbeResult>;
