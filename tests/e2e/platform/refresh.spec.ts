import type { Page, Route } from '@playwright/test';
import type { AdminMonitor } from '../../../src/shared/monitors/types';
import type { GlobalSettings } from '../../../src/shared/settings/types';
import type { StatusResponse } from '../../../src/shared/status/types';
import { test, expect, createMonitor, origin } from '../support/fixtures';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-28T02:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-28T02:00:01Z'));
});

async function refreshed(page: Page) {
  await expect(page.locator('.refresh-status time')).toBeVisible();
  await expect(page.locator('.refresh-button')).toHaveAttribute('aria-busy', 'false');
}

async function visibility(page: Page, value: 'hidden' | 'visible') {
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}

// Build isolated public snapshots; the server's edge cache intentionally survives database resets.
function statusData(monitors: AdminMonitor[] = []): StatusResponse {
  return {
    siteName: 'UptimeWorker',
    pageRefreshSeconds: 30,
    generatedAt: Date.UTC(2001, 0, 1),
    monitors: monitors.map((monitor) => ({
      id: monitor.id,
      name: monitor.name,
      type: monitor.type,
      status: monitor.status,
      intervalMinutes: monitor.intervalMinutes,
      lastCheckedAt: monitor.lastCheckedAt,
      latencyMs: monitor.latencyMs,
      uptime30d: null,
      days: Array.from({ length: 90 }, (_, index) => ({
        day: new Date(Date.UTC(2026, 9, 28) - (89 - index) * 86_400_000).toISOString().slice(0, 10),
        total: 0,
        successful: 0,
        uptime: null,
      })),
    })),
  };
}

for (const view of ['overview', 'detail', 'admin'] as const) {
  test(`${view} refreshes every 30 seconds and shows successful refresh time on desktop and mobile`, async ({
    page,
    request,
  }, testInfo) => {
    const monitor = await createMonitor(request, { name: '刷新服务', wafBypassEnabled: false });
    const endpoint =
      view === 'overview'
        ? '/api/status'
        : view === 'detail'
          ? `/api/monitors/${monitor.id}/history`
          : '/api/admin/monitors';
    const path = view === 'overview' ? '/' : view === 'detail' ? `/monitors/${monitor.id}` : '/admin';
    const status = statusData([monitor]);
    const data =
      view === 'overview'
        ? status
        : view === 'detail'
          ? {
              monitor: status.monitors[0],
              checks: [],
              generatedAt: status.generatedAt,
              pageRefreshSeconds: 30,
            }
          : await (await request.get(endpoint)).json();
    let calls = 0;
    await page.route(`**${endpoint}`, (route) => {
      calls++;
      return route.fulfill({ json: { ...data, generatedAt: Date.UTC(2001, 0, 1) } });
    });
    await page.goto(path);
    await refreshed(page);
    const initialCalls = calls;
    const time = page.locator('.refresh-status time');
    const initialTime = await time.getAttribute('datetime');
    expect(Date.parse(initialTime!)).toBe(await page.evaluate(() => Date.now()));
    await expect(time).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    await expect(page.locator('.refresh-interval')).toHaveText('每 30 秒自动刷新');
    if (view === 'overview') {
      await page.getByLabel('搜索服务').fill('刷新');
      await page.getByLabel('按状态筛选').selectOption('unknown');
    }
    await page.clock.runFor(1000);
    await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 1 秒');
    await page.clock.runFor(28_999);
    expect(calls).toBe(initialCalls);
    await page.clock.runFor(1);
    await expect.poll(() => calls).toBe(initialCalls + 1);
    await refreshed(page);
    expect(Date.parse((await time.getAttribute('datetime'))!) - Date.parse(initialTime!)).toBe(30_000);
    await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 0 秒');
    if (view === 'overview') {
      await expect(page.getByLabel('搜索服务')).toHaveValue('刷新');
      await expect(page.getByLabel('按状态筛选')).toHaveValue('unknown');
      await expect(page.locator('.monitor-card')).toHaveCount(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`${view}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '立即刷新', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${view}-mobile.png`), fullPage: true });
  });
}

