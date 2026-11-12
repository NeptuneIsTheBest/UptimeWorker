import { openPreferences, closePreferences } from '../support/preferences';
import type { Locator, Page } from '@playwright/test';
import type { StatusEvent } from '../../../src/shared/events/types';
import { translator } from '../../../src/web/i18n/core';
import { test, expect, createMonitor, origin } from '../support/fixtures';
import { checkDialogLayout, checkPageLayout } from '../support/layout';
import { sampleMonitor } from '../support/status-data';

test.use({ colorScheme: 'light' });

async function expectTheme(page: Page, theme: 'light' | 'dark') {
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
  await expect(page.locator('html')).toHaveCSS(
    'background-color',
    theme === 'dark' ? 'rgb(16, 29, 47)' : 'rgb(243, 246, 250)',
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    theme === 'dark' ? '#101d2f' : '#f3f6fa',
  );
}

async function expectReadable(locator: Locator) {
  const ratios = await locator.evaluateAll((elements) => {
    function luminance(color: string) {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      const linear = channels.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }
    return elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        let background: Element | null = element;
        while (background && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)')
          background = background.parentElement;
        const style = getComputedStyle(element);
        const foreground = luminance(element.tagName === 'text' ? style.fill : style.color);
        const backdrop = luminance(getComputedStyle(background ?? document.documentElement).backgroundColor);
        return {
          element: element.tagName + '.' + element.getAttribute('class'),
          ratio: (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05),
        };
      });
  });
  expect(ratios.length).toBeGreaterThan(0);
  for (const { element, ratio } of ratios) expect(ratio, element).toBeGreaterThanOrEqual(4.5);
}

async function mockPublicPages(page: Page) {
  const monitors = [
    sampleMonitor(0),
    sampleMonitor(1, 'down'),
    sampleMonitor(2, 'stale'),
    sampleMonitor(3, 'paused'),
  ];
  monitors[1].days[88] = { ...monitors[1].days[88], successful: 0, uptime: 0 };
  const now = Date.now();
  const event: StatusEvent = {
    id: 'theme-event',
    title: 'API 服务连接异常',
    body: '正在排查连接问题。\n我们会在恢复后更新服务状态。',
    type: 'incident',
    source: 'manual',
    status: 'open',
    startsAt: null,
    endsAt: null,
    startedAt: now - 300_000,
    endedAt: null,
    createdAt: now - 300_000,
    updatedAt: now - 120_000,
    monitors: [{ id: monitors[1].id, name: monitors[1].name }],
    updates: [
      {
        id: 'update',
        title: 'Identified',
        body: '已定位问题，正在处理。',
        status: null,
        source: 'manual',
        createdAt: now - 120_000,
      },
    ],
  };
  const settings = { siteName: 'UptimeWorker', pageRefreshSeconds: 0, generatedAt: now };
  await page.route('**/api/status', (route) =>
    route.fulfill({
      json: {
        ...settings,
        monitors,
        groups: [],
        ungrouped: { id: '__ungrouped__', sortOrder: 0 },
        events: [event],
      },
    }),
  );
  await page.route('**/api/events/' + event.id, (route) => route.fulfill({ json: { ...settings, event } }));
  await page.route('**/api/monitors/' + monitors[0].id + '/history', (route) =>
    route.fulfill({
      json: {
        ...settings,
        monitor: monitors[0],
        events: [],
        checks: Array.from({ length: 48 }, (_, index) => ({
          ok: index !== 24,
          checkedAt: now - (47 - index) * 300_000,
          latencyMs: index === 24 ? 350 : 80 + (index % 7) * 15,
          statusCode: index === 24 ? 503 : 200,
          errorCode: index === 24 ? 'http_status' : null,
        })),
      },
    }),
  );
  return { monitors, event };
}

