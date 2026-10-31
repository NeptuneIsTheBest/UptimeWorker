import { intlLocale, type Locale } from '../../shared/locale';
import { translate } from '../i18n/core';

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function timeFormat(locale: Locale, full: boolean) {
  const key = `${locale}:${full}`;
  let formatter = dateFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(intlLocale(locale), {
      ...(full ? ({ month: '2-digit', day: '2-digit' } as const) : {}),
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    dateFormats.set(key, formatter);
  }
  return formatter;
}

function numberFormat(locale: Locale, precision: number | 'percent' | undefined) {
  const key = `${locale}:${precision ?? 'default'}`;
  let formatter = numberFormats.get(key);
  if (!formatter) {
    const digits = precision === 'percent' ? 2 : precision;
    formatter = new Intl.NumberFormat(intlLocale(locale), {
      ...(precision === 'percent' ? { style: 'percent' } : {}),
      ...(digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    });
    numberFormats.set(key, formatter);
  }
  return formatter;
}

export const formatTime = (time: number | null, full = false, locale: Locale = 'zh-CN') =>
  time === null ? translate(locale, 'time.unchecked') : timeFormat(locale, full).format(time);
export const number = (value: number, locale: Locale, digits?: number) =>
  numberFormat(locale, digits).format(value);
export const percent = (value: number | null, locale: Locale = 'zh-CN') =>
  value === null ? '—' : numberFormat(locale, 'percent').format(value / 100);
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
