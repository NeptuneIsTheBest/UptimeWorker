import { test, expect } from '@playwright/test';
import type { AdminMonitor, GlobalSettings } from '../../src/shared/types';

function httpMonitor(id: string, name: string, url: string, enabled = true): AdminMonitor {
  return {
    id,
    name,
    type: 'http',
    url,
    method: 'GET',
    expectedStatusMin: 200,
    expectedStatusMax: 299,
    intervalMinutes: 5,
    timeoutSeconds: 10,
    enabled,
    version: 1,
    status: enabled ? 'unknown' : 'paused',
    lastCheckedAt: null,
    latencyMs: null,
    errorCode: null,
  };
}

function monitorResponse(monitors: AdminMonitor[]) {
  return { monitors, identity: { email: 'local@development' }, limit: 10 };
}

const httpsMonitors = [
  httpMonitor('site', '官方网站', 'https://EXAMPLE.COM./health'),
  httpMonitor('api', 'API 服务', 'https://example.com:8443/api'),
  httpMonitor('paused', '已暂停的服务', 'https://api.example.com/health', false),
];

test.beforeEach(async ({ request }) => {
  const current = (await (await request.get('/api/admin/settings')).json()) as GlobalSettings;
  const reset = await request.patch('/api/admin/settings', {
    headers: { Origin: 'http://127.0.0.1:4173' },
    data: { version: current.version, wafBypassEnabled: false, wafBypassDomains: [] },
  });
  expect(reset.ok()).toBe(true);
});

