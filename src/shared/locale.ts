export type Locale = 'zh-CN' | 'en';
export type MessageParams = Readonly<Record<string, string | number>>;
export const intlLocale = (locale: Locale) => (locale === 'en' ? 'en-US' : 'zh-CN');
export function interpolate(template: string, params: MessageParams = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(params[key] ?? match));
}
