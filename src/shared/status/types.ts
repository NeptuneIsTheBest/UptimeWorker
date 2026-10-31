import type { PageRefreshSettings } from '../settings/types';
import type { ProbeResult, PublicMonitor } from '../monitors/types';
import type { MonitorGroup, UngroupedOrder } from '../groups/types';
import type { StatusEvent } from '../events/types';

export interface StatusResponse extends PageRefreshSettings {
  siteName: string;
  generatedAt: number;
  monitors: PublicMonitor[];
  groups: Omit<MonitorGroup, 'version'>[];
  ungrouped: Omit<UngroupedOrder, 'version'>;
  events: StatusEvent[];
}

export interface HistoryResponse extends PageRefreshSettings {
  monitor: PublicMonitor;
  checks: ProbeResult[];
  generatedAt: number;
  events: StatusEvent[];
}