test('global settings persist, keep saved tokens private, and work on desktop and mobile', async ({
  page,
  context,
}) => {
  await page.route('**/api/admin/monitors', (route) =>
    route.fulfill({ json: monitorResponse(httpsMonitors) }),
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/admin');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全局设置' });
  const toggle = dialog.getByLabel('启用 Cloudflare WAF 放行');
  const tokenInput = dialog.getByLabel('放行密钥', { exact: false });
  const picker = dialog.getByRole('group', { name: '从监控列表选择' });
  const site = picker.getByRole('checkbox', { name: /^example\.com / });
  const paused = picker.getByRole('checkbox', { name: /^api\.example\.com / });
  await expect(picker.getByRole('checkbox')).toHaveCount(2);
  await expect(site).not.toBeChecked();
  await expect(paused).not.toBeChecked();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await dialog.getByRole('button', { name: '生成随机密钥' }).click();
  const firstToken = await tokenInput.inputValue();
  expect(firstToken).toMatch(/^[a-f0-9]{64}$/);
  await dialog.getByRole('button', { name: '复制新密钥' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(firstToken);
  await site.check();
  await paused.check();
  await expect(dialog.getByLabel('生效域名', { exact: true })).toHaveValue('example.com\napi.example.com');
  await dialog.getByLabel('生效域名', { exact: true }).fill('EXAMPLE.COM.\nexample.com\napi.example.com');
  await expect(site).toBeChecked();
  await expect(paused).toBeChecked();
  await dialog.getByText('Cloudflare Skip 规则配置', { exact: true }).click();
  await expect(dialog.getByLabel('WAF 规则模板')).toContainText(
    'http.host in {"example.com" "api.example.com"}',
  );
  await expect(dialog.getByLabel('WAF 规则模板')).not.toContainText(firstToken);
  await dialog.getByRole('button', { name: '复制完整规则' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(firstToken);
  await dialog.getByRole('heading', { name: '全局设置' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/settings-desktop.png', fullPage: true });
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/admin/settings') && response.request().method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: '保存设置' }).click();
  expect(await (await responsePromise).text()).not.toContain(firstToken);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('全局设置已保存');

  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(tokenInput).toHaveValue('');
  await expect(dialog.getByText('已配置', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('生效域名', { exact: true })).toHaveValue('example.com\napi.example.com');
  await expect(site).toBeChecked();
  await expect(paused).toBeChecked();
  await expect(dialog.getByRole('button', { name: '复制新密钥' })).toBeDisabled();
  await page.screenshot({ path: 'test-results/settings-mobile.png', fullPage: true });
  await dialog.getByText('Cloudflare Skip 规则配置', { exact: true }).click();
  await dialog.getByRole('button', { name: '复制规则模板' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('<YOUR_TOKEN>');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await dialog.getByRole('button', { name: '生成随机密钥' }).click();
  expect(await tokenInput.inputValue()).not.toBe(firstToken);
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(tokenInput).toHaveValue('');
  await toggle.uncheck();
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(dialog.getByText('已配置', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('生效域名', { exact: true })).toHaveValue('example.com\napi.example.com');
});

test('settings validate input and allow retry after loading or saving fails', async ({ page }) => {
  await page.route('**/api/admin/monitors', (route) =>
    route.fulfill({ json: monitorResponse(httpsMonitors) }),
  );
  let failLoad = true;
  let failSave = true;
  await page.route('**/api/admin/settings', async (route) => {
    if (route.request().method() === 'GET' && failLoad) {
      return route.fulfill({ status: 503, json: { error: '暂时无法读取全局设置' } });
    }
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
  // Keep all StrictMode setup requests failing until the user explicitly retries.
  failLoad = false;
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  await dialog.getByLabel('启用 Cloudflare WAF 放行').check();
  await dialog.getByRole('button', { name: '生成随机密钥' }).click();
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog.getByRole('alert')).toContainText('至少填写一个生效域名');
  await dialog.getByLabel('生效域名', { exact: true }).fill('*.example.com');
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog.getByRole('alert')).toContainText('不含协议、端口、路径或通配符');
  await dialog.getByLabel('生效域名', { exact: true }).fill('example.com');
  await dialog.getByLabel('放行密钥', { exact: false }).fill('short');
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog.getByRole('alert')).toContainText('32–256');
  await dialog.getByRole('button', { name: '生成随机密钥' }).click();
  const draftToken = await dialog.getByLabel('放行密钥', { exact: false }).inputValue();
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog.getByRole('alert')).toContainText('暂时无法保存全局设置');
  await expect(dialog.getByLabel('放行密钥', { exact: false })).toHaveValue(draftToken);
  await expect(dialog.getByRole('checkbox', { name: /^example\.com / })).toBeChecked();
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
});

test('a stale settings form offers an explicit reload before saving again', async ({ page }) => {
  await page.route('**/api/admin/monitors', (route) =>
    route.fulfill({
      json: monitorResponse([
        httpMonitor('old', '原监控', 'https://old.example.com'),
        httpMonitor('new', '新监控', 'https://new.example.com'),
      ]),
    }),
  );
  await page.goto('/admin');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全局设置' });
  await expect(dialog.getByLabel('生效域名', { exact: true })).toHaveValue('');
  const current = (await (await page.request.get('/api/admin/settings')).json()) as GlobalSettings;
  expect(
    (
      await page.request.patch('/api/admin/settings', {
        headers: { Origin: 'http://127.0.0.1:4173' },
        data: { version: current.version, wafBypassDomains: ['new.example.com'] },
      })
    ).ok(),
  ).toBe(true);
  await dialog.getByLabel('生效域名', { exact: true }).fill('old.example.com');
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog.getByRole('alert')).toContainText('全局设置已被修改');
  await expect(dialog.getByRole('checkbox', { name: /^old\.example\.com / })).toBeChecked();
  await expect(dialog.getByRole('button', { name: '保存设置' })).toBeDisabled();
  await dialog.getByRole('button', { name: '重新加载最新设置（放弃当前编辑）' }).click();
  await expect(dialog.getByLabel('生效域名', { exact: true })).toHaveValue('new.example.com');
  await expect(dialog.getByRole('checkbox', { name: /^new\.example\.com / })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /^old\.example\.com / })).not.toBeChecked();
  await expect(dialog.getByLabel('放行密钥', { exact: false })).toHaveValue('');
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
});

test('domain choices normalize HTTPS hosts and preserve unrelated manual input', async ({ page }) => {
  const monitors: AdminMonitor[] = [
    ...httpsMonitors,
    httpMonitor('idn', '国际化站点', 'https://例子.测试/status'),
    httpMonitor('idn-ascii', '国际化站点别名', 'https://xn--fsqu00a.xn--0zwm56d/'),
    httpMonitor('plain', 'HTTP 站点', 'http://plain.example.com'),
    httpMonitor('ipv4', 'IPv4 站点', 'https://1.1.1.1/'),
    httpMonitor('ipv6', 'IPv6 站点', 'https://[2606:4700:4700::1111]/'),
    {
      id: 'tcp',
      name: 'TCP 服务',
      type: 'tcp',
      hostname: 'tcp.example.com',
      port: 443,
      intervalMinutes: 5,
      timeoutSeconds: 10,
      enabled: true,
      version: 1,
      status: 'unknown',
      lastCheckedAt: null,
      latencyMs: null,
      errorCode: null,
    },
  ];
  await page.route('**/api/admin/monitors', (route) => route.fulfill({ json: monitorResponse(monitors) }));
  await page.goto('/admin');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全局设置' });
  const picker = dialog.getByRole('group', { name: '从监控列表选择' });
  const domains = dialog.getByLabel('生效域名', { exact: true });
  const site = picker.getByRole('checkbox', { name: /^example\.com / });
  const idn = picker.getByRole('checkbox', { name: /^xn--fsqu00a\.xn--0zwm56d / });
  await expect(picker.getByRole('checkbox')).toHaveCount(3);
  await expect(picker.getByText('官方网站、API 服务', { exact: true })).toBeVisible();
  await expect(picker.getByText('国际化站点、国际化站点别名', { exact: true })).toBeVisible();
  await domains.fill(' EXAMPLE.COM. \nexample.com\n  outside.example.com  \nunfinished/\n例子.测试');
  await expect(site).toBeChecked();
  await expect(idn).toBeChecked();
  await site.uncheck();
  await expect(domains).toHaveValue('  outside.example.com  \nunfinished/\n例子.测试');
  await site.check();
  await expect(domains).toHaveValue('  outside.example.com  \nunfinished/\n例子.测试\nexample.com');
  await idn.uncheck();
  await expect(domains).toHaveValue('  outside.example.com  \nunfinished/\nexample.com');
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog.getByRole('alert')).toContainText('不含协议、端口、路径或通配符');
  await expect(domains).toHaveValue('  outside.example.com  \nunfinished/\nexample.com');

  await domains.fill('outside.example.com\n例子.测试\nxn--fsqu00a.xn--0zwm56d');
  await expect(site).not.toBeChecked();
  await expect(idn).toBeChecked();
  await site.check();
  await dialog.getByText('Cloudflare Skip 规则配置', { exact: true }).click();
  await expect(dialog.getByLabel('WAF 规则模板')).toContainText(
    'http.host in {"outside.example.com" "xn--fsqu00a.xn--0zwm56d" "example.com"}',
  );
  const saveRequest = page.waitForRequest(
    (request) => request.url().endsWith('/api/admin/settings') && request.method() === 'PATCH',
  );
  await dialog.getByRole('button', { name: '保存设置' }).click();
  expect((await saveRequest).postDataJSON().wafBypassDomains).toEqual([
    'outside.example.com',
    'xn--fsqu00a.xn--0zwm56d',
    'example.com',
  ]);
  await expect(dialog).toHaveCount(0);
});

test('monitor loading and refresh only update choices, preserving the settings draft', async ({ page }) => {
  await page.clock.install();
  let releaseMonitors!: () => void;
  const ready = new Promise<void>((resolve) => {
    releaseMonitors = resolve;
  });
  let monitors = httpsMonitors;
  await page.route('**/api/admin/monitors', async (route) => {
    await ready;
    return route.fulfill({ json: monitorResponse(monitors) });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全局设置' });
  const picker = dialog.getByRole('group', { name: '从监控列表选择' });
  const domains = dialog.getByLabel('生效域名', { exact: true });
  const token = dialog.getByLabel('放行密钥', { exact: false });
  await expect(picker.getByRole('status')).toHaveText('正在读取监控列表…');
  await domains.fill('outside.example.com');
  await dialog.getByLabel('启用 Cloudflare WAF 放行').check();
  await dialog.getByRole('button', { name: '生成随机密钥' }).click();
  const draftToken = await token.inputValue();
  releaseMonitors();
  await expect(picker.getByRole('checkbox')).toHaveCount(2);
  await picker.getByRole('checkbox', { name: /^example\.com / }).check();
  await expect(domains).toHaveValue('outside.example.com\nexample.com');

  monitors = [httpMonitor('site', '已修改地址的服务', 'https://new.example.com/health')];
  await page.clock.fastForward(60_000);
  await expect(picker.getByRole('checkbox')).toHaveCount(1);
  await expect(picker.getByRole('checkbox', { name: /^new\.example\.com / })).not.toBeChecked();
  await expect(domains).toHaveValue('outside.example.com\nexample.com');
  await expect(token).toHaveValue(draftToken);
  await expect(dialog.getByLabel('启用 Cloudflare WAF 放行')).toBeChecked();

  monitors = [];
  await page.clock.fastForward(60_000);
  await expect(picker.getByText('暂无可选的 HTTPS 监控域名，可在下方手动填写。')).toBeVisible();
  await expect(domains).toHaveValue('outside.example.com\nexample.com');
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(domains).toHaveValue('outside.example.com\nexample.com');
  await expect(picker.getByRole('checkbox')).toHaveCount(0);
});

test('monitor loading errors allow manual saves and retry without replacing the draft', async ({ page }) => {
  let failMonitors = true;
  await page.route('**/api/admin/monitors', (route) =>
    failMonitors
      ? route.fulfill({ status: 503, json: { error: '监控列表暂时不可用' } })
      : route.fulfill({ json: monitorResponse(httpsMonitors) }),
  );
  await page.goto('/admin');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全局设置' });
  const picker = dialog.getByRole('group', { name: '从监控列表选择' });
  const domains = dialog.getByLabel('生效域名', { exact: true });
  await expect(picker.getByRole('alert')).toContainText('监控列表暂时不可用');
  await domains.fill('example.com\noutside.example.com');
  await dialog.getByRole('button', { name: '保存设置' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  await expect(domains).toHaveValue('example.com\noutside.example.com');
  await domains.fill('example.com\noutside.example.com\nunfinished/');
  failMonitors = false;
  await picker.getByRole('button', { name: '重试', exact: true }).click();
  await expect(picker.getByRole('alert')).toHaveCount(0);
  await expect(picker.getByRole('checkbox', { name: /^example\.com / })).toBeChecked();
  await expect(domains).toHaveValue('example.com\noutside.example.com\nunfinished/');
});