test('adopts preset and custom intervals, stops when disabled and resumes only after a manual refresh', async ({
  page,
}) => {
  const data = statusData();
  let seconds = 15;
  let calls = 0;
  await page.route('**/api/status', (route) => {
    calls++;
    return route.fulfill({ json: { ...data, pageRefreshSeconds: seconds } });
  });
  await page.goto('/');
  await refreshed(page);
  const initialCalls = calls;
  await expect(page.locator('.refresh-interval')).toHaveText('每 15 秒自动刷新');
  seconds = 7;
  await page.clock.runFor(15_000);
  await expect.poll(() => calls).toBe(initialCalls + 1);
  await refreshed(page);
  await expect(page.locator('.refresh-interval')).toHaveText('每 7 秒自动刷新');
  await page.clock.runFor(6999);
  expect(calls).toBe(initialCalls + 1);
  seconds = 0;
  await page.clock.runFor(1);
  await expect.poll(() => calls).toBe(initialCalls + 2);
  await refreshed(page);
  await expect(page.locator('.refresh-interval')).toHaveText('自动刷新已关闭');
  seconds = 30;
  await page.clock.fastForward(61_000);
  await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 1 分 1 秒');
  await page.clock.fastForward(3_600_000);
  await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 1 小时 1 分');
  await page.clock.fastForward(86_400_000);
  await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 1 天 1 小时');
  await visibility(page, 'hidden');
  await visibility(page, 'visible');
  expect(calls).toBe(initialCalls + 2);
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect.poll(() => calls).toBe(initialCalls + 3);
  await refreshed(page);
  await expect(page.locator('.refresh-interval')).toHaveText('每 30 秒自动刷新');
  await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 0 秒');
  await page.clock.runFor(30_000);
  await expect.poll(() => calls).toBe(initialCalls + 4);
});

