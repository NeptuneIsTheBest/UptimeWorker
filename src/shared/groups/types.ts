export const UNGROUPED_ID = '__ungrouped__';

export interface MonitorGroup {
  id: string;
  name: string;
  sortOrder: number;
  version: number;
}

export interface UngroupedOrder {
  id: typeof UNGROUPED_ID;
  sortOrder: number;
  version: number;
}

export interface GroupListing {
  groups: MonitorGroup[];
  ungrouped: UngroupedOrder;
}
