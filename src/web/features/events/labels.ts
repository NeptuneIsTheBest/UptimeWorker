import { translator, type Locale } from '../../i18n/core';
import type { StatusEvent } from '../../../shared/events/types';

export function eventLabel(event: StatusEvent, now: number, locale: Locale = 'zh-CN') {
  const t = translator(locale);
  if (event.status === 'resolved')
    return event.type === 'maintenance' ? t('event.status.completed') : t('event.status.resolved');
  if (event.status === 'stopped') return t('event.status.stopped');
  if (event.type === 'maintenance') {
    if (now < event.startsAt!) return t('event.status.scheduled');
    if (now >= event.endsAt!) return t('event.status.overdue');
    return t('event.status.maintenance');
  }
  return t('event.status.open');
}
