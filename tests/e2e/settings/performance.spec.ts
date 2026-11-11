import type { GlobalSettings } from '../../../src/shared/settings/types';
import { checkPageLayout } from '../support/layout';
import { test, expect, createMonitor, origin } from '../support/fixtures';

for (const scenario of ['reload', 'browser back', 'reload while loading', 'retry'] as const) {
  test(`performance restores scroll after ${scenario}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    await page.clock.install();
    await page.goto('/admin');
    const tab = page.getByRole('tab', { name: '性能', exact: true });
    await tab.click();
    const panel = page.getByRole('region', { name: '性能设置与容量估算' });
    await expect(panel.locator('.performance-capacity')).toHaveCount(3);
    const scroll = await page.evaluate(() => {
      window.scrollTo({ top: 600, behavior: 'instant' });
      return scrollY;
    });
    expect(scroll).toBeGreaterThan(300);

    let release!: () => void;
    const settingsReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    let failLoad = scenario === 'retry';
    await page.route('**/api/admin/settings', async (route) => {
      if (failLoad) return route.fulfill({ status: 503, json: { code: 'service_unavailable' } });
      await settingsReady;
      await route.continue();
    });
    try {
      if (scenario === 'browser back') {
        await page.goto('/');
        await page.goBack();
      } else {
        await page.reload();
      }
      // This button is enabled only after monitors have loaded; settings remain pending.
      await expect(page.getByRole('button', { name: '分组管理', exact: true })).toBeEnabled();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      if (scenario === 'retry') {
        await expect(page.getByRole('alert')).toContainText('服务暂时不可用，请稍后重试。');
        await page.clock.runFor(50);
        expect(await page.evaluate(() => scrollY)).toBe(0);
        failLoad = false;
        await page.getByRole('button', { name: '重试', exact: true }).click();
      }
      await expect(page.locator('.loading')).toBeVisible();
      await page.clock.runFor(50);
      expect(await page.evaluate(() => scrollY)).toBe(0);

      if (scenario === 'reload while loading') {
        await page.reload();
        await expect(page.getByRole('button', { name: '分组管理', exact: true })).toBeEnabled();
        await expect(page.locator('.loading')).toBeVisible();
        await page.clock.runFor(50);
        expect(await page.evaluate(() => scrollY)).toBe(0);
      }
    } finally {
      release();
    }
    await expect(panel.locator('.performance-capacity')).toHaveCount(3);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);
  });
}

test('estimates react to drafts, preserve edits across refresh and tabs, and persist in both languages', async ({
  page,
  request,
}, info) => {
  for (let i = 0; i < 14; i++) await createMonitor(request, { name: `容量测试 ${i}`, intervalMinutes: 1 });
  const initial = (await (await request.get('/api/admin/settings')).json()) as GlobalSettings;
  await request.patch('/api/admin/settings', {
    headers: origin,
    data: { version: initial.version, pageRefreshSeconds: 5 },
  });
  await page.clock.install();
  await page.goto('/admin');
  await page.getByRole('tab', { name: '性能', exact: true }).click();
  const panel = page.getByRole('region', { name: '性能设置与容量估算' });
  const metric = (label: string) =>
    panel
      .locator('.performance-metric')
      .filter({ has: page.locator('dt', { hasText: label }) })
      .locator('dd');
  await expect(panel.getByLabel('检测并发数', { exact: true })).toHaveValue('4');
  await expect(metric('启用服务')).toHaveText('14');
  await expect(metric('本轮可启动')).toHaveText('10');
  await expect(metric('留待后续轮次')).toHaveText('4');
  await panel.getByLabel('每轮最大检测数', { exact: true }).fill('20');
  await expect(metric('本轮可启动')).toHaveText('12');
  await expect(metric('留待后续轮次')).toHaveText('2');
  await expect(panel.getByText('估算使用尚未保存的设置')).toBeVisible();
  const refreshed = page.waitForResponse((response) => response.url().endsWith('/api/admin/monitors'));
  await page.clock.runFor(5100);
  await refreshed;
  await expect(panel.getByLabel('每轮最大检测数', { exact: true })).toHaveValue('20');
  await page.getByRole('tab', { name: '监控', exact: true }).click();
  await expect(page.getByRole('button', { name: '新增监控', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: '性能', exact: true }).click();
  await expect(panel.getByLabel('每轮最大检测数', { exact: true })).toHaveValue('20');
  await panel.getByLabel('Workers 套餐', { exact: true }).selectOption('paid');
  await expect(metric('本轮可启动')).toHaveText('14');
  await panel.getByLabel('每轮最大检测数', { exact: true }).fill('');
  await expect(panel.locator('.performance-metric')).toHaveCount(0);
  await expect(panel.locator('.performance-capacity')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled();
  await panel.getByLabel('每轮最大检测数', { exact: true }).fill('20');
  await expect(metric('本轮可启动')).toHaveText('14');
  await panel.getByLabel('检测并发数', { exact: true }).fill('7');
  await expect(panel.getByRole('alert')).toContainText('检测并发数须为 1–6 的整数');
  await expect(panel.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled();
  await panel.getByLabel('检测并发数', { exact: true }).fill('6');
  await checkPageLayout(page, info, 'performance-zh');
  await page.locator('.language-select').selectOption('en');
  await expect(page.getByLabel('Probe concurrency', { exact: true })).toHaveValue('6');
  await checkPageLayout(page, info, 'performance-en');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Performance settings saved.' })).toBeVisible();
  expect(await (await request.get('/api/admin/settings')).json()).toMatchObject({
    performance: { workersPlan: 'paid', concurrency: 6, maxChecksPerRun: 20, timeBudgetSeconds: 50 },
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Performance', exact: true }).click();
  await expect(page.getByLabel('Probe concurrency', { exact: true })).toHaveValue('6');
  await expect(page.getByLabel('Maximum checks per run', { exact: true })).toHaveValue('20');
});

test('performance conflicts retain the draft until explicitly reloaded', async ({ page, request }) => {
  await page.goto('/admin');
  await page.getByRole('tab', { name: '性能', exact: true }).click();
  const panel = page.getByRole('region', { name: '性能设置与容量估算' });
  await expect(panel.getByLabel('检测并发数', { exact: true })).toHaveValue('4');
  await panel.getByLabel('检测并发数', { exact: true }).fill('6');
  const settings = (await (await request.get('/api/admin/settings')).json()) as GlobalSettings;
  await request.patch('/api/admin/settings', {
    headers: origin,
    data: { version: settings.version, performance: { concurrency: 2 } },
  });
  await panel.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('全局设置已被修改');
  await expect(panel.getByLabel('检测并发数', { exact: true })).toHaveValue('6');
  await expect(panel.getByRole('button', { name: '保存设置', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: '重新加载最新设置（放弃当前编辑）', exact: true }).click();
  await expect(panel.getByLabel('检测并发数', { exact: true })).toHaveValue('2');
});

test('the admin adds an eleventh monitor and publishes an event for all eleven', async ({
  page,
  request,
}) => {
  for (let i = 0; i < 10; i++) await createMonitor(request, { name: `现有服务 ${i}` });
  await page.goto('/admin');
  await page.getByRole('button', { name: '新增监控', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增监控' });
  await editor.getByLabel('服务名称').fill('第十一个服务');
  await editor.getByLabel('检测地址').fill('https://example.com/eleven');
  await editor.getByRole('button', { name: '保存监控' }).click();
  await expect(page.locator('.admin-card')).toHaveCount(11);
  await expect(page.locator('.access-strip')).toContainText('11 个监控');
  await expect(page.getByRole('button', { name: '新增监控', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '编辑 第十一个服务', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑监控' });
  await edit.getByLabel('服务名称').fill('第十一个服务已编辑');
  await edit.getByRole('button', { name: '保存监控' }).click();
  await expect(page.getByRole('heading', { name: '第十一个服务已编辑', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.getByRole('button', { name: '发布事件', exact: true }).click();
  const event = page.getByRole('dialog', { name: '发布事件' });
  await event.getByLabel('事件标题').fill('全部服务维护说明');
  await event.getByLabel('事件正文').fill('覆盖全部节点的故障说明。');
  for (const checkbox of await event.getByRole('checkbox').all()) await checkbox.check();
  await event.getByRole('button', { name: '发布事件', exact: true }).click();
  await expect(event).not.toBeVisible();
  const events = await (await request.get('/api/admin/events')).json();
  expect(events.events[0].monitors).toHaveLength(11);
  await page.goto('/');
  await expect(
    page.locator('.monitor-card').getByRole('link', { name: '第十一个服务已编辑', exact: true }),
  ).toBeVisible();
});
