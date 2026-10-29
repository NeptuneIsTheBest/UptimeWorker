import { ApplicationError } from '../../shared/errors';
import { formatError, type AppErrorCode } from '../../shared/error-messages';
import { interpolate, intlLocale, type Locale, type MessageParams } from '../../shared/locale';
import { en, zh, type MessageKey, type Translation } from './messages';

export type { Locale, MessageKey };
export type MessageValues = Readonly<Record<string, string | number | Message>>;
export interface Message {
  key: MessageKey;
  params?: MessageValues;
}
export type DisplayMessage = string | Message | { code: AppErrorCode; params?: MessageParams };
export const message = (key: MessageKey, params?: MessageValues): Message => ({ key, params });
export const LOCALE_STORAGE_KEY = 'uptimeworker.locale';
export const isLocale = (value: unknown): value is Locale => value === 'zh-CN' || value === 'en';

export function resolveLocale(saved: unknown, languages: readonly string[]): Locale {
  if (isLocale(saved)) return saved;
  return /^zh(?:-|$)/i.test(languages[0] ?? '') ? 'zh-CN' : 'en';
}
export function readLocale(): Locale {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    /* Storage may be disabled. */
  }
  const languages =
    typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  return resolveLocale(saved, languages);
}
export function translate(locale: Locale, key: MessageKey, values: MessageValues = {}): string {
  const entry: Translation = locale === 'en' ? en[key] : zh[key];
  const params = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === 'object'
        ? translate(locale, value.key, value.params)
        : typeof value === 'number'
          ? new Intl.NumberFormat(intlLocale(locale)).format(value)
          : value,
    ]),
  );
  const template =
    typeof entry === 'string'
      ? entry
      : new Intl.PluralRules(intlLocale(locale)).select(Number(values.count)) === 'one'
        ? entry.one
        : entry.other;
  return interpolate(template, params);
}
export const translator = (locale: Locale) => (key: MessageKey, params?: MessageValues) =>
  translate(locale, key, params);
export function displayMessage(value: DisplayMessage, locale: Locale): string {
  if (typeof value === 'string') return value;
  return 'code' in value
    ? formatError(value.code, value.params, locale)
    : translate(locale, value.key, value.params);
}
export class NoticeError extends Error {
  constructor(readonly notice: DisplayMessage) {
    super(typeof notice === 'string' ? notice : 'Operation failed');
  }
}
export function errorMessage(error: unknown, fallback: MessageKey): DisplayMessage {
  if (error instanceof ApplicationError) return { code: error.code, params: error.params };
  if (error instanceof NoticeError) return error.notice;
  if (error instanceof TypeError) return message('error.network');
  return error instanceof Error ? error.message : message(fallback);
}
