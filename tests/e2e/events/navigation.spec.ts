import type { Page } from '@playwright/test';
import type { AdminEvent } from '../../../src/shared/events/types';
import { test, expect } from '../support/fixtures';
import { sampleMonitor } from '../support/status-data';

const events: AdminEvent[] = Array.from({ length: 45 }, (_, index) => ({
  id: `return-event-${index}`,
  title: `历史事件 ${index}`,
  body: '服务已恢复，保留事件时间线供后续查阅。',
  version: 1,
  type: 'incident',
  source: 'manual',
  status: 'resolved',
  startsAt: null,
  endsAt: null,
  startedAt: Date.now() - 120_000,
  endedAt: Date.now() - 60_000,
  createdAt: Date.now() - 120_000,
  updatedAt: Date.now() - 60_000,
  monitors: [{ id: 'sample-0', name: 'API 主服务' }],
  updates: [],
}));

async function mockPages(page: Page) {
  const context = page.context();
  const monitor = { ...sampleMonitor(0), name: 'API 主服务', groupId: 'api-group' };
  const settings = { siteName: '导航测试', pageRefreshSeconds: 30, generatedAt: Date.now() };
  let gate: Promise<void> | null = null;
  let calls = 0;
  async function listing() {
    calls++;
    await gate;
  }
  await context.route('**/api/admin/monitors', (route) =>
    route.fulfill({
      json: {
        monitors: [],
        groups: [],
        ungrouped: { id: '__ungrouped__', sortOrder: 0, version: 1 },
        identity: { email: 'test@example.com' },
        pageRefreshSeconds: 30,
      },
    }),
  );
  await context.route(/\/api\/admin\/events(?:\?.*)?$/, async (route) => {
    await listing();
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    const start = cursor === 'second' ? 20 : cursor === 'third' ? 40 : 0;
    await route.fulfill({
      json: {
        events: events.slice(start, start + 20),
        nextCursor: start === 0 ? 'second' : start === 20 ? 'third' : null,
        pageRefreshSeconds: 30,
      },
    });
  });
  await context.route('**/api/status', async (route) => {
    await listing();
    await route.fulfill({
      json: {
        ...settings,
        monitors: [monitor, sampleMonitor(1)],
        events: events.slice(-10),
        groups: [{ id: 'api-group', name: 'API 分组', sortOrder: 0 }],
        ungrouped: { id: '__ungrouped__', sortOrder: 1 },
      },
    });
  });
  await context.route('**/api/monitors/sample-0/history', async (route) => {
    await listing();
    await route.fulfill({ json: { ...settings, monitor, checks: [], events: events.slice(-10) } });
  });
  await context.route(/\/api\/events\/[^/]+$/, (route) => {
    const event = events.find((value) => route.request().url().endsWith(`/${value.id}`));
    return route.fulfill(
      event ? { json: { ...settings, event } } : { status: 404, json: { code: 'event_not_found' } },
    );
  });
  return {
    calls: () => calls,
    hold() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
  };
}