test('follows system changes, respects manual overrides, and remembers navigation and reloads', async ({
  page,
}) => {
  await page.goto('/');
  const select = page.getByLabel('外观主题');
  await expect(select).toHaveValue('system');
  await expectTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark');
  await select.selectOption('light');
  await expectTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'light');
  await select.selectOption('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'dark');
  await page.reload();
  await expectTheme(page, 'dark');
  await expect(select).toHaveValue('dark');
  await page.getByRole('link', { name: '监控管理', exact: true }).click();
  await expectTheme(page, 'dark');
  await select.selectOption('system');
  await expectTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, 'dark');
  await page.getByLabel('界面语言').focus();
  await page.keyboard.press('Tab');
  await expect(select).toBeFocused();
  await expect(select).toHaveCSS('outline-style', 'solid');
});

test('synchronizes tabs without losing filters, drafts, errors or the selected admin tab', async ({
  page,
  context,
}) => {
  const { monitors } = await mockPublicPages(page);
  await page.goto('/');
  await page.getByLabel('搜索服务', { exact: true }).fill(monitors[0].name);
  await page.getByLabel('按状态筛选').selectOption('up');
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const other = await context.newPage();
  await other.goto('/admin');
  await other.getByLabel('外观主题').selectOption('dark');
  await expectTheme(page, 'dark');
  await expect(page.getByLabel('搜索服务', { exact: true })).toHaveValue(monitors[0].name);
  await expect(page.getByLabel('按状态筛选')).toHaveValue('up');
  await expect(page.locator('.monitor-card')).toHaveCount(1);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  await other.getByRole('button', { name: '新增监控', exact: true }).click();
  const dialog = other.getByRole('dialog', { name: '新增监控', exact: true });
  await dialog.getByLabel('服务名称', { exact: true }).fill('未保存的服务');
  await dialog.getByRole('textbox', { name: /^检测地址/ }).fill('https://example.com/health');
  await dialog.getByLabel('检测间隔（分钟）').fill('0');
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(dialog.getByRole('alert')).toContainText('检测间隔');
  await page.getByLabel('外观主题').selectOption('light');
  await expectTheme(other, 'light');
  await expect(dialog.getByLabel('服务名称', { exact: true })).toHaveValue('未保存的服务');
  await expect(dialog.getByLabel('检测间隔（分钟）')).toHaveValue('0');
  await expect(dialog.getByRole('alert')).toContainText('检测间隔');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await other.getByRole('tab', { name: '事件', exact: true }).click();
  await page.getByLabel('外观主题').selectOption('dark');
  await expectTheme(other, 'dark');
  await expect(other.getByRole('tab', { name: '事件', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.evaluate(() => localStorage.setItem('uptimeworker.theme', 'invalid'));
  await expect(other.getByLabel('外观主题')).toHaveValue('system');
  await expectTheme(other, 'light');
  await page.getByLabel('外观主题').selectOption('light');
  await expect(other.getByLabel('外观主题')).toHaveValue('light');
  await page.evaluate(() => localStorage.removeItem('uptimeworker.theme'));
  await expect(other.getByLabel('外观主题')).toHaveValue('system');
  await page.getByLabel('外观主题').selectOption('dark');
  await expectTheme(other, 'dark');
  await page.evaluate(() => localStorage.clear());
  await expectTheme(other, 'light');
  await expect(other.getByLabel('外观主题')).toHaveValue('system');
  await other.close();
});

test('keeps switching when storage is blocked', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() =>
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Disabled', 'SecurityError');
      },
    }),
  );
  await page.goto('/');
  await expectTheme(page, 'dark');
  await page.getByLabel('外观主题').selectOption('light');
  await expectTheme(page, 'light');
  await page.reload();
  await expectTheme(page, 'dark');
  await expect(page.getByLabel('外观主题')).toHaveValue('system');
  expect(errors).toEqual([]);
});

test('falls back to light when system detection is unavailable, while manual dark still works', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window, 'matchMedia', { value: undefined }));
  await page.goto('/');
  await expectTheme(page, 'light');
  await page.getByLabel('外观主题').selectOption('dark');
  await expectTheme(page, 'dark');
  await page.reload();
  await expectTheme(page, 'dark');
  expect(errors).toEqual([]);
});

