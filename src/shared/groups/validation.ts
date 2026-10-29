import { ValidationError } from '../errors';
import { object, parseText } from '../validation';

export function parseGroup(value: unknown) {
  const v = object(value);
  const name = parseText(v.name, 'group_name', 80);
  const sortOrder = v.sortOrder;
  if (
    sortOrder !== undefined &&
    (typeof sortOrder !== 'number' ||
      !Number.isSafeInteger(sortOrder) ||
      sortOrder < 0 ||
      sortOrder > 1_000_000)
  )
    throw new ValidationError('group_order_invalid');
  return { name, sortOrder };
}
