import { ValidationError } from '../errors';
import { object, parseText } from '../validation';

export function parseGroup(value: unknown) {
  const v = object(value);
  const name = parseText(v.name, '分组名称', 80);
  const sortOrder = v.sortOrder ?? 0;
  if (
    typeof sortOrder !== 'number' ||
    !Number.isSafeInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > 1_000_000
  )
    throw new ValidationError('排序需为 0–1000000 的整数');
  return { name, sortOrder };
}
