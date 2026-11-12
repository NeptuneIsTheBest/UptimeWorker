import { selectLanguage } from '../support/preferences';
import type { APIRequestContext, Page, Route } from '@playwright/test';
import type { MonitorGroup } from '../../../src/shared/groups/types';
import type { AdminResponse } from '../../../src/web/features/monitors/types';
import { orderItems } from '../../../src/shared/ordering';
import { test, expect, createMonitor, origin } from '../support/fixtures';
import { checkDialogLayout, checkPageLayout } from '../support/layout';

async function group(request: APIRequestContext, name: string) {
  const response = await request.post('/api/admin/groups', { headers: origin, data: { name } });
  expect(response.status()).toBe(201);
  return (await response.json()) as MonitorGroup;
}
const names = (page: Page) => page.locator('.admin-card .admin-name h2');
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: '排序已保存' })).toBeVisible();
  await expect(page.locator('.refresh-button')).toHaveAttribute('aria-busy', 'false');
}

test('dragging groups and services persists the same order on the public page', async ({ page, request }) => {
  const a = await group(request, '亚洲');
  const b = await group(request, '欧洲');
  await createMonitor(request, { name: '未分组节点' });
  for (const name of ['亚洲一', '亚洲二', '亚洲三']) await createMonitor(request, { name, groupId: a.id });
  for (const name of ['欧洲一', '欧洲二']) await createMonitor(request, { name, groupId: b.id });
  await page.goto('/admin');
  await expect(names(page)).toHaveText(['亚洲一', '亚洲二', '亚洲三', '欧洲一', '欧洲二', '未分组节点']);
  await expect(page.getByRole('button', { name: '上移 亚洲一', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下移 亚洲三', exact: true })).toBeDisabled();
  await page
    .getByRole('button', { name: '拖动排序 亚洲三', exact: true })
    .dragTo(page.locator('.admin-card').filter({ hasText: '亚洲一' }));
  await saved(page);
  await expect(names(page)).toHaveText(['亚洲三', '亚洲一', '亚洲二', '欧洲一', '欧洲二', '未分组节点']);
  await page.getByRole('button', { name: '上移 欧洲二', exact: true }).click();
  await saved(page);

  let crossGroupWrites = 0;
  page.on('request', (req) => {
    if (req.method() === 'PUT') crossGroupWrites++;
  });
  await page
    .getByRole('button', { name: '拖动排序 亚洲三', exact: true })
    .dragTo(page.locator('.admin-card').filter({ hasText: '欧洲二' }));
  await expect(page.getByRole('button', { name: '分组管理', exact: true })).toBeEnabled();
  expect(crossGroupWrites).toBe(0);
  await expect(names(page)).toHaveText(['亚洲三', '亚洲一', '亚洲二', '欧洲二', '欧洲一', '未分组节点']);

  await page.getByRole('button', { name: '分组管理', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '分组管理', exact: true });
  await expect(dialog.getByRole('spinbutton')).toHaveCount(0);
  await dialog
    .getByRole('button', { name: '拖动排序 欧洲', exact: true })
    .dragTo(dialog.locator('.group-manager-row').filter({ hasText: '亚洲' }));
  await expect(dialog.getByRole('status')).toContainText('排序已保存');
  await expect(dialog.locator('.group-manager-row strong')).toHaveText(['欧洲', '亚洲', '未分组']);
  await expect(dialog.getByRole('button', { name: '上移 欧洲', exact: true })).toBeDisabled();
  await dialog
    .getByRole('button', { name: '拖动排序 未分组', exact: true })
    .dragTo(dialog.locator('.group-manager-row').filter({ hasText: '亚洲' }));
  await expect(dialog.locator('.group-manager-row strong')).toHaveText(['欧洲', '未分组', '亚洲']);
  await expect(dialog.getByRole('status')).toContainText('排序已保存');
  await expect(dialog.getByRole('button', { name: '编辑 未分组', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '删除 未分组', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await expect(names(page)).toHaveText(['欧洲二', '欧洲一', '未分组节点', '亚洲三', '亚洲一', '亚洲二']);
  await page.goto('/');
  await expect(page.locator('.monitor-name')).toHaveText([
    '欧洲二',
    '欧洲一',
    '未分组节点',
    '亚洲三',
    '亚洲一',
    '亚洲二',
  ]);
  await expect(page.getByLabel('按分组筛选').locator('option')).toHaveText([
    '全部分组',
    '欧洲',
    '未分组',
    '亚洲',
  ]);
  await page.getByLabel('按分组筛选').selectOption(a.id);
  await expect(page.locator('.monitor-name')).toHaveText(['亚洲三', '亚洲一', '亚洲二']);
});

test('buttons support keyboard, mobile layouts and both languages', async ({ page, request }, info) => {
  const a = await group(request, '应用服务与数据库');
  await group(request, '欧洲备用区域');
  await createMonitor(request, { name: '应用服务', groupId: a.id });
  await createMonitor(request, { name: '数据库', groupId: a.id });
  await createMonitor(request, { name: '备用节点一' });
  await createMonitor(request, { name: '备用节点二' });
  await page.goto('/admin');
  const move = page.getByRole('button', { name: '上移 数据库', exact: true });
  await move.focus();
  await page.keyboard.press('Enter');
  await saved(page);
  await expect(names(page)).toHaveText(['数据库', '应用服务', '备用节点一', '备用节点二']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '上移 备用节点二', exact: true }).click();
  await saved(page);
  await expect(names(page)).toHaveText(['数据库', '应用服务', '备用节点二', '备用节点一']);
  await checkPageLayout(page, info, 'ordering-zh');
  await selectLanguage(page, 'en');
  await page.getByRole('button', { name: 'Move down 数据库', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Order saved.' })).toBeVisible();
  await checkPageLayout(page, info, 'ordering-en');
  await page.getByRole('button', { name: 'Manage groups', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Manage groups', exact: true });
  await dialog.getByRole('button', { name: 'Move up 欧洲备用区域', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Order saved.');
  await checkDialogLayout(page, dialog, info, 'ordering-groups-en');
});

for (const kind of ['groups', 'monitors'] as const) {
  test(`${kind} rolls back failed saves and refreshes after a conflict`, async ({ page, request }) => {
    if (kind === 'groups') {
      await group(request, '第一项');
      await group(request, '第二项');
    } else {
      await createMonitor(request, { name: '第一项' });
      await createMonitor(request, { name: '第二项' });
    }
    await page.goto('/admin');
    if (kind === 'groups') await page.getByRole('button', { name: '分组管理', exact: true }).click();
    const rows = kind === 'groups' ? page.locator('.group-manager-row strong') : names(page);
    const endpoint = `**/api/admin/${kind}/order`;
    let held!: Route;
    await page.route(endpoint, (route) => {
      held = route;
    });
    await page.getByRole('button', { name: '上移 第二项', exact: true }).click();
    const withUngrouped = (values: string[]) => (kind === 'groups' ? [...values, '未分组'] : values);
    await expect(rows).toHaveText(withUngrouped(['第二项', '第一项']));
    await expect(page.getByRole('button', { name: '下移 第二项', exact: true })).toBeDisabled();
    await expect.poll(() => Boolean(held)).toBe(true);
    await held.fulfill({ status: 503, json: { code: 'service_unavailable' } });
    await expect(page.getByRole('alert')).toContainText('服务暂时不可用，请稍后重试。');
    await expect(rows).toHaveText(withUngrouped(['第一项', '第二项']));
    await page.unroute(endpoint);

    const response = await request.get('/api/admin/monitors');
    const latest = (await response.json()) as AdminResponse;
    const items = orderItems(
      kind === 'groups'
        ? [...latest.groups].reverse().concat({ ...latest.ungrouped, name: '' })
        : [...latest.monitors].reverse(),
    );
    expect(
      (
        await request.put(`/api/admin/${kind}/order`, { headers: origin, data: { groupId: null, items } })
      ).status(),
    ).toBe(200);
    await page.getByRole('button', { name: '上移 第二项', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('列表或顺序已变更');
    await expect(rows).toHaveText(withUngrouped(['第二项', '第一项']));
  });
}

test('ignores a stale in-flight refresh and pauses refresh while saving', async ({ page, request }) => {
  await createMonitor(request, { name: '第一项' });
  await createMonitor(request, { name: '第二项' });
  await page.clock.install();
  await page.goto('/admin');
  await expect(names(page)).toHaveText(['第一项', '第二项']);
  await expect(page.locator('.refresh-button')).toHaveAttribute('aria-busy', 'false');
  const old = await (await request.get('/api/admin/monitors')).json();
  let stale!: Route;
  let reads = 0;
  await page.route('**/api/admin/monitors', (route) => {
    if (++reads === 1) stale = route;
    else return route.continue();
  });
  await page.clock.runFor(30_000);
  await expect.poll(() => Boolean(stale)).toBe(true);
  let write!: Route;
  await page.route('**/api/admin/monitors/order', (route) => {
    write = route;
  });
  await page.getByRole('button', { name: '上移 第二项', exact: true }).click();
  await expect(names(page)).toHaveText(['第二项', '第一项']);
  await expect(page.getByRole('button', { name: '折叠 未分组', exact: true })).toBeDisabled();
  await stale.fulfill({ json: old }).catch(() => {}); // The suspended request may already be aborted.
  await page.clock.runFor(60_000);
  expect(reads).toBe(1);
  await expect(names(page)).toHaveText(['第二项', '第一项']);
  await expect.poll(() => Boolean(write)).toBe(true);
  await write.continue();
  await saved(page);
  await expect(page.getByRole('button', { name: '折叠 未分组', exact: true })).toBeEnabled();
  expect(reads).toBeGreaterThan(1);
  await expect(names(page)).toHaveText(['第二项', '第一项']);
  await page.reload();
  await expect(names(page)).toHaveText(['第二项', '第一项']);
});

test('cancelled drags resume refresh without writing a new order', async ({ page, request }) => {
  await createMonitor(request, { name: '第一项' });
  await createMonitor(request, { name: '第二项' });
  await page.clock.install();
  await page.goto('/admin');
  await expect(names(page)).toHaveText(['第一项', '第二项']);
  const handle = page.getByRole('button', { name: '拖动排序 第一项', exact: true });
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x - 20, bounds.y + bounds.height / 2, { steps: 5 });
  await expect(page.getByRole('button', { name: '分组管理', exact: true })).toBeDisabled();
  const refreshed = page.waitForResponse((response) => response.url().endsWith('/api/admin/monitors'));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await refreshed;
  await expect(page.getByRole('button', { name: '分组管理', exact: true })).toBeEnabled();
  await expect(names(page)).toHaveText(['第一项', '第二项']);
  const next = page.waitForResponse((response) => response.url().endsWith('/api/admin/monitors'));
  await page.clock.runFor(30_000);
  await next;
});
