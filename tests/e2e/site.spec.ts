import { test, expect } from '@playwright/test';
import type { PublicMonitor, StatusResponse } from '../../src/shared/types';

test('admin can create HTTP and TCP monitors, edit, pause, test, and delete', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '让你的服务开始被看见' })).toBeVisible();
  await expect(page.getByText('本地开发身份')).toBeVisible();
  await page.getByRole('button', { name: '新增监控', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新增监控' });
  await dialog.getByLabel('服务名称').fill('E2E 官网');
  await dialog.getByLabel('检测地址').fill('https://example.com/health');
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(page.getByRole('heading', { name: 'E2E 官网', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增监控', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新增监控' });
  await dialog.getByRole('button', { name: /TCP Port/ }).click();
  await dialog.getByLabel('服务名称').fill('E2E 数据库');
  await dialog.getByLabel('主机地址').fill('db.example.com');
  await dialog.getByLabel('端口', { exact: true }).fill('5432');
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(page.getByRole('heading', { name: 'E2E 数据库', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑 E2E 官网', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑监控' });
  await dialog.getByLabel('服务名称').fill('E2E API');
  await dialog.getByLabel('检测间隔').selectOption('10');
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(page.getByRole('heading', { name: 'E2E API', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暂停 E2E API', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复 E2E API', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复 E2E API', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停 E2E API', exact: true })).toBeVisible();
  await page.route('**/api/admin/monitors/*/test', (route) =>
    route.fulfill({
      json: { checkedAt: Date.now(), ok: true, latencyMs: 35, httpStatus: 200, errorCode: null },
    }),
  );
  await page
    .locator('.admin-card')
    .filter({ hasText: 'E2E API' })
    .getByRole('button', { name: '测试连接' })
    .click();
  await expect(page.getByRole('status')).toContainText('本次测试不计入历史统计');
  await page.screenshot({ path: 'test-results/admin-desktop.png', fullPage: true });
  await page.getByRole('link', { name: '状态概览', exact: true }).click();
  await expect(page.getByRole('link', { name: 'E2E API' })).toBeVisible();
  await expect(page.locator('.monitor-card').filter({ hasText: 'E2E API' })).toContainText('等待检测');
  await page.getByRole('link', { name: 'E2E API' }).click();
  await expect(page.getByRole('heading', { name: '等待首次检测' })).toBeVisible();
  await page.getByRole('link', { name: '监控管理', exact: true }).click();
  for (const name of ['E2E API', 'E2E 数据库']) {
    await page.getByRole('button', { name: `删除 ${name}`, exact: true }).click();
    await page.getByRole('dialog', { name: '删除监控' }).getByRole('button', { name: '确认删除' }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  }
});

function sampleMonitor(index: number, status: PublicMonitor['status'] = 'up'): PublicMonitor {
  const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
  return {
    id: `sample-${index}`,
    name: ['官方网站', 'API 服务', '数据库连接', '文件存储服务'][index],
    type: index === 2 ? 'tcp' : 'http',
    status,
    intervalMinutes: 5,
    lastCheckedAt: status === 'stale' ? Date.now() - 1_200_000 : Date.now() - 120_000,
    latencyMs: [124, 86, 32, 168][index],
    uptime30d: index === 1 ? 99.97 : 100,
    days: Array.from({ length: 90 }, (_, day) => ({
      day: new Date(today - (89 - day) * 86_400_000).toISOString().slice(0, 10),
      total: day < 10 ? 0 : 288,
      successful: day < 10 ? 0 : index === 1 && day === 80 ? 285 : 288,
      uptime: day < 10 ? null : index === 1 && day === 80 ? (285 / 288) * 100 : 100,
    })),
  };
}
test('public overview is responsive, filterable and makes stale results explicit', async ({ page }) => {
  const monitors = Array.from({ length: 4 }, (_, i) => sampleMonitor(i));
  const data: StatusResponse = { siteName: 'UptimeWorker', generatedAt: Date.now(), monitors };
  await page.route('**/api/status', (route) => route.fulfill({ json: data }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '所有服务，运行如常。' })).toBeVisible();
  await expect(page.locator('.monitor-card')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/status-desktop.png', fullPage: true });
  await page.getByLabel('搜索服务').fill('数据库');
  await expect(page.locator('.monitor-card')).toHaveCount(1);
  await page.getByLabel('搜索服务').fill('');
  await page.getByLabel('搜索服务').blur();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('banner')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/status-mobile.png' });
  await page.locator('.monitor-card').last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/status-mobile-services.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  data.monitors[0] = sampleMonitor(0, 'stale');
  data.monitors[1] = { ...sampleMonitor(1), lastCheckedAt: Date.now() - 1_200_000 };
  await page.reload();
  await expect(page.getByRole('heading', { name: '部分服务需要关注。' })).toBeVisible();
  await page.getByLabel('按状态筛选').selectOption('stale');
  await expect(page.locator('.monitor-card')).toHaveCount(2);
});

test('service details render response history on desktop and mobile', async ({ page }) => {
  const now = Date.now();
  const checks = Array.from({ length: 288 }, (_, i) => ({
    checkedAt: now - (287 - i) * 300_000,
    ok: i !== 281,
    latencyMs: i === 281 ? 240 : 100 + Math.round(Math.sin(i / 9) * 24) + (i % 7),
    httpStatus: i === 281 ? 503 : 200,
    errorCode: i === 281 ? 'unexpected_status' : null,
  }));
  await page.route('**/api/monitors/sample-0/history', (route) =>
    route.fulfill({ json: { monitor: sampleMonitor(0), generatedAt: now, checks } }),
  );
  await page.goto('/monitors/sample-0');
  await expect(page.getByRole('img', { name: /最近 24 小时响应时间/ })).toBeVisible();
  await expect(page.getByText('HTTP 状态码不符合预期 · HTTP 503', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/detail-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.response-chart')).toHaveAttribute('viewBox', /^0 0 3\d\d 210$/);
  await page.screenshot({ path: 'test-results/detail-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('mobile editor stays usable and API errors offer recovery', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await page.getByRole('button', { name: '新增监控', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.route('**/api/status', (route) =>
    route.fulfill({ status: 503, json: { error: '暂时无法连接数据库' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('暂时无法连接数据库');
  await expect(page.getByRole('heading', { name: '状态数据暂时不可用。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
});
