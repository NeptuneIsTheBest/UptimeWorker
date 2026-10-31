import { object, parseText } from '../validation';

export function parseGroup(value: unknown) {
  const v = object(value);
  const name = parseText(v.name, 'group_name', 80);
  return { name };
}
