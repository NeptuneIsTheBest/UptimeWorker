import type { MessageKey } from '../../i18n/core';
import type { MonitorStatus, ErrorCode } from '../../../shared/monitors/types';

export const STATUS_LABELS: Record<MonitorStatus, MessageKey> = {
  up: 'status.up',
  down: 'status.down',
  unknown: 'status.unknown',
  paused: 'status.paused',
  stale: 'status.stale',
};
export const ERROR_LABELS: Record<ErrorCode, MessageKey> = {
  timeout: 'probe.timeout',
  network: 'probe.network',
  unexpected_status: 'probe.unexpectedStatus',
  redirect_limit: 'probe.redirectLimit',
  blocked_target: 'probe.blockedTarget',
  cloudflare_challenge: 'probe.challenge',
  content_mismatch: 'probe.contentMismatch',
  response_too_large: 'probe.responseTooLarge',
  unsafe_redirect: 'probe.unsafeRedirect',
};
