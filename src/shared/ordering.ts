import { ValidationError } from './errors';
import { object } from './validation';

export interface OrderItem {
  id: string;
  expectedVersion: number;
  expectedSortOrder: number;
}

export function parseOrderItems(value: unknown): OrderItem[] {
  if (!Array.isArray(value) || !value.length) throw new ValidationError('order_invalid');
  const ids = new Set<string>();
  return value.map((item) => {
    const { id, expectedVersion, expectedSortOrder } = object(item);
    if (
      typeof id !== 'string' ||
      !id ||
      id.length > 100 ||
      ids.has(id) ||
      typeof expectedVersion !== 'number' ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      typeof expectedSortOrder !== 'number' ||
      !Number.isSafeInteger(expectedSortOrder) ||
      expectedSortOrder < 0
    )
      throw new ValidationError('order_invalid');
    ids.add(id);
    return { id, expectedVersion, expectedSortOrder };
  });
}

export function parseOrderGroup(value: unknown): string | null {
  if (value === null || (typeof value === 'string' && value.length > 0 && value.length <= 100)) return value;
  throw new ValidationError('group_invalid');
}

export function orderItems(items: { id: string; version: number; sortOrder: number }[]): OrderItem[] {
  return items.map(({ id, version, sortOrder }) => ({
    id,
    expectedVersion: version,
    expectedSortOrder: sortOrder,
  }));
}