test('keeps the last successful time and data on errors and recovers on the next poll', async ({
  page,
  request,
}) => {
  const monitor = await createMonitor(request, { name: '保留的数据', wafBypassEnabled: false });
  const data = statusData([monitor]);
  let fail = true;
  await page.route('**/api/status', (route) =>
    route.fulfill(fail ? { status: 503, json: { error: '刷新暂时失败' } } : { json: data }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('刷新暂时失败');
  await expect(page.getByText('尚未成功刷新', { exact: true })).toBeVisible();
  await expect(page.locator('.refresh-elapsed')).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await refreshed(page);
  const initialTime = await page.locator('.refresh-status time').getAttribute('datetime');
  fail = true;
  await page.clock.runFor(30_000);
  await expect(page.getByRole('alert')).toContainText('刷新暂时失败');
  await expect(page.locator('.refresh-status time')).toHaveAttribute('datetime', initialTime!);
  await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 30 秒');
  await expect(page.locator('.monitor-card')).toContainText('保留的数据');
  fail = false;
  await page.clock.runFor(30_000);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await refreshed(page);
  await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 0 秒');
  expect(await page.locator('.refresh-status time').getAttribute('datetime')).not.toBe(initialTime);
});

test('slow requests do not overlap and manual refresh discards the superseded response', async ({ page }) => {
  const data = { ...statusData(), pageRefreshSeconds: 15 };
  let delay = false;
  let calls = 0;
  const pending: Route[] = [];
  await page.route('**/api/status', (route) => {
    calls++;
    if (delay) pending.push(route);
    else return route.fulfill({ json: data });
  });
  await page.goto('/');
  await refreshed(page);
  const initialCalls = calls;
  const initialTime = await page.locator('.refresh-status time').getAttribute('datetime');
  delay = true;
  await page.clock.runFor(15_000);
  await expect.poll(() => pending.length).toBe(1);
  await expect(page.getByRole('button', { name: '立即刷新', exact: true })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  await page.clock.runFor(45_000);
  expect(calls).toBe(initialCalls + 1);
  await expect(page.locator('.refresh-status time')).toHaveAttribute('datetime', initialTime!);
  await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 1 分 0 秒');
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect.poll(() => pending.length).toBe(2);
  await pending[0].fulfill({ json: { ...data, siteName: '迟到的旧响应', pageRefreshSeconds: 0 } });
  await expect(page.getByRole('button', { name: '立即刷新', exact: true })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  await expect(page.locator('.refresh-status time')).toHaveAttribute('datetime', initialTime!);
  await pending[1].fulfill({ json: data });
  await refreshed(page);
  await expect(page.locator('.brand')).not.toContainText('迟到的旧响应');
  await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 0 秒');
  await expect(page.locator('.refresh-interval')).toHaveText('每 15 秒自动刷新');
  delay = false;
  await page.clock.runFor(14_999);
  expect(calls).toBe(initialCalls + 2);
  await page.clock.runFor(1);
  await expect.poll(() => calls).toBe(initialCalls + 3);
  await refreshed(page);
  await page.goto('/missing');
  await page.clock.runFor(60_000);
  expect(calls).toBe(initialCalls + 3);
});

test('pauses polling in the background and refreshes immediately on return', async ({ page }) => {
  const data = statusData();
  let calls = 0;
  await page.route('**/api/status', (route) => {
    calls++;
    return route.fulfill({ json: data });
  });
  await page.goto('/');
  await refreshed(page);
  const initialCalls = calls;
  await page.clock.runFor(10_000);
  await visibility(page, 'hidden');
  await page.clock.runFor(90_000);
  expect(calls).toBe(initialCalls);
  await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 1 分 40 秒');
  await visibility(page, 'visible');
  await expect.poll(() => calls).toBe(initialCalls + 1);
  await refreshed(page);
  await expect(page.locator('.refresh-elapsed')).toHaveText('已过去 0 秒');
  await page.clock.runFor(30_000);
  await expect.poll(() => calls).toBe(initialCalls + 2);
});

test('settings persist, apply immediately and polling preserves monitor and settings drafts', async ({
  page,
  request,
}, testInfo) => {
  await createMonitor(request, { name: '编辑草稿', wafBypassEnabled: false });
  await page.goto('/admin');
  await refreshed(page);
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '全局设置' });
  const preset = settings.getByLabel('刷新间隔', { exact: true });
  await expect(preset).toHaveValue('30');
  await preset.selectOption('15');
  await page.clock.runFor(30_000);
  await refreshed(page);
  await expect(preset).toHaveValue('15');
  await settings.getByRole('button', { name: '保存设置' }).click();
  await expect(settings).toHaveCount(0);
  await refreshed(page);
  await expect(page.locator('.refresh-interval')).toHaveText('每 15 秒自动刷新');

  await page.getByRole('button', { name: '编辑 编辑草稿', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑监控' });
  await editor.getByLabel('服务名称').fill('未保存的修改');
  const nextPoll = page.waitForResponse(
    (response) => response.url().endsWith('/api/admin/monitors') && response.request().method() === 'GET',
  );
  await page.clock.runFor(15_000);
  await nextPoll;
  await refreshed(page);
  await expect(editor.getByLabel('服务名称')).toHaveValue('未保存的修改');
  await editor.getByRole('button', { name: '取消', exact: true }).click();

  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(preset).toHaveValue('15');
  await preset.selectOption('custom');
  const custom = settings.getByLabel('自定义间隔（秒）');
  await custom.fill('4');
  await settings.getByRole('button', { name: '保存设置' }).click();
  await expect(settings).toBeVisible();
  expect(await custom.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
  await custom.fill('7');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('refresh-settings-mobile.png'), fullPage: true });
  await settings.getByRole('button', { name: '保存设置' }).click();
  await expect(settings).toHaveCount(0);
  await refreshed(page);
  await expect(page.locator('.refresh-interval')).toHaveText('每 7 秒自动刷新');
  await page.reload();
  await refreshed(page);
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(preset).toHaveValue('custom');
  await expect(custom).toHaveValue('7');
  await preset.selectOption('0');
  await settings.getByRole('button', { name: '保存设置' }).click();
  await expect(settings).toHaveCount(0);
  await refreshed(page);
  await expect(page.locator('.refresh-interval')).toHaveText('自动刷新已关闭');
  let calls = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/admin/monitors')) calls++;
  });
  await page.clock.runFor(60_000);
  expect(calls).toBe(0);
  const current = (await (await request.get('/api/admin/settings')).json()) as GlobalSettings;
  expect(
    (
      await request.patch('/api/admin/settings', {
        headers: origin,
        data: { version: current.version, pageRefreshSeconds: 30 },
      })
    ).ok(),
  ).toBe(true);
  await page.clock.runFor(60_000);
  expect(calls).toBe(0);
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await refreshed(page);
  await expect(page.locator('.refresh-interval')).toHaveText('每 30 秒自动刷新');
  expect(calls).toBe(1);
});
