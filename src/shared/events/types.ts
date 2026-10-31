import type { PageRefreshSettings } from '../settings/types';

export interface EventConfig {
  title: string;
  body: string;
  type: 'incident' | 'maintenance';
  monitorIds: string[];
  startsAt: number | null;
  endsAt: number | null;
}

type EventStatus = 'open' | 'resolved' | 'stopped';

export type EventProgressTitle =
  | 'Scheduled'
  | 'Updated'
  | 'In Progress'
  | 'Completed'
  | 'Investigating'
  | 'Identified'
  | 'Monitoring'
  | 'Resolved';

export interface EventUpdateConfig {
  title: EventProgressTitle;
  body: string;
}

export interface EventUpdate {
  id: string;
  title: EventProgressTitle | 'Stopped';
  body: string;
  status: EventStatus | null;
  source: 'manual' | 'automatic';
  createdAt: number;
}

export interface StatusEvent extends Omit<EventConfig, 'monitorIds'> {
  id: string;
  source: 'manual' | 'automatic';
  status: EventStatus;
  monitors: { id: string | null; name: string }[];
  startedAt: number;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
  updates: EventUpdate[];
}

export interface AdminEvent extends StatusEvent {
  version: number;
}

export interface EventsResponse extends PageRefreshSettings {
  events: AdminEvent[];
  nextCursor: string | null;
}

export interface EventDetailResponse extends PageRefreshSettings {
  siteName: string;
  event: StatusEvent;
  generatedAt: number;
}
