import { checkDialogLayout } from '../support/layout';
import { test, expect, clearMonitors, createMonitor, origin } from '../support/fixtures';
import type { GlobalSettings } from '../../../src/shared/settings/types';

test('global settings persist, redact tokens and work on desktop and mobile', async ({
  page,
  context,
  request,
}, info) => {
  await createMonitor(request);
  await createMonitor(request, { name: 'API 站点', url: 'https://api.example.com/' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/admin');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全局设置' });
  const toggle = dialog.getByLabel('启用 Cloudflare WAF 放行');
  const token = dialog.getByLabel('放行密钥', { exact: false });
  await checkDialogLayout(page, dialog, info, 'settings-zh-CN');
  await expect(toggle).not.toBeChecked();
  await expect(dialog.getByRole('group', { name: '自动纳入的域名' })).toHaveCount(0);
  await expect(dialog.getByLabel('手动补充域名')).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await toggle.check();
  await dialog.getByRole('button', { name: '生成随机密钥' }).click();
  const firstToken = await token.inputValue();
  expect(firstToken).toMatch(/^[a-f0-9]{64}$/);
  await dialog.getByRole('button', { name: '复制新密钥' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(firstToken);
  await dialog.getByText('Cloudflare Skip 规则配置', { exact: true }).click();
  const rule = dialog.getByLabel('WAF 规则模板');
  await expect(rule).toContainText('http.host in {"api.example.com" "example.com"}');
  await expect(rule).toContainText('"GET" "HEAD" "POST" "PUT" "PATCH" "DELETE" "OPTIONS"');
  await expect(rule).not.toContainText(firstToken);
  await dialog.getByRole('button', { name: '复制完整规则' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(firstToken);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/admin/settings') && r.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: '保存设置' }).click();
  const saved = await response;
  expect(saved.request().postDataJSON()).not.toHaveProperty('wafBypassDomains');
  expect(saved.request().postDataJSON()).not.toHaveProperty('wafBypassAutoDomains');
  expect(await saved.text()).not.toContain(firstToken);
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(token).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '复制新密钥' })).toBeDisabled();
  await dialog.getByText('Cloudflare Skip 规则配置', { exact: true }).click();
  await dialog.getByRole('button', { name: '复制规则模板' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('<YOUR_TOKEN>');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: '生成随机密钥' }).click();
  expect(await token.inputValue()).not.toBe(firstToken);
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await toggle.uncheck();
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(dialog.getByText('已配置', { exact: true })).toBeVisible();
  await dialog.getByText('Cloudflare Skip 规则配置', { exact: true }).click();
  await expect(rule).toContainText('http.host in {"api.example.com" "example.com"}');
});

test('settings validate input and preserve drafts while retrying load and save failures', async ({
  page,
}) => {
  let failLoad = true;
  let failSave = true;
  await page.route('**/api/admin/settings', async (route) => {
    if (route.request().method() === 'GET' && failLoad)
      return route.fulfill({ status: 503, json: { error: '暂时无法读取全局设置' } });
    if (route.request().method() === 'PATCH' && failSave) {
      failSave = false;
      return route.fulfill({ status: 503, json: { error: '暂时无法保存全局设置' } });
    }
    return route.continue();
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全局设置' });
  await expect(dialog.getByRole('alert')).toContainText('暂时无法读取全局设置');
  failLoad = false;
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await dialog.getByLabel('启用 Cloudflare WAF 放行').check();
  await dialog.getByLabel('放行密钥', { exact: false }).fill('short');
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog.getByRole('alert')).toContainText('32–256');
  await dialog.getByRole('button', { name: '生成随机密钥' }).click();
  const draft = await dialog.getByLabel('放行密钥', { exact: false }).inputValue();
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog.getByRole('alert')).toContainText('暂时无法保存全局设置');
  await expect(dialog.getByLabel('放行密钥', { exact: false })).toHaveValue(draft);
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
});

test('a stale settings form offers an explicit reload before saving again', async ({ page }) => {
  const initial = (await (await page.request.get('/api/admin/settings')).json()) as GlobalSettings;
  expect(
    (
      await page.request.patch('/api/admin/settings', {
        headers: origin,
        data: { version: initial.version, wafBypassToken: 'concurrent-test-token-'.repeat(3) },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/admin');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全局设置' });
  const toggle = dialog.getByLabel('启用 Cloudflare WAF 放行');
  const token = dialog.getByLabel('放行密钥', { exact: false });
  await expect(toggle).not.toBeChecked();
  const draft = 'draft-token-'.repeat(6);
  await token.fill(draft);
  const current = (await (await page.request.get('/api/admin/settings')).json()) as GlobalSettings;
  expect(
    (
      await page.request.patch('/api/admin/settings', {
        headers: origin,
        data: { version: current.version, wafBypassEnabled: true },
      })
    ).ok(),
  ).toBe(true);
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog.getByRole('alert')).toContainText('全局设置已被修改');
  await expect(token).toHaveValue(draft);
  await expect(toggle).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: '保存设置' })).toBeDisabled();
  await dialog.getByRole('button', { name: '重新加载最新设置（放弃当前编辑）' }).click();
  await expect(toggle).toBeChecked();
  await expect(token).toHaveValue('');
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
});

test('rule templates follow monitor edits, include paused monitors and handle an empty list', async ({
  page,
  request,
}) => {
  await createMonitor(request, { name: '规则站点' });
  await createMonitor(request, { name: '暂停站点', url: 'https://paused.example.com/', enabled: false });
  await createMonitor(request, {
    name: '未放行站点',
    url: 'https://off.example.com/',
    wafBypassEnabled: false,
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全局设置' });
  await dialog.getByText('Cloudflare Skip 规则配置', { exact: true }).click();
  const rule = dialog.getByLabel('WAF 规则模板');
  await expect(rule).toContainText('http.host in {"example.com" "paused.example.com"}');
  await expect(rule).not.toContainText('off.example.com');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '编辑 规则站点', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑监控' });
  await editor.getByLabel('检测地址').fill('https://new.example.com/');
  await editor.getByRole('button', { name: '保存监控', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await dialog.getByText('Cloudflare Skip 规则配置', { exact: true }).click();
  await expect(rule).toContainText('http.host in {"new.example.com" "paused.example.com"}');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '编辑 暂停站点', exact: true }).click();
  await editor.getByLabel('启用 WAF 放行', { exact: true }).uncheck();
  await editor.getByRole('button', { name: '保存监控', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await dialog.getByText('Cloudflare Skip 规则配置', { exact: true }).click();
  await expect(rule).toContainText('http.host in {"new.example.com"}');
  await expect(rule).not.toContainText('paused.example.com');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await clearMonitors(request);
  await page.reload();
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await dialog.getByText('Cloudflare Skip 规则配置', { exact: true }).click();
  await expect(rule).toHaveCount(0);
  await expect(dialog.getByText('在网站监控中开启 WAF 放行并保存后显示规则模板。')).toBeVisible();
});
