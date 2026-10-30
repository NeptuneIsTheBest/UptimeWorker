import type { APIRequestContext, Page } from '@playwright/test';
import type { GroupListing, MonitorGroup } from '../../../src/shared/groups/types';
import { orderedGroups } from '../../../src/shared/groups/ordering';
import { orderItems } from '../../../src/shared/ordering';
import { test, expect, createMonitor, origin } from '../support/fixtures';
import { checkPageLayout } from '../support/layout';

async function seed(request: APIRequestContext) {
  const groups: MonitorGroup[] = [];
  for (const name of ['应用服务', '备用服务']) {
    const response = await request.post('/api/admin/groups', { headers: origin, data: { name } });
    expect(response.status()).toBe(201);
    groups.push(await response.json());
  }
  const a = await createMonitor(request, { name: '应用一', groupId: groups[0].id });
  await createMonitor(request, { name: '应用二', groupId: groups[0].id, enabled: false });
  await createMonitor(request, { name: '备用一', groupId: groups[1].id });
  await createMonitor(request, { name: '未分组一' });
  await createMonitor(request, { name: '未分组二' });
  return { groups, a };
}

const titles = (page: Page) => page.locator('.group-title');
const visibleNames = (page: Page) => page.locator('.monitor-card:visible .monitor-name');
const publicStorageKey = 'uptimeworker:collapsed-groups:public';

