import { isAppErrorCode } from '../../shared/error-messages';
import type { MessageParams } from '../../shared/locale';
import { message, NoticeError, type DisplayMessage } from '../i18n/core';

export class ApiError extends NoticeError {
  constructor(
    notice: DisplayMessage,
    readonly status: number,
  ) {
    super(notice);
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new ApiError(message('error.session'), 401);
  const data = (await response.json()) as T & { error?: string; code?: unknown; params?: MessageParams };
  if (!response.ok) {
    const params =
      data.params &&
      typeof data.params === 'object' &&
      !Array.isArray(data.params) &&
      Object.values(data.params).every((value) => typeof value === 'string' || typeof value === 'number')
        ? data.params
        : undefined;
    throw new ApiError(
      isAppErrorCode(data.code) ? { code: data.code, params } : data.error || message('error.request'),
      response.status,
    );
  }
  return data;
}
