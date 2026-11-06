import { checkDialogLayout, checkPageLayout } from '../support/layout';
import { test, expect, createMonitor } from '../support/fixtures';
import { sampleMonitor } from '../support/status-data';
import type { StatusEvent } from '../../../src/shared/events/types';

const automaticEvent = (): StatusEvent => ({
  id: 'automatic-outage',
  title: '原始服务名称 服务异常',
  body: '检测持续失败，恢复后将自动更新。',
  type: 'incident',
  source: 'automatic',
  status: 'resolved',
  startsAt: null,
  endsAt: null,
  startedAt: Date.now() - 180_000,
  endedAt: Date.now() - 60_000,
  createdAt: Date.now() - 180_000,
  updatedAt: Date.now() - 60_000,
  monitors: [{ id: null, name: '改名后的服务' }],
  updates: [
    {
      id: 'manual',
      title: 'Investigating',
      body: '管理员原文：排查网络。',
      status: null,
      source: 'manual',
      createdAt: Date.now() - 120_000,
    },
    {
      id: 'recovery',
      title: 'Resolved',
      body: '检测已恢复正常。',
      status: 'resolved',
      source: 'automatic',
      createdAt: Date.now() - 60_000,
    },
  ],
});

for (const [browserLocale, language] of [
  ['zh-CN', 'zh-CN'],
  ['zh-TW', 'zh-CN'],
  ['en-US', 'en'],
  ['fr-FR', 'en'],
] as const) {
  test.describe(`browser preference ${browserLocale}`, () => {
    test.use({ locale: browserLocale });
    test('uses the browser preference when the saved value is invalid', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('uptimeworker.locale', 'invalid'));
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('.language-select')).toHaveValue(language);
    });
  });
}

