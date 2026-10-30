import { type DisplayMessage } from '../../i18n/core';
import type { MonitorGroup, UngroupedOrder } from '../../../shared/groups/types';
import type { AdminMonitor } from '../../../shared/monitors/types';
import type { PageRefreshSettings } from '../../../shared/settings/types';

export interface AdminResponse extends PageRefreshSettings {
  monitors: AdminMonitor[];
  identity: { email: string };
  groups?: MonitorGroup[];
  ungrouped?: UngroupedOrder;
}

export type MonitorEditorState = AdminMonitor | 'new' | null;
export interface MonitorNotice {
  text: DisplayMessage;
  error: boolean;
}
