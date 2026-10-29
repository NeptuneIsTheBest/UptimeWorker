import { ValidationError } from './errors';

export function parseVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new ValidationError('请携带有效的版本号');
  return value;
}
export function parseText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new ValidationError(`${label}需为 1–${max} 个字符`);
  return value.trim();
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('请求内容必须是对象');
  return value as Record<string, unknown>;
}