for (const [saved, system, expected] of [
  [null, 'dark', 'dark'],
  ['dark', 'light', 'dark'],
  ['light', 'dark', 'light'],
  ['invalid', 'dark', 'dark'],
] as const) {
  test('applies theme before app startup: saved=' + saved + ', system=' + system, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system });
    if (saved) await page.addInitScript((value) => localStorage.setItem('uptimeworker.theme', value), saved);
    await page.route('**/src/web/main.tsx', (route) => route.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).toBeEmpty();
    await expectTheme(page, expected);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const locale of ['zh-CN', 'en'] as const) {
    test(
      'readable responsive pages and dialogs: ' + theme + ' / ' + locale,
      async ({ page, request }, info) => {
        test.setTimeout(90_000);
        const t = translator(locale);
        const monitor = await createMonitor(request, { name: 'Theme service', wafBypassEnabled: false });
        const created = await request.post('/api/admin/events', {
          headers: origin,
          data: {
            title: 'Connection issue',
            body: 'Investigating the connection.',
            type: 'incident',
            monitorIds: [monitor.id],
          },
        });
        expect(created.status()).toBe(201);
        const { monitors, event } = await mockPublicPages(page);
        await page.goto('/');
        await page.locator('.language-select').selectOption(locale);
        await page.getByLabel(t('theme.label')).selectOption(theme);
        await expectTheme(page, theme);
        await expect(page.locator('.monitor-card')).toHaveCount(4);
        await expectReadable(
          page.locator(
            '.brand-mark, .status-badge, .event-status, .theme-select, .language-select, .stat-label',
          ),
        );
        await checkPageLayout(page, info, 'overview');
        for (const viewport of [
          { width: 1440, height: 900 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport);
          await page.evaluate(async () => {
            await document.fonts.ready;
            window.scrollTo(0, 0);
          });
          await expect(page.locator('.monitor-card').first()).toBeInViewport({ ratio: 1 });
          await expect(page.locator('.monitor-card').first().locator('.history-bar')).toHaveCount(90);
        }
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          await openPreferences(page);
          await expect(page.getByLabel(t('theme.label'))).toBeInViewport({ ratio: 1 });
          await expect(page.getByLabel(t('language.label'))).toBeInViewport({ ratio: 1 });
          await closePreferences(page);
        }
        await page.goto('/monitors/' + monitors[0].id);
        await expect(page.locator('.response-chart')).toBeVisible();
        await expectReadable(page.locator('.response-chart text, .detail-metrics span'));
        await checkPageLayout(page, info, 'monitor-detail');
        await page.goto('/events/' + event.id);
        await expect(page.locator('.event-detail')).toBeVisible();
        await checkPageLayout(page, info, 'event-detail');
        await page.goto('/admin');
        await expect(page.locator('.admin-card')).toHaveCount(1);
        await expectReadable(page.locator('.button.primary, .button.secondary, .status-badge'));
        await checkPageLayout(page, info, 'admin');
        for (const [key, name] of [
          ['monitors.add', 'monitor-editor'],
          ['groups.manage', 'groups'],
          ['settings.title', 'settings'],
        ] as const) {
          await page.getByRole('button', { name: t(key), exact: true }).click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          await checkDialogLayout(page, dialog, info, name);
          await expectReadable(dialog.locator('.button, input:not([type="checkbox"]), select, textarea'));
          await dialog.getByRole('button', { name: t('common.close'), exact: true }).click();
        }
        await page.getByRole('tab', { name: t('performance.tab'), exact: true }).click();
        await expect(page.locator('.performance-controls')).toBeVisible();
        await checkPageLayout(page, info, 'performance');
        await page.getByRole('tab', { name: t('admin.events'), exact: true }).click();
        await expect(page.locator('.event-card')).toHaveCount(1);
        for (const [key, name] of [
          ['event.publish', 'event-editor'],
          ['event.addUpdate', 'progress-editor'],
          ['event.delete', 'delete-event'],
        ] as const) {
          await page.getByRole('button', { name: t(key), exact: true }).click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          await checkDialogLayout(page, dialog, info, name);
          await expectReadable(dialog.locator('.button, input:not([type="checkbox"]), select, textarea'));
          await dialog.getByRole('button', { name: t('common.close'), exact: true }).click();
        }
      },
    );
  }
}
