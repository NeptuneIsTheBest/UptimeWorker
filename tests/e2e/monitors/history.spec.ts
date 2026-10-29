import { test, expect } from '../support/fixtures';
import { sampleMonitor } from '../support/status-data';

test('service details render a full day of minute history on desktop and mobile', async ({ page }) => {
  const now = Date.now();
  const checks = Array.from({ length: 1441 }, (_, i) => ({
    checkedAt: now - (1440 - i) * 60_000,
    ok: i !== 1433,
    latencyMs: i === 1433 ? 240 : 100 + Math.round(Math.sin(i / 9) * 24) + (i % 7),
    httpStatus: i === 1433 ? 503 : 200,
    errorCode: i === 1433 ? 'unexpected_status' : null,
  }));
  await page.route('**/api/monitors/sample-0/history', (route) =>
    route.fulfill({
      json: {
        monitor: { ...sampleMonitor(0), intervalMinutes: 1 },
        pageRefreshSeconds: 30,
        generatedAt: now,
        checks,
      },
    }),
  );
  await page.goto('/monitors/sample-0');
  await expect(page.getByRole('img', { name: /最近 24 小时响应时间/ })).toBeVisible();
  const chartPath = await page.locator('.response-chart path').getAttribute('d');
  expect(chartPath?.match(/[ML] /g)).toHaveLength(1441);
  await expect(page.getByRole('heading', { name: '历史事件', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近检测', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.response-chart')).toHaveAttribute('viewBox', /^0 0 3\d\d 210$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
