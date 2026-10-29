import { test, expect } from '../support/fixtures';
import type { GlobalSettings } from '../../../src/shared/settings/types';

test('advanced monitor options persist and remain usable on mobile', async ({ page }) => {
  await page.route('**/api/admin/settings', (route) =>
    route.fulfill({
      json: {
        version: 1,
        pageRefreshSeconds: 30,
        autoIncidentAfterMinutes: 5,
        wafBypassEnabled: false,
        wafBypassTokenConfigured: false,
      } satisfies GlobalSettings,
    }),
  );
  await page.goto('/admin');
  await page.getByRole('button', { name: '新增监控', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '新增监控' });
  await dialog.getByLabel('服务名称').fill('高级 API');
  await dialog.getByLabel('检测地址').fill('https://api.example.com/health');
  await expect(dialog.getByLabel('启用 WAF 放行', { exact: true })).not.toBeChecked();
  await dialog.getByLabel('启用 WAF 放行', { exact: true }).check();
  await expect(dialog.getByText('跨域场景请直接配置最终检测地址', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText('尚未配置共享密钥');
  await expect(dialog.getByLabel('请求方法').locator('option')).toHaveText([
    'GET',
    'HEAD',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ]);
  await dialog.getByLabel('请求方法').selectOption('POST');
  await dialog.getByText('高级配置（请求参数与响应校验）', { exact: true }).click();
  await dialog.getByRole('button', { name: '添加请求头' }).click();
  await dialog.getByLabel('请求头名称 1').fill('Authorization');
  await dialog.getByLabel('请求头值 1').fill('Bearer private-value');
  await dialog.getByLabel('请求体格式').selectOption('json');
  await dialog.getByLabel('请求体内容').fill('{broken');
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(dialog.getByRole('alert')).toContainText('不是有效的 JSON');
  await dialog.getByLabel('请求体内容').fill('{ "health": true }');
  await dialog.getByLabel('必须包含').fill('healthy\n服务正常');
  await dialog.getByLabel('不能包含').fill('error\n维护中');
  await dialog.getByLabel('忽略大小写').check();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/monitors') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '保存监控' }).click();
  expect(await (await saved).json()).toMatchObject({
    method: 'POST',
    wafBypassEnabled: true,
    requestHeaders: { authorization: 'Bearer private-value' },
    requestBody: { format: 'json', content: '{ "health": true }' },
    responseCheck: { includes: ['healthy', '服务正常'], excludes: ['error', '维护中'], ignoreCase: true },
  });
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '编辑 高级 API', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑监控' });
  await expect(dialog.getByLabel('请求方法')).toHaveValue('POST');
  await expect(dialog.getByLabel('启用 WAF 放行', { exact: true })).toBeChecked();
  await dialog.getByText('高级配置（请求参数与响应校验）', { exact: true }).click();
  await expect(dialog.getByLabel('请求头值 1')).toHaveValue('Bearer private-value');
  await expect(dialog.getByLabel('请求体内容')).toHaveValue('{ "health": true }');
  await expect(dialog.getByLabel('必须包含')).toHaveValue('healthy\n服务正常');
  await expect(dialog.getByLabel('不能包含')).toHaveValue('error\n维护中');
  await expect(dialog.getByLabel('忽略大小写')).toBeChecked();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByLabel('请求方法').selectOption('HEAD');
  await expect(dialog.getByLabel('请求体内容')).toHaveCount(0);
  await expect(dialog.getByLabel('必须包含')).toHaveCount(0);
  await dialog.getByLabel('请求方法').selectOption('POST');
  await expect(dialog.getByLabel('请求体内容')).toHaveValue('{ "health": true }');
  await dialog.getByLabel('请求方法').selectOption('HEAD');
  const updated = page.waitForResponse(
    (r) => /\/api\/admin\/monitors\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: '保存监控' }).click();
  expect(await (await updated).json()).toMatchObject({
    method: 'HEAD',
    requestBody: null,
    responseCheck: null,
  });
  await expect(dialog).toHaveCount(0);
});

test('WAF controls are unavailable for IPs and TCP, and header errors preserve the form', async ({
  page,
}) => {
  await page.goto('/admin');
  await page.getByRole('button', { name: '新增监控', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('服务名称').fill('参数校验');
  await dialog.getByLabel('检测地址').fill('https://1.1.1.1/');
  await expect(dialog.getByLabel('启用 WAF 放行', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: /TCP Port/ }).click();
  await expect(dialog.getByLabel('启用 WAF 放行', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('高级配置（请求参数与响应校验）')).toHaveCount(0);
  await dialog.getByRole('button', { name: /HTTP \/ HTTPS/ }).click();
  await dialog.getByLabel('检测地址').fill('https://example.com/');
  await dialog.getByText('高级配置（请求参数与响应校验）', { exact: true }).click();
  await dialog.getByRole('button', { name: '添加请求头' }).click();
  await dialog.getByLabel('请求头名称 1').fill('X-UptimeWorker-WAF-Bypass');
  await dialog.getByLabel('请求头值 1').fill('secret');
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(dialog.getByRole('alert')).toContainText('不能覆盖');
  await expect(dialog.getByLabel('服务名称')).toHaveValue('参数校验');
  await dialog.getByRole('button', { name: '删除请求头 1' }).click();
  await dialog.getByRole('button', { name: '保存监控' }).click();
  await expect(dialog).toHaveCount(0);
});
