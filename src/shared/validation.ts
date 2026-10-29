import { ValidationError } from './errors';
import type { TextField } from './error-messages';

export function parseVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new ValidationError('version_invalid');
  return value;
}
export function parseText(value: unknown, field: TextField, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new ValidationError('text_length', { field, max });
  return value.trim();
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('object_required');
  return value as Record<string, unknown>;
}
