import { formatError, type AppErrorCode } from './error-messages';
import type { MessageParams } from './locale';

export class ApplicationError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly params: MessageParams = {},
  ) {
    super(formatError(code, params));
  }
}
export class ValidationError extends ApplicationError {}
export interface ApiErrorResponse {
  code: AppErrorCode;
  params?: MessageParams;
}
export function errorResponse(code: AppErrorCode, params: MessageParams = {}): ApiErrorResponse {
  return { code, ...(Object.keys(params).length ? { params } : {}) };
}