test.describe('English interface and language switching', () => {
  test.use({ locale: 'en-US', timezoneId: 'Asia/Shanghai' });

  test('preserves filters, localizes automatic history, and fits both languages on narrow screens', async ({
    page,
  }, info) => {
    const monitors = [sampleMonitor(0), sampleMonitor(1)];
    const event = automaticEvent();
    await page.route('**/api/status', (route) =>
      route.fulfill({
        json: {
          siteName: 'UptimeWorker',
          pageRefreshSeconds: 0,
          generatedAt: Date.now(),
          monitors,
          groups: [],
          ungrouped: { id: '__ungrouped__', sortOrder: 0 },
          events: [event],
        },
      }),
    );
    await page.route(`**/api/events/${event.id}`, (route) =>
      route.fulfill({
        json: {
          siteName: 'UptimeWorker',
          pageRefreshSeconds: 0,
          generatedAt: Date.now(),
          event,
        },
      }),
    );
    await page.goto('/');
    await expect(page).toHaveTitle('UptimeWorker · Service status');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /Service status, uptime/,
    );
    await page.getByLabel('Search services', { exact: true }).fill(monitors[0].name);
    await page.getByLabel('Filter by status').selectOption('up');
    await expect(page.locator('.monitor-card')).toHaveCount(1);
    await page.getByLabel('Interface language').selectOption('zh-CN');
    await expect(page.getByLabel('搜索服务', { exact: true })).toHaveValue(monitors[0].name);
    await expect(page.getByLabel('按状态筛选')).toHaveValue('up');
    await expect(page.locator('.monitor-card')).toHaveCount(1);
    for (const language of ['zh-CN', 'en']) {
      await page.locator('.language-select').selectOption(language);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await expect(page.locator('.language-select')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width === 390) {
          await expect(page.locator('.monitor-card').first().locator('.monitor-name')).toBeInViewport();
          await expect(page.locator('.monitor-card').first().locator('.status-badge')).toBeInViewport();
        }
        if (width !== 320)
          await page.screenshot({
            path: info.outputPath(`overview-${language}-${width}.png`),
            fullPage: true,
          });
      }
    }
    await page.getByRole('link', { name: '原始服务名称 service outage', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('原始服务名称 service outage');
    await expect(page.locator('.event-timeline h3')).toHaveText([
      'Resolved',
      'Investigating',
      'Investigating',
    ]);
    await expect(page.locator('.event-body').first()).toHaveText('Checks have returned to normal.');
    await expect(page.locator('.event-body').nth(1)).toHaveText('管理员原文：排查网络。');
    await expect(page.locator('.event-body').last()).toHaveText(
      'Checks are failing. This event will update on recovery.',
    );
    await expect(page.locator('.event-monitors')).toContainText('改名后的服务 (deleted)');
    await expect(page.locator('.event-last-updated time')).toContainText('minute ago');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await checkPageLayout(page, info, 'timeline-en');
    await page.locator('.language-select').selectOption('zh-CN');
    await checkPageLayout(page, info, 'timeline-zh-CN');
    await page.locator('.language-select').selectOption('en');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.route(`**/api/monitors/${monitors[0].id}/history`, (route) =>
      route.fulfill({
        json: {
          siteName: 'UptimeWorker',
          monitor: monitors[0],
          pageRefreshSeconds: 0,
          generatedAt: Date.now(),
          events: [],
          checks: [{ ok: true, checkedAt: Date.now(), latencyMs: 124, statusCode: 200, errorCode: null }],
        },
      }),
    );
    await page.goto(`/monitors/${monitors[0].id}`);
    await expect(page.getByRole('heading', { name: monitors[0].name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Response time', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /Response time chart for the last 24 hours/ })).toBeVisible();
    await expect(page.locator('.response-chart title')).toContainText('Check succeeded');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await checkPageLayout(page, info, 'monitor-detail-en');
    await page.locator('.language-select').selectOption('zh-CN');
    await checkPageLayout(page, info, 'monitor-detail-zh-CN');
    await page.locator('.language-select').selectOption('en');
    await page.goto('/monitors/missing');
    await expect(page.getByRole('alert')).toContainText('Monitor not found.');
    await page.locator('.language-select').selectOption('zh-CN');
    await expect(page.getByRole('alert')).toContainText('监控不存在。');
  });

  test('synchronizes tabs without losing drafts or already-visible validation errors', async ({
    page,
    context,
  }) => {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Add monitor', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Add monitor', exact: true });
    await dialog.getByLabel('Service name', { exact: true }).fill('未保存的服务');
    await dialog.getByRole('textbox', { name: /^Check URL/ }).fill('https://example.com/health');
    await dialog.getByRole('spinbutton', { name: /^Check interval \(minutes\)/ }).fill('0');
    await dialog.getByRole('button', { name: 'Save monitor' }).click();
    await expect(dialog.getByRole('alert')).toContainText('integer from 1 to 60 minutes');
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const other = await context.newPage();
    await other.goto('/');
    await other.getByLabel('Interface language').selectOption('zh-CN');
    dialog = page.getByRole('dialog', { name: '新增监控', exact: true });
    await expect(dialog.getByLabel('服务名称', { exact: true })).toHaveValue('未保存的服务');
    await expect(dialog.getByLabel('检测间隔（分钟）')).toHaveValue('0');
    await expect(dialog.getByRole('alert')).toContainText('检测间隔需为 1–60 分钟的整数');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await other.getByLabel('界面语言').selectOption('en');
    dialog = page.getByRole('dialog', { name: 'Add monitor', exact: true });
    await expect(dialog.getByRole('alert')).toContainText('integer from 1 to 60 minutes');
    await dialog.getByRole('spinbutton', { name: /^Check interval \(minutes\)/ }).fill('7');
    await dialog.getByRole('button', { name: 'Save monitor' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.notice')).toContainText('Monitor saved.');
    await other.getByLabel('Interface language').selectOption('zh-CN');
    await expect(page.locator('.notice')).toContainText('监控已保存。');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('heading', { name: '未保存的服务', exact: true })).toBeVisible();
    await other.close();
  });

  test('keeps the selected admin tab and event page when another tab changes language', async ({
    page,
    context,
  }) => {
    await page.route('**/api/admin/events*', (route) => {
      const older = new URL(route.request().url()).searchParams.has('cursor');
      return route.fulfill({
        json: {
          events: [
            {
              ...automaticEvent(),
              title: older ? 'Older event' : 'Latest event',
              source: 'manual',
              version: 1,
            },
            {
              ...automaticEvent(),
              id: 'open-event',
              title: 'Still investigating',
              source: 'manual',
              status: 'open',
              endedAt: null,
              updates: [],
              version: 1,
            },
          ],
          nextCursor: older ? null : 'page-2',
          pageRefreshSeconds: 0,
        },
      });
    });
    await page.goto('/admin');
    await page.getByRole('tab', { name: 'Events', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Open and scheduled events', exact: true })).toContainText(
      'Still investigating',
    );
    await page.getByRole('button', { name: 'Older events', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Event history', exact: true })
        .getByRole('link', { name: 'Older event', exact: true }),
    ).toBeVisible();
    const other = await context.newPage();
    await other.goto('/');
    await other.locator('.language-select').selectOption('zh-CN');
    await expect(page.getByRole('tab', { name: '事件', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('region', { name: '进行中与计划事件', exact: true })).toContainText(
      'Still investigating',
    );
    await expect(
      page
        .getByRole('region', { name: '历史事件', exact: true })
        .getByRole('link', { name: 'Older event', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeVisible();
    await other.close();
  });

  test('manages groups, settings and manual events in English, preserving wire values and user content', async ({
    page,
    request,
  }, info) => {
    await createMonitor(request, { name: 'English service', wafBypassEnabled: false });
    await page.goto('/admin');
    await checkPageLayout(page, info, 'admin-en');
    await page.locator('.language-select').selectOption('zh-CN');
    await checkPageLayout(page, info, 'admin-zh-CN');
    await page.locator('.language-select').selectOption('en');
    await page.getByRole('button', { name: 'Manage groups', exact: true }).click();
    const groups = page.getByRole('dialog', { name: 'Manage groups', exact: true });
    await checkDialogLayout(page, groups, info, 'groups-en');
    await groups.getByLabel('Group name', { exact: true }).fill('Operations');
    await groups.getByRole('button', { name: 'Save group', exact: true }).click();
    await expect(groups.getByRole('button', { name: 'Edit Operations', exact: true })).toBeVisible();
    await groups.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Edit English service', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit monitor', exact: true });
    await editor.getByRole('combobox', { name: 'Group', exact: true }).selectOption({ label: 'Operations' });
    await checkDialogLayout(page, editor, info, 'monitor-editor-en');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('monitor-editor-en-390.png'), fullPage: true });
    await page.route('**/api/admin/monitors/*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({
            status: 409,
            json: { code: 'monitor_conflict' },
          })
        : route.continue(),
    );
    await editor.getByRole('button', { name: 'Save monitor', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('The monitor has changed. Refresh and try again.');
    await expect(editor.getByRole('alert')).toBeInViewport();
    await expect(
      editor.getByRole('combobox', { name: 'Group', exact: true }).locator('option:checked'),
    ).toHaveText('Operations');
    await page.unroute('**/api/admin/monitors/*');
    await editor.getByRole('button', { name: 'Save monitor', exact: true }).click();
    await page.getByRole('button', { name: 'Global settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Global settings', exact: true });
    await settings.getByLabel('Refresh interval', { exact: true }).selectOption('15');
    await checkDialogLayout(page, settings, info, 'settings-en');
    expect(await settings.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('settings-en-390.png'), fullPage: true });
    await settings.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.locator('.notice')).toContainText('Global settings saved.');
    await page.getByRole('tab', { name: 'Events', exact: true }).click();
    await page.getByRole('button', { name: 'Publish event', exact: true }).click();
    const event = page.getByRole('dialog', { name: 'Publish event', exact: true });
    await checkDialogLayout(page, event, info, 'event-editor-en');
    await event.getByLabel('Event title', { exact: true }).fill('人工事件原文');
    await event.getByLabel('Event description', { exact: true }).fill('管理员填写的说明不翻译。');
    await event.getByLabel('English service', { exact: true }).check();
    await event.getByRole('button', { name: 'Publish event', exact: true }).click();
    await page.getByRole('button', { name: 'Add update', exact: true }).click();
    const progress = page.getByRole('dialog', { name: 'Add event update', exact: true });
    await checkDialogLayout(page, progress, info, 'progress-en');
    await progress.getByRole('combobox', { name: 'Progress stage', exact: true }).selectOption('Resolved');
    await progress.getByLabel('Progress description', { exact: true }).fill('恢复说明原文。');
    await progress.getByRole('button', { name: 'Save update', exact: true }).click();
    await expect(page.locator('.event-latest h4')).toHaveText('Resolved');
    await page.getByRole('link', { name: 'View timeline', exact: true }).click();
    await page.locator('.language-select').selectOption('zh-CN');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('人工事件原文');
    await expect(page.locator('.event-timeline h3')).toHaveText(['故障恢复', '正在排查']);
    await expect(page.locator('.event-body').first()).toHaveText('恢复说明原文。');
    await expect(page.locator('.event-body').last()).toHaveText('管理员填写的说明不翻译。');
  });

  test('can switch languages when local storage is blocked', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    await page.addInitScript(() =>
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Disabled', 'SecurityError');
        },
      }),
    );
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByLabel('Interface language').selectOption('zh-CN');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('link', { name: '状态概览', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(failures).toEqual([]);
  });
});
