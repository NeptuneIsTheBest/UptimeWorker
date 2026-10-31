import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isThemePreference,
  readThemePreference,
  resolveTheme,
  systemThemeQuery,
  THEME_COLORS,
  type ThemePreference,
} from '../../../src/web/theme/core';

afterEach(() => vi.unstubAllGlobals());

describe('theme preferences', () => {
  it.each([
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] as const)('resolves %s with system dark=%s to %s', (preference, dark, expected) => {
    expect(resolveTheme(preference, dark)).toBe(expected);
  });

  it.each(['system', 'light', 'dark', null, '', 'invalid'])('reads saved preference %s', (saved) => {
    vi.stubGlobal('localStorage', { getItem: () => saved });
    expect(readThemePreference()).toBe(isThemePreference(saved) ? saved : 'system');
  });

  it('falls back when storage or system detection is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('Storage disabled');
      },
    });
    vi.stubGlobal('window', {});
    expect(readThemePreference()).toBe('system');
    expect(systemThemeQuery()).toBeNull();
    expect(resolveTheme(readThemePreference(), systemThemeQuery()?.matches ?? false)).toBe('light');
  });
});

describe('pre-render bootstrap', () => {
  const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
  const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)![1];

  for (const saved of ['system', 'light', 'dark', 'invalid', null, 'blocked']) {
    for (const system of ['light', 'dark', 'unavailable']) {
      it('agrees with the application for saved=' + saved + ', system=' + system, () => {
        const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
        let themeColor = '';
        runInNewContext(bootstrap, {
          localStorage: {
            getItem() {
              if (saved === 'blocked') throw new Error('Storage disabled');
              return saved;
            },
          },
          window: {
            matchMedia() {
              if (system === 'unavailable') throw new Error('Unavailable');
              return { matches: system === 'dark' };
            },
          },
          document: {
            documentElement: root,
            querySelector: () => ({
              setAttribute: (_name: string, value: string) => {
                themeColor = value;
              },
            }),
          },
        });
        const preference: ThemePreference = isThemePreference(saved) ? saved : 'system';
        const theme = resolveTheme(preference, system === 'dark');
        expect(root.dataset.theme).toBe(theme);
        expect(root.style.colorScheme).toBe(theme);
        expect(root.style.backgroundColor).toBe(THEME_COLORS[theme]);
        expect(themeColor).toBe(THEME_COLORS[theme]);
      });
    }
  }
});