test('Ungrouped moves to either end with buttons and persists across both pages', async ({
  page,
  request,
}) => {
  await seed(request);
  await page.goto('/admin');
  await page.getByRole('button', { name: '分组管理', exact: true }).click();
  let dialog = page.getByRole('dialog');
  for (let i = 0; i < 2; i++) {
    await dialog.getByRole('button', { name: '上移 未分组', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('排序已保存');
  }
  await expect(dialog.getByRole('button', { name: '上移 未分组', exact: true })).toBeDisabled();
  await page.reload();
  await expect(titles(page)).toHaveText(['未分组', '应用服务', '备用服务']);
  await page.goto('/');
  await expect(titles(page)).toHaveText(['未分组', '应用服务', '备用服务']);
  await page.goto('/admin');
  await page.getByRole('button', { name: '分组管理', exact: true }).click();
  dialog = page.getByRole('dialog');
  for (let i = 0; i < 2; i++) {
    await dialog.getByRole('button', { name: '下移 未分组', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('排序已保存');
  }
  await expect(dialog.getByRole('button', { name: '下移 未分组', exact: true })).toBeDisabled();
  await page.goto('/');
  await expect(titles(page)).toHaveText(['应用服务', '备用服务', '未分组']);
});

test('collapse preferences survive refresh, rename and reorder and are separate between pages', async ({
  page,
  request,
}) => {
  const { groups, a } = await seed(request);
  await page.clock.install();
  await page.goto('/');
  await expect(visibleNames(page)).toHaveCount(5);
  const stats = await page.locator('.stat-card').allTextContents();
  const appToggle = page.getByRole('button', { name: '折叠 应用服务', exact: true });
  await appToggle.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '折叠 未分组', exact: true }).click();
  await expect(visibleNames(page)).toHaveText(['备用一']);
  await expect(page.locator('.stat-card')).toHaveText(stats);
  await expect(page.getByRole('button', { name: '展开 应用服务', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.reload();
  await expect(visibleNames(page)).toHaveText(['备用一']);

  await page.goto('/admin');
  await expect(page.locator('.admin-card:visible')).toHaveCount(5);
  await page.getByRole('button', { name: '折叠 备用服务', exact: true }).click();
  await page.getByRole('button', { name: '折叠 未分组', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑 备用一', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.admin-card:visible .admin-name h2')).toHaveText(['应用一', '应用二']);
  await page.goto('/');
  await expect(visibleNames(page)).toHaveText(['备用一']);

  expect(
    (
      await request.patch(`/api/admin/groups/${groups[0].id}`, {
        headers: origin,
        data: { name: '应用服务改名', version: groups[0].version },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.patch(`/api/admin/monitors/${a.id}`, {
        headers: origin,
        data: { name: '应用一更新', version: a.version },
      })
    ).ok(),
  ).toBe(true);
  const order = (await (await request.get('/api/admin/groups')).json()) as GroupListing;
  const reversed = orderedGroups(order.groups, { ...order.ungrouped, name: '' }).reverse();
  expect(
    (
      await request.put('/api/admin/groups/order', {
        headers: origin,
        data: { items: orderItems(reversed) },
      })
    ).ok(),
  ).toBe(true);
  const refreshed = page.waitForResponse((response) => response.url().endsWith('/api/status'));
  await page.clock.runFor(30_000);
  await refreshed;
  await expect(titles(page)).toHaveText(['未分组', '备用服务', '应用服务改名']);
  const renamed = page.getByRole('button', { name: '展开 应用服务改名', exact: true });
  await expect(renamed).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('应用一更新', { exact: true })).toBeHidden();
  await renamed.focus();
  await page.keyboard.press('Space');
  await expect(visibleNames(page)).toHaveText(['备用一', '应用一更新', '应用二']);
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: '展开 未分组', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '展开 备用服务', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '折叠 应用服务改名', exact: true })).toBeVisible();
});

test('search and filters reveal matches without overwriting collapse preferences', async ({
  page,
  request,
}) => {
  const { groups } = await seed(request);
  await page.goto('/');
  await page.getByRole('button', { name: '折叠 应用服务', exact: true }).click();
  await page.getByRole('button', { name: '折叠 未分组', exact: true }).click();
  const stored = await page.evaluate((key) => localStorage.getItem(key), publicStorageKey);
  await page.getByLabel('搜索服务').fill('应用一');
  await expect(visibleNames(page)).toHaveText(['应用一']);
  const expanded = page.getByRole('button', { name: '折叠 应用服务', exact: true });
  await expect(expanded).toBeDisabled();
  await expect(expanded).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('筛选期间自动展开', { exact: true })).toBeVisible();
  await page.getByLabel('搜索服务').fill('');
  await expect(visibleNames(page)).toHaveText(['备用一']);
  await page.getByLabel('按分组筛选').selectOption(groups[0].id);
  await expect(visibleNames(page)).toHaveText(['应用一', '应用二']);
  await page.getByLabel('按状态筛选').selectOption('paused');
  await expect(visibleNames(page)).toHaveText(['应用二']);
  await page.getByLabel('按分组筛选').selectOption('all');
  await expect(visibleNames(page)).toHaveText(['应用二']);
  await page.getByLabel('按状态筛选').selectOption('all');
  await expect(visibleNames(page)).toHaveText(['备用一']);
  await page.getByLabel('按分组筛选').selectOption('');
  await expect(visibleNames(page)).toHaveText(['未分组一', '未分组二']);
  await expect(page.getByRole('button', { name: '折叠 未分组', exact: true })).toBeDisabled();
  await page.getByLabel('搜索服务').fill('不存在');
  await expect(page.getByRole('heading', { name: '没有匹配的服务' })).toBeVisible();
  await page.getByLabel('搜索服务').fill('');
  await page.getByLabel('按分组筛选').selectOption('all');
  await expect(visibleNames(page)).toHaveText(['备用一']);
  expect(await page.evaluate((key) => localStorage.getItem(key), publicStorageKey)).toBe(stored);
});

test('group headings support both languages and mobile layouts', async ({ page, request }, info) => {
  const { groups } = await seed(request);
  const longName = '应用服务与数据库在多个地区的备用监控分组';
  expect(
    (
      await request.patch(`/api/admin/groups/${groups[0].id}`, {
        headers: origin,
        data: { name: longName, version: groups[0].version },
      })
    ).ok(),
  ).toBe(true);
  for (const path of ['/', '/admin']) {
    await page.goto(path);
    await page.getByRole('button', { name: `折叠 ${longName}`, exact: true }).click();
    await checkPageLayout(page, info, `groups-${path === '/' ? 'public' : 'admin'}-zh`);
    await page.locator('.language-select').selectOption('en');
    await expect(page.getByRole('button', { name: `Expand ${longName}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse Ungrouped', exact: true }).click();
    await checkPageLayout(page, info, `groups-${path === '/' ? 'public' : 'admin'}-en`);
    await page.locator('.language-select').selectOption('zh-CN');
  }
});

for (const storage of ['invalid', 'unavailable'] as const) {
  test(`collapse still works when browser storage is ${storage}`, async ({ page, request }) => {
    await seed(request);
    await page.addInitScript(
      ({ storage, key }) => {
        if (storage === 'invalid') localStorage.setItem(key, '{broken');
        else
          Object.defineProperty(window, 'localStorage', {
            get() {
              throw new Error('Storage disabled');
            },
          });
      },
      { storage, key: publicStorageKey },
    );
    await page.clock.install();
    await page.goto('/');
    await expect(visibleNames(page)).toHaveCount(5);
    await page.getByRole('button', { name: '折叠 应用服务', exact: true }).click();
    const refreshed = page.waitForResponse((response) => response.url().endsWith('/api/status'));
    await page.clock.runFor(30_000);
    await refreshed;
    await expect(page.getByRole('button', { name: '展开 应用服务', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await page.getByRole('button', { name: '展开 应用服务', exact: true }).click();
    await expect(visibleNames(page)).toHaveCount(5);
  });
}
