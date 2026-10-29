import { test, expect } from '../support/fixtures';

test('admin can create HTTP and TCP monitors, edit, pause, test, and delete', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '让你的服务开始被看见' })).toBeVisible();
  await expect(page.getByText('本地开发身份')).toBeVisible();
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.getByRole('button', { name: '新增监控', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '新增监控' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('tab', { name: '监控', exact: true }).click();
  await page.getByRole('button', { name: '新增监控', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新增监控' });
  await expect(dialog.getByLabel('检测间隔')).toHaveValue('1');
  await dialog.getByLabel('服务名称').fill('E2E 官网');
  await dialog.getByLabel('检测地址').fill('https://example.com/health');
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(page.getByRole('heading', { name: 'E2E 官网', exact: true })).toBeVisible();
  await expect(page.locator('.admin-card').filter({ hasText: 'E2E 官网' })).toContainText('每 1 分钟');
  await page.getByRole('button', { name: '新增监控', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '新增监控' });
  await dialog.getByRole('button', { name: /TCP Port/ }).click();
  await expect(dialog.getByLabel('检测间隔')).toHaveValue('1');
  await dialog.getByLabel('服务名称').fill('E2E 数据库');
  await dialog.getByLabel('主机地址').fill('db.example.com');
  await dialog.getByLabel('端口', { exact: true }).fill('5432');
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(page.getByRole('heading', { name: 'E2E 数据库', exact: true })).toBeVisible();
  await expect(page.locator('.admin-card').filter({ hasText: 'E2E 数据库' })).toContainText('每 1 分钟');
  await page.getByRole('button', { name: '编辑 E2E 数据库', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑监控' });
  await dialog.getByLabel('检测间隔').fill('2');
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(page.locator('.admin-card').filter({ hasText: 'E2E 数据库' })).toContainText('每 2 分钟');
  await page.getByRole('button', { name: '编辑 E2E 数据库', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('检测间隔')).toHaveValue('2');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '编辑 E2E 官网', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑监控' });
  await dialog.getByLabel('服务名称').fill('E2E API');
  await dialog.getByLabel('检测间隔').fill('7');
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(page.getByRole('heading', { name: 'E2E API', exact: true })).toBeVisible();
  await expect(page.locator('.admin-card').filter({ hasText: 'E2E API' })).toContainText('每 7 分钟');
  await page.getByRole('button', { name: '编辑 E2E API', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('检测间隔')).toHaveValue('7');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
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
  await page.getByRole('link', { name: '状态概览', exact: true }).click();
  await expect(page.getByRole('link', { name: 'E2E API' })).toBeVisible();
  await expect(page.locator('.monitor-card').filter({ hasText: 'E2E API' })).toContainText('等待检测');
  await page.getByRole('link', { name: 'E2E API' }).click();
  await expect(page.getByRole('heading', { name: '暂无历史事件' })).toBeVisible();
  await expect(page.getByRole('region', { name: '进行中与计划事件', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '监控管理', exact: true }).click();
  for (const name of ['E2E API', 'E2E 数据库']) {
    await page.getByRole('button', { name: `删除 ${name}`, exact: true }).click();
    await page.getByRole('dialog', { name: '删除监控' }).getByRole('button', { name: '确认删除' }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  }
});