for (const source of ['overview', 'monitor', 'admin'] as const) {
  for (const exit of ['link', 'browser'] as const) {
    test(`${source} restores its view and scroll after event ${exit} navigation and reloads`, async ({
      page,
    }) => {
      await page.clock.install();
      const mocks = await mockPages(page);
      const english = exit === 'browser';
      await page.addInitScript(
        (language) => localStorage.setItem('uptimeworker.locale', language),
        english ? 'en' : 'zh-CN',
      );
      const sourcePath = source === 'admin' ? '/admin' : source === 'monitor' ? '/monitors/sample-0' : '/';
      await page.goto(sourcePath);
      if (source === 'admin') {
        await page.getByRole('tab', { name: english ? 'Events' : '事件', exact: true }).click();
        await page.getByRole('button', { name: english ? 'Older events' : '更早事件', exact: true }).click();
        await expect(page.locator('.event-card h3').first()).toHaveText(events[20].title);
        await page.getByRole('button', { name: english ? 'Older events' : '更早事件', exact: true }).click();
        await expect(page.locator('.event-card')).toHaveCount(5);
      } else if (source === 'overview') {
        await page.getByLabel(english ? 'Search services' : '搜索服务', { exact: true }).fill('API');
        await page.getByLabel(english ? 'Filter by status' : '按状态筛选').selectOption('up');
        await page.getByLabel(english ? 'Filter by group' : '按分组筛选').selectOption('api-group');
        await expect(page.locator('.monitor-card')).toHaveCount(1);
      }
      const link = page.locator(exit === 'link' ? '.event-title-link' : '.event-timeline-link').last();
      await link.scrollIntoViewIfNeeded();
      await link.focus();
      const scroll = await page.evaluate(() => scrollY);
      const historyLength = await page.evaluate(() => history.length);
      expect(scroll).toBeGreaterThan(300);
      await link.press('Enter');
      await expect(page).toHaveURL(`/events/${events[44].id}`);
      const backText =
        source === 'admin'
          ? english
            ? 'Back to events'
            : '返回事件列表'
          : source === 'monitor'
            ? english
              ? 'Back to service details'
              : '返回服务详情'
            : english
              ? 'Back to status overview'
              : '返回状态概览';
      await expect(page.locator('.back-link')).toHaveText(backText);
      await page.reload();
      await expect(page.locator('.back-link')).toHaveText(backText);
      await expect(page.locator('.event-detail')).toBeVisible();

      const release = mocks.hold();
      try {
        if (exit === 'link') await page.locator('.back-link').click();
        else await page.goBack();
        await expect(page).toHaveURL(sourcePath);
        await expect(page.locator('.loading').first()).toBeVisible();
      } finally {
        release();
      }
      await expect(page.locator('.event-card')).toHaveCount(source === 'admin' ? 5 : 10);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);
      expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);

      await page.goForward();
      await expect(page).toHaveURL(`/events/${events[44].id}`);
      await expect(page.locator('.back-link')).toHaveText(backText);
      await page.locator('.back-link').click();
      await expect(page.locator('.event-card')).toHaveCount(source === 'admin' ? 5 : 10);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);

      const latestScroll = Math.floor(scroll / 2);
      const releaseReload = mocks.hold();
      try {
        // Reload in the same task as scrolling, before a scroll event or deferred save can run.
        await Promise.all([
          page.waitForEvent('load'),
          page.evaluate((top) => {
            window.scrollTo({ top, behavior: 'instant' });
            location.reload();
          }, latestScroll),
        ]);
        await expect(page.locator('.loading').first()).toBeVisible();
        await page.clock.runFor(50);
        expect(await page.evaluate(() => scrollY)).toBe(0);
        // Reloading the loading screen must retain the position that is still awaiting restoration.
        await page.reload();
        await expect(page.locator('.loading').first()).toBeVisible();
        expect(await page.evaluate(() => scrollY)).toBe(0);
      } finally {
        releaseReload();
      }
      await expect(page.locator('.event-card')).toHaveCount(source === 'admin' ? 5 : 10);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(latestScroll, 0);

      await Promise.all([
        page.waitForEvent('load'),
        page.evaluate(() => {
          window.scrollTo({ top: 0, behavior: 'instant' });
          location.reload();
        }),
      ]);
      await expect(page.locator('.event-card')).toHaveCount(source === 'admin' ? 5 : 10);
      const calls = mocks.calls();
      await page.clock.runFor(31_000);
      await expect.poll(mocks.calls).toBeGreaterThan(calls);
      await expect(page.locator('.refresh-button').last()).toHaveAttribute('aria-busy', 'false');
      expect(await page.evaluate(() => scrollY)).toBe(0);
      if (source === 'overview') {
        await expect(page.getByLabel(english ? 'Search services' : '搜索服务', { exact: true })).toHaveValue(
          'API',
        );
        await expect(page.getByLabel(english ? 'Filter by status' : '按状态筛选')).toHaveValue('up');
        await expect(page.getByLabel(english ? 'Filter by group' : '按分组筛选')).toHaveValue('api-group');
        await expect(page.locator('.monitor-card')).toHaveCount(1);
      }

      if (source === 'admin') {
        await expect(
          page.getByRole('tab', { name: english ? 'Events' : '事件', exact: true }),
        ).toHaveAttribute('aria-selected', 'true');
        await page.getByRole('button', { name: english ? 'Previous page' : '上一页', exact: true }).click();
        await expect(page.locator('.event-card h3')).toHaveText(
          events.slice(20, 40).map((event) => event.title),
        );
        await page
          .getByRole('button', { name: english ? 'Back to latest' : '返回最新', exact: true })
          .click();
        await expect(page.locator('.event-card h3')).toHaveText(
          events.slice(0, 20).map((event) => event.title),
        );
        // A fresh visit is a new history entry, not the saved state of the previous admin visit.
        await page.goto('/');
        await page.goto('/admin');
        await expect(
          page.getByRole('tab', { name: english ? 'Monitors' : '监控', exact: true }),
        ).toHaveAttribute('aria-selected', 'true');
      }
    });
  }
}

