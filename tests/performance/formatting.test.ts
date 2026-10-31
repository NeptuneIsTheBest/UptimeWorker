import { expect, it, vi } from 'vitest';

it('reuses numeric and plural formatters across repeated history labels in both languages', async () => {
  const created = { NumberFormat: 0, PluralRules: 0 };
  vi.resetModules();
  vi.stubGlobal(
    'Intl',
    new Proxy(Intl, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (key !== 'NumberFormat' && key !== 'PluralRules') return value;
        return new Proxy(value, {
          construct(constructor, args) {
            created[key]++;
            return Reflect.construct(constructor, args);
          },
        });
      },
    }),
  );
  try {
    const { translate } = await import('../../src/web/i18n/core');
    for (let index = 0; index < 100; index++) {
      for (const locale of ['en', 'zh-CN'] as const) {
        expect(translate(locale, 'history.successful', { successful: 288, total: 288 })).toContain('288');
        translate(locale, 'monitor.interval', { count: (index % 2) + 1 });
      }
    }
    expect(translate('en', 'monitor.interval', { count: 1 })).toBe('Every 1 minute');
    expect(translate('en', 'monitor.interval', { count: 2 })).toBe('Every 2 minutes');
    expect(created).toEqual({ NumberFormat: 2, PluralRules: 2 });
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
