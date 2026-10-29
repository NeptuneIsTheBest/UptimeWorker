import { intlLocale, type Locale } from '../../shared/locale';
import { translate } from '../i18n/core';

export const formatTime = (time: number | null, full = false, locale: Locale = 'zh-CN') =>
  time === null
    ? translate(locale, 'time.unchecked')
    : new Intl.DateTimeFormat(intlLocale(locale), {
        ...(full ? ({ month: '2-digit', day: '2-digit' } as const) : {}),
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(time);
export const number = (value: number, locale: Locale, digits?: number) =>
  new Intl.NumberFormat(
    intlLocale(locale),
    digits === undefined
      ? {}
      : {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        },
  ).format(value);
export const percent = (value: number | null, locale: Locale = 'zh-CN') =>
  value === null
    ? '—'
    : new Intl.NumberFormat(intlLocale(locale), {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value / 100);
export const latency = (value: number | null, locale: Locale = 'zh-CN') =>
  value === null ? '—' : `${number(value, locale)} ms`;
export function elapsedTime(milliseconds: number, locale: Locale) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const t = (key: 'time.seconds' | 'time.minutes' | 'time.hours' | 'time.days', count: number) =>
    translate(locale, key, { count });
  if (seconds < 60) return t('time.seconds', seconds);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${t('time.minutes', minutes)} ${t('time.seconds', seconds % 60)}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${t('time.hours', hours)} ${t('time.minutes', minutes % 60)}`;
  return `${t('time.days', Math.floor(hours / 24))} ${t('time.hours', hours % 24)}`;
}
