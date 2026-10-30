import { UNGROUPED_ID } from './types';

// The API already orders ordinary groups, including ties. Insert the system
// entry after ordinary groups at the same position, matching the SQL ordering.
export function orderedGroups<T extends { sortOrder: number }>(groups: readonly T[], ungrouped: T): T[] {
  const index = groups.findIndex((group) => group.sortOrder > ungrouped.sortOrder);
  const result = [...groups];
  result.splice(index < 0 ? result.length : index, 0, ungrouped);
  return result;
}

export function monitorGroupKey(groupId: string | null | undefined, groups: readonly { id: string }[]) {
  return groups.some((group) => group.id === groupId) ? groupId! : UNGROUPED_ID;
}
