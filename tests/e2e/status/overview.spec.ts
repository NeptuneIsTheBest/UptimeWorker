import { test, expect } from '../support/fixtures';
import type { StatusResponse } from '../../../src/shared/status/types';
import { sampleMonitor } from '../support/status-data';

test('public overview is responsive, filterable and makes stale results explicit', async ({ page }) => {
  const monitors = Array.from({ length: 4 }, (_, i) => sampleMonitor(i));
  const data: StatusResponse = {
    siteName: 'UptimeWorker',
    pageRefreshSeconds: 30,
    generatedAt: Date.now(),
    monitors,
  };
  await page.route('**/api/status', (route) => route.fulfill({ json: data }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '所有服务，运行如常。' })).toBeVisible();
  await expect(page.getByRole('region', { name: '进行中与计划事件', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '暂无历史事件' })).toBeVisible();
  await expect(page.locator('.monitor-card')).toHaveCount(4);
  await page.getByLabel('搜索服务').fill('数据库');
  await expect(page.locator('.monitor-card')).toHaveCount(1);
  await page.getByLabel('搜索服务').fill('');
  await page.getByLabel('搜索服务').blur();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('banner')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  data.monitors[0] = sampleMonitor(0, 'stale');
  data.monitors[1] = { ...sampleMonitor(1), lastCheckedAt: Date.now() - 1_200_000 };
  await page.reload();
  await expect(page.getByRole('heading', { name: '部分服务需要关注。' })).toBeVisible();
  await page.getByLabel('按状态筛选').selectOption('stale');
  await expect(page.locator('.monitor-card')).toHaveCount(2);
});
test('public API errors offer recovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/status', (route) =>
    route.fulfill({ status: 503, json: { error: '暂时无法连接数据库' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('暂时无法连接数据库');
  await expect(page.getByRole('heading', { name: '状态数据暂时不可用。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
});
