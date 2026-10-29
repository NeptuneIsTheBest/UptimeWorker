import type { StatusEvent } from '../../../src/shared/events/types';
import { test, expect } from '../support/fixtures';

test.use({ timezoneId: 'Asia/Shanghai' });
const now = Date.UTC(2026, 9, 29, 2, 44);
const makeEvent = (changes: Partial<StatusEvent> = {}): StatusEvent => ({
  id: 'timeline-event',
  title: '亚洲区域网络维护',
  body: '计划进行网络设备升级。\n维护期间可能出现短暂连接中断。',
  type: 'maintenance',
  source: 'manual',
  status: 'open',
  startsAt: now - 3_600_000,
  endsAt: now + 3_600_000,
  startedAt: now - 604_800_000,
  endedAt: null,
  createdAt: now - 604_800_000,
  updatedAt: now - 120_000,
  monitors: [
    { id: 'hong-kong', name: '香港节点' },
    { id: null, name: '旧节点' },
  ],
  updates: [],
  ...changes,
});
const detail = (event: StatusEvent, seconds = 30) => ({
  siteName: '区域服务状态',
  event,
  generatedAt: now,
  pageRefreshSeconds: seconds,
});

test('opens a shareable timeline with latest-only cards, legacy text and full local timestamps', async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const latestBody =
    '维护正在进行，我们会持续同步进展。\n'.repeat(5) + '连接说明：' + 'very-long-hostname-'.repeat(24);
  const legacyTitle = '<img src=x onerror=alert("legacy")> 维护准备完成';
  const event = makeEvent({
    updates: [
      {
        id: 'a',
        title: legacyTitle,
        body: '已确认所有备用线路可用。',
        status: null,
        source: 'manual',
        createdAt: now - 3_600_000,
      },
      {
        id: 'b',
        title: 'In Progress',
        body: latestBody,
        status: null,
        source: 'manual',
        createdAt: now - 120_000,
      },
    ],
  });
  await page.route('**/api/status', (route) =>
    route.fulfill({
      json: {
        siteName: '区域服务状态',
        monitors: [],
        events: [event],
        generatedAt: now,
        pageRefreshSeconds: 30,
      },
    }),
  );
  await page.route(`**/api/events/${event.id}`, (route) => route.fulfill({ json: detail(event) }));
  await page.goto('/');
  const card = page.locator('.event-card');
  await expect(card.locator('.event-latest h4')).toHaveText('维护进行中');
  await expect(card).not.toContainText(event.body);
  await expect(card).not.toContainText(legacyTitle);
  await expect(card.locator('details')).toHaveCount(0);
  expect(await card.locator('.event-excerpt').evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe(
    '2',
  );
  await card.getByRole('link', { name: event.title, exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/events/${event.id}`);
  await expect(page.locator('.brand')).toContainText('区域服务状态');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);
  await expect(page.locator('.event-last-updated time')).toHaveText('2分钟前');
  await expect(page.locator('.event-timeline h3')).toHaveText(['维护进行中', '进展更新', '计划维护']);
  await expect(page.locator('.event-timeline .event-legacy-title')).toHaveText(legacyTitle);
  await expect(page.locator('.event-timeline img')).toHaveCount(0);
  await expect(page.locator('.event-timeline .event-body').first()).toHaveText(latestBody);
  await expect(page.locator('.event-timeline .event-body').last()).toHaveText(event.body);
  await expect(page.locator('.event-timeline-meta time').first()).toContainText('10:42');
  await expect(page.locator('.event-timeline-meta time').first()).toContainText('GMT+8');
  await expect(page.locator('.event-monitors')).toContainText('旧节点（已删除）');
  await expect(page.locator('.event-monitors a')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '香港节点', exact: true })).toHaveAttribute(
    'href',
    '/monitors/hong-kong',
  );
  await page.reload();
  await expect(page.locator('.event-timeline h3')).toHaveText(['维护进行中', '进展更新', '计划维护']);
  for (const [width, height] of [
    [1440, 1000],
    [768, 1000],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`event-timeline-${width}.png`), fullPage: true });
  }
  await page.getByRole('link', { name: '返回状态概览', exact: true }).click();
  await expect(page).toHaveURL('/');
});

test('refreshes event progress, keeps data on failure and derives maintenance boundaries without invented entries', async ({
  page,
}) => {
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  let event = makeEvent({ startsAt: now + 30_000, endsAt: now + 60_000 });
  let fail = true;
  let seconds = 30;
  let calls = 0;
  await page.route(`**/api/events/${event.id}`, (route) => {
    calls++;
    return route.fulfill(
      fail ? { status: 503, json: { error: '事件暂时无法读取' } } : { json: detail(event, seconds) },
    );
  });
  await page.goto(`/events/${event.id}`);
  await expect(page.getByRole('alert')).toContainText('事件暂时无法读取');
  await expect(page.locator('.event-detail')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.event-status')).toHaveText('待开始');
  await expect(page.locator('.event-timeline h3')).toHaveText(['计划维护']);
  async function poll() {
    const response = page.waitForResponse((value) => value.url().endsWith(`/api/events/${event.id}`));
    await page.clock.runFor(30_000);
    await response;
    await expect(page.locator('.refresh-button')).toHaveAttribute('aria-busy', 'false');
  }
  await poll();
  await expect(page.locator('.event-status')).toHaveText('维护进行中');
  await poll();
  await expect(page.locator('.event-status')).toHaveText('已过计划时间');
  await expect(page.locator('.event-timeline h3')).toHaveText(['计划维护']);
  const lastRefreshed = await page.locator('.refresh-status time').getAttribute('datetime');
  event = {
    ...event,
    status: 'resolved',
    endedAt: now + 60_000,
    updatedAt: now + 60_000,
    updates: [
      {
        id: 'completed',
        title: 'Completed',
        body: '维护已经完成。',
        status: 'resolved',
        source: 'manual',
        createdAt: now + 60_000,
      },
    ],
  };
  fail = true;
  await poll();
  await expect(page.getByRole('alert')).toContainText('事件暂时无法读取');
  await expect(page.locator('.event-status')).toHaveText('已过计划时间');
  await expect(page.locator('.refresh-status time')).toHaveAttribute('datetime', lastRefreshed!);
  fail = false;
  seconds = 0;
  await poll();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.event-status')).toHaveText('已完成');
  await expect(page.locator('.event-timeline h3')).toHaveText(['维护完成', '计划维护']);
  await expect(page.locator('.event-detail-times')).toContainText('完成时间');
  await expect(page.locator('.refresh-interval')).toHaveText('自动刷新已关闭');
  const disabledCalls = calls;
  await page.clock.runFor(60_000);
  expect(calls).toBe(disabledCalls);
  await expect(page.locator('.event-last-updated time')).toHaveText('2分钟前');
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect.poll(() => calls).toBe(disabledCalls + 1);
});

test('shows a missing-event error with a way back to the overview', async ({ page }) => {
  await page.goto('/events/does-not-exist');
  await expect(page.getByRole('alert')).toContainText('事件不存在。');
  await expect(page.locator('.event-detail')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '返回状态概览', exact: true })).toHaveAttribute('href', '/');
});

for (const status of ['open', 'resolved', 'stopped'] as const) {
  test(`automatic ${status} events offer only allowed manual stages and display system history`, async ({
    page,
  }) => {
    const event = makeEvent({
      type: 'incident',
      source: 'automatic',
      status,
      startsAt: null,
      endsAt: null,
      endedAt: status === 'open' ? null : now,
      updates:
        status === 'open'
          ? []
          : [
              {
                id: 'automatic-end',
                title: null,
                body: '检测结果说明。',
                status,
                source: 'automatic',
                createdAt: now,
              },
            ],
    });
    await page.route('**/api/admin/events', (route) =>
      route.fulfill({
        json: {
          events: [{ ...event, version: 1 }],
          nextCursor: null,
          pageRefreshSeconds: 30,
        },
      }),
    );
    await page.route(`**/api/events/${event.id}`, (route) => route.fulfill({ json: detail(event) }));
    await page.goto('/admin');
    await page.getByRole('tab', { name: '事件', exact: true }).click();
    await page.getByRole('button', { name: '追加进展', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '追加事件进展' });
    expect(
      await editor
        .getByLabel('进展阶段')
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    ).toEqual(status === 'open' ? ['Investigating', 'Identified', 'Monitoring', 'Updated'] : ['Updated']);
    await expect(editor.getByRole('checkbox')).toHaveCount(0);
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('link', { name: '查看时间线', exact: true }).click();
    await expect(page.locator('.event-timeline h3')).toHaveText(
      status === 'open' ? ['正在排查'] : [status === 'resolved' ? '故障恢复' : '已停止跟踪', '正在排查'],
    );
  });
}