test('direct visits and external links fall back to the overview even with previous history', async ({
  page,
}) => {
  await mockPages(page);
  await page.goto('/admin');
  await page.goto(`/events/${events[0].id}`);
  await expect(page.locator('.back-link')).toHaveText('返回状态概览');
  await page.locator('.back-link').click();
  await expect(page).toHaveURL('/');
  await page.route('https://navigation.example.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<a href="http://127.0.0.1:4173/events/${events[0].id}">共享事件</a>`,
    }),
  );
  await page.goto('https://navigation.example.test/');
  await page.getByRole('link').click();
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/');
  await page.locator('.back-link').click();
  await expect(page).toHaveURL('/');
});

for (const linkClass of ['event-title-link', 'event-timeline-link']) {
  test(`${linkClass} keeps new-tab navigation independent of its opener`, async ({ page, context }) => {
    await mockPages(page);
    await page.goto('/admin');
    await page.getByRole('tab', { name: '事件', exact: true }).click();
    const popupPromise = context.waitForEvent('page');
    const link = page.locator(`.${linkClass}`).first();
    if (linkClass === 'event-title-link') await link.click({ button: 'middle' });
    else await link.click({ modifiers: ['ControlOrMeta'] });
    const popup = await popupPromise;
    await expect(popup.locator('.back-link')).toHaveText('返回状态概览');
    await expect(popup.locator('.back-link')).toHaveAttribute('href', '/');
    await expect(page).toHaveURL('/admin');
    await expect(page.getByRole('tab', { name: '事件', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await popup.close();
    await link.click();
    await expect(page.locator('.back-link')).toHaveText('返回事件列表');
    await page.locator('.back-link').click();
    await expect(page.getByRole('tab', { name: '事件', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
}

test('a missing event still returns to its source list', async ({ page }) => {
  await mockPages(page);
  await page.route(`**/api/events/${events[0].id}`, (route) =>
    route.fulfill({
      status: 404,
      json: { code: 'event_not_found' },
    }),
  );
  await page.goto('/admin');
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.locator('.event-title-link').first().click();
  await expect(page.getByRole('alert')).toContainText('事件不存在');
  await page.locator('.back-link').click();
  await expect(page.getByRole('tab', { name: '事件', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('blocked session storage keeps event links usable and browser back restores the list', async ({
  page,
}) => {
  await mockPages(page);
  await page.addInitScript(() =>
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('Storage blocked', 'SecurityError');
      },
    }),
  );
  await page.goto('/admin');
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.locator('.event-title-link').first().click();
  await expect(page.locator('.event-detail')).toBeVisible();
  await expect(page.locator('.back-link')).toHaveAttribute('href', '/');
  await page.goBack();
  await expect(page.getByRole('tab', { name: '事件', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.event-card')).toHaveCount(20);
});
