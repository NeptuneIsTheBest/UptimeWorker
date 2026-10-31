import { test, expect } from '../support/fixtures';
import type { PublicMonitor } from '../../../src/shared/monitors/types';
import type { StatusEvent } from '../../../src/shared/events/types';

const now = Date.UTC(2026, 9, 29, 2);
const monitor = (id: string): PublicMonitor => ({
  id,
  name: id,
  groupId: id,
  type: 'http',
  status: 'up',
  intervalMinutes: 5,
  lastCheckedAt: now,
  latencyMs: 42,
  uptime30d: 100,
  days: [{ day: '2026-10-29', total: 10, successful: 10, uptime: 100 }],
});
const event = (id: string, changes: Partial<StatusEvent> = {}): StatusEvent => ({
  id,
  title: id,
  body: '我们会持续同步进展。',
  type: 'incident',
  source: 'manual',
  status: 'open',
  startsAt: null,
  endsAt: null,
  startedAt: now - 60_000,
  endedAt: null,
  createdAt: now - 60_000,
  updatedAt: now,
  monitors: [{ id: '节点一', name: '节点一' }],
  updates: [],
  ...changes,
});

test('homepage reflects incidents while probe metrics and filtered nodes remain healthy', async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const monitors = [monitor('节点一'), monitor('节点二')];
  let events = [
    event('人工故障'),
    event('节点一 服务异常', { source: 'automatic', body: '检测持续失败，恢复后将自动更新。' }),
  ];
  let fail = false;
  await page.route('**/api/status', (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { code: 'service_unavailable' } }
        : {
            json: {
              siteName: 'UptimeWorker',
              generatedAt: now,
              pageRefreshSeconds: 0,
              monitors,
              events,
              ungrouped: { id: '__ungrouped__', sortOrder: monitors.length },
              groups: monitors.map((monitor, index) => ({
                id: monitor.id,
                name: monitor.id,
                sortOrder: index,
              })),
            },
          },
    ),
  );
  await page.goto('/');
  const hero = page.locator('.status-hero');
  await expect(hero.getByRole('heading')).toHaveText('部分服务需要关注');
  await expect(hero).toHaveClass('status-hero attention');
  await expect(hero.locator('p')).toContainText('2 条未解决故障');
  await expect(hero.locator('p')).not.toContainText('0 项');
  await expect(page.locator('.monitor-card .status-badge')).toHaveText(['运行正常', '运行正常']);
  await expect(page.locator('.stats-grid .stat-value').first()).toHaveText('2 / 2');
  await expect(page.locator('.stats-grid .stat-value').nth(1)).toHaveText('100.00%');

  await page.getByLabel('搜索服务').fill('节点二');
  await page.getByLabel('按分组筛选').selectOption('节点二');
  await page.getByLabel('按状态筛选').selectOption('up');
  await expect(page.locator('.monitor-card')).toHaveCount(1);
  await expect(hero.locator('p')).toContainText('2 条未解决故障');
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`incident-summary-${width}.png`), fullPage: true });
  }
  async function refresh() {
    const refreshed = page.waitForResponse((response) => response.url().endsWith('/api/status'));
    await page.locator('.refresh-button').click();
    await refreshed;
    await expect(page.locator('.refresh-button')).toHaveAttribute('aria-busy', 'false');
  }
  events[0] = { ...events[0], status: 'resolved', endedAt: now };
  await refresh();
  await expect(hero.locator('p')).toContainText('1 条未解决故障');
  events[1] = { ...events[1], status: 'stopped', endedAt: now };
  await refresh();
  await expect(hero.getByRole('heading')).toHaveText('全部服务正常');
  await expect(hero).toHaveClass('status-hero healthy');

  monitors[0].status = 'down';
  await refresh();
  await expect(hero.getByRole('heading')).toHaveText('部分服务需要关注');
  await expect(hero.locator('p')).toContainText('1 项服务异常');
  await expect(hero.locator('p')).not.toContainText('未解决故障');
  monitors[0].status = 'stale';
  await refresh();
  await expect(hero.locator('p')).toContainText('1 项数据过期');
  fail = true;
  await refresh();
  await expect(hero.getByRole('heading')).toHaveText('状态暂时不可用');
  await expect(page.getByRole('alert')).toContainText('服务暂时不可用，请稍后重试。');
  fail = false;
  monitors[0].status = 'up';
  await refresh();
  await expect(hero.getByRole('heading')).toHaveText('全部服务正常');
});

test('homepage advances maintenance by the page clock and waits for explicit completion', async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  let events = [event('计划维护', { type: 'maintenance', startsAt: now + 30_000, endsAt: now + 60_000 })];
  let reads = 0;
  await page.route('**/api/status', (route) => {
    reads++;
    return route.fulfill({
      json: {
        siteName: 'UptimeWorker',
        generatedAt: now,
        pageRefreshSeconds: 0,
        monitors: [monitor('节点一')],
        groups: [{ id: '节点一', name: '节点一', sortOrder: 0 }],
        ungrouped: { id: '__ungrouped__', sortOrder: 1 },
        events,
      },
    });
  });
  await page.goto('/');
  const hero = page.locator('.status-hero');
  await expect(hero.getByRole('heading')).toHaveText('全部服务正常');
  await expect(page.locator('.event-status')).toHaveText('待开始');
  await expect(page.locator('.refresh-button')).toHaveAttribute('aria-busy', 'false');
  const initialReads = reads;
  await page.clock.runFor(30_000);
  await expect(hero.getByRole('heading')).toHaveText('维护进行中');
  await expect(hero).toHaveClass('status-hero maintenance');
  await expect(hero.locator('p')).not.toContainText('已过计划时间');
  await expect(page.locator('.event-status')).toHaveText('维护进行中');
  await page.clock.runFor(30_000);
  await expect(hero.getByRole('heading')).toHaveText('维护进行中');
  await expect(hero.locator('p')).toContainText('1 项维护尚未完成，其中 1 项已过计划时间');
  await expect(page.locator('.event-status')).toHaveText('已过计划时间');
  expect(reads).toBe(initialReads);
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`maintenance-summary-${width}.png`), fullPage: true });
  }
  async function refresh() {
    const refreshed = page.waitForResponse((response) => response.url().endsWith('/api/status'));
    await page.locator('.refresh-button').click();
    await refreshed;
    await expect(page.locator('.refresh-button')).toHaveAttribute('aria-busy', 'false');
  }
  events.push(event('维护期间故障'));
  await refresh();
  await expect(hero.getByRole('heading')).toHaveText('部分服务需要关注');
  events[1] = { ...events[1], status: 'resolved', endedAt: now + 60_000 };
  await refresh();
  await expect(hero.getByRole('heading')).toHaveText('维护进行中');
  events[0] = { ...events[0], status: 'resolved', endedAt: now + 60_000 };
  await refresh();
  await expect(hero.getByRole('heading')).toHaveText('全部服务正常');
});
