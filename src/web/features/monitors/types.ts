import type { MonitorGroup } from '../../../shared/groups/types';
import type { AdminMonitor } from '../../../shared/monitors/types';
import type { PageRefreshSettings } from '../../../shared/settings/types';

export interface AdminResponse extends PageRefreshSettings {
  monitors: AdminMonitor[];
  identity: { email: string };
  limit: number;
  groups?: MonitorGroup[];
}

export type MonitorEditorState = AdminMonitor | 'new' | null;
export interface MonitorNotice {
  text: string;
  error: boolean;
}
