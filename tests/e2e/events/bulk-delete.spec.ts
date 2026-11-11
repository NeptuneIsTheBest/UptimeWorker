import type { APIRequestContext, Page } from '@playwright/test';
import type { AdminEvent, EventBulkDeleteRequest, EventsResponse } from '../../../src/shared/events/types';
import { test, expect, createMonitor, origin } from '../support/fixtures';
import { checkDialogLayout, checkPageLayout } from '../support/layout';

async function publish(request: APIRequestContext, monitorId: string, title: string, closed = false) {
  const response = await request.post('/api/admin/events', {
    headers: origin,
    data: { title, body: '事件说明', type: 'incident', monitorIds: [monitorId] },
  });
  expect(response.status()).toBe(201);
  const event = (await response.json()) as AdminEvent;
  if (!closed) return event;
  const resolved = await request.post(`/api/admin/events/${event.id}/updates`, {
    headers: origin,
    data: { version: event.version, title: 'Resolved', body: '已恢复' },
  });
  expect(resolved.status()).toBe(200);
  return (await resolved.json()) as AdminEvent;
}

async function openManager(page: Page, language: 'zh' | 'en' = 'zh') {
  await page.goto('/admin');
  await page.getByRole('tab', { name: language === 'zh' ? '事件' : 'Events', exact: true }).click();
  await expect(page.locator('.event-manager .loading')).toHaveCount(0);
}

const sampleEvent = (id: string): AdminEvent => ({
  id,
  title: id,
  version: 1,
  body: '事件说明',
  type: 'incident',
  source: 'manual',
  status: 'open',
  startsAt: null,
  endsAt: null,
  startedAt: Date.now(),
  endedAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  monitors: [],
  updates: [],
});

test('selects eligible events across both sections, confirms titles, and deletes only the selection', async ({
  page,
  request,
}, info) => {
  const monitor = await createMonitor(request);
  const open = await publish(request, monitor.id, '手动故障');
  const closed = await publish(request, monitor.id, '历史事件' + '长标题'.repeat(30), true);
  const automatic: AdminEvent = {
    ...open,
    id: 'open-automatic',
    title: '节点 服务异常',
    source: 'automatic',
  };
  await page.route(/\/api\/admin\/events(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const listing = (await response.json()) as EventsResponse;
    await route.fulfill({ json: { ...listing, events: [...listing.events, automatic] } });
  });
  await openManager(page);
  const manager = page.locator('.event-manager');
  const all = manager.getByRole('checkbox', { name: '全选本页可删除事件', exact: true });
  const bulk = manager.getByRole('button', { name: '批量删除', exact: true });
  const first = manager.getByRole('checkbox', { name: `选择「${open.title}」`, exact: true });
  await expect(bulk).toBeDisabled();
  await expect(manager.getByRole('checkbox', { name: '选择「节点 服务异常」', exact: true })).toBeDisabled();
  await expect(manager.getByText('进行中的自动事件无法删除', { exact: true })).toBeVisible();
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toBeChecked();
  await expect(all).toHaveJSProperty('indeterminate', true);
  await expect(manager.getByText('已选 1 条', { exact: true })).toBeVisible();
  await manager.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(first).not.toBeChecked();
  await all.check();
  await expect(manager.getByText('已选 2 条', { exact: true })).toBeVisible();
  await expect(all).toHaveJSProperty('indeterminate', false);
  await checkPageLayout(page, info, 'bulk-selection-zh');
  await bulk.click();
  const dialog = page.getByRole('dialog', { name: '批量删除', exact: true });
  await expect(dialog).toContainText('确定永久删除选中的 2 条事件及其全部进展记录？');
  expect(await dialog.locator('li').allTextContents()).toEqual(
    expect.arrayContaining([open.title, closed.title]),
  );
  await checkDialogLayout(page, dialog, info, 'bulk-confirmation-zh');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(all).toBeChecked();
  expect((await request.get(`/api/admin/events/${open.id}`)).status()).toBe(200);
  await bulk.click();
  const submitted = page.waitForRequest((request) => request.url().endsWith('/api/admin/events/bulk-delete'));
  await dialog.getByRole('button', { name: '确认批量删除', exact: true }).click();
  expect((await submitted).postDataJSON()).toEqual({
    items: expect.arrayContaining([
      { id: open.id, version: open.version },
      { id: closed.id, version: closed.version },
    ]),
  });
  await expect(dialog).toHaveCount(0);
  await expect(manager.getByText('已删除 2 条事件。', { exact: true })).toBeVisible();
  await expect(manager.locator('.event-card')).toHaveCount(1);
  await expect(all).toBeDisabled();
  await expect(bulk).toBeDisabled();
  for (const event of [open, closed])
    expect((await request.get(`/api/events/${event.id}`)).status()).toBe(404);
  await page.goto('/');
  await expect(page.locator('.event-selection, .event-bulk-controls')).toHaveCount(0);
});

test('clears selection on every pagination action and returns to the newest page after deletion', async ({
  page,
  request,
}) => {
  const monitor = await createMonitor(request);
  const active = await publish(request, monitor.id, '保留在每页的进行中事件');
  for (let index = 0; index < 21; index++) await publish(request, monitor.id, `历史 ${index}`, true);
  await openManager(page);
  const manager = page.locator('.event-manager');
  const all = manager.getByRole('checkbox', { name: '全选本页可删除事件', exact: true });
  const history = manager.getByRole('region', { name: '历史事件', exact: true });
  const count = (value: number) => manager.getByText(`已选 ${value} 条`, { exact: true });
  await expect(history.locator('.event-card')).toHaveCount(20);
  await all.check();
  await expect(count(21)).toBeVisible();
  await manager.getByRole('button', { name: '更早事件', exact: true }).click();
  await expect(history.locator('.event-card')).toHaveCount(1);
  await expect(count(0)).toBeVisible();
  await all.check();
  await manager.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(history.locator('.event-card')).toHaveCount(20);
  await expect(count(0)).toBeVisible();
  await manager.getByRole('button', { name: '更早事件', exact: true }).click();
  await expect(history.locator('.event-card')).toHaveCount(1);
  await all.check();
  await manager.getByRole('button', { name: '返回最新', exact: true }).click();
  await expect(history.locator('.event-card')).toHaveCount(20);
  await expect(count(0)).toBeVisible();
  await manager.getByRole('button', { name: '更早事件', exact: true }).click();
  await expect(history.locator('.event-card')).toHaveCount(1);
  await all.check();
  await expect(count(2)).toBeVisible();
  await manager.getByRole('button', { name: '批量删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认批量删除', exact: true }).click();
  await expect(manager.getByText('已删除 2 条事件。', { exact: true })).toBeVisible();
  await expect(history.locator('.event-card')).toHaveCount(20);
  await expect(manager.getByRole('button', { name: '上一页', exact: true })).toHaveCount(0);
  await expect(manager.getByRole('button', { name: '更早事件', exact: true })).toHaveCount(0);
  await expect(count(0)).toBeVisible();
  expect((await request.get(`/api/events/${active.id}`)).status()).toBe(404);
});

test('refresh keeps only visible eligible selections with unchanged versions and never selects arriving events', async ({
  page,
}) => {
  await page.clock.install();
  const original = ['未变更', '已变更', '已移出本页', '变为不可删除'].map(sampleEvent);
  let events = original;
  await page.route(/\/api\/admin\/events(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { events, nextCursor: null, pageRefreshSeconds: 30 } }),
  );
  await openManager(page);
  const manager = page.locator('.event-manager');
  const all = manager.getByRole('checkbox', { name: '全选本页可删除事件', exact: true });
  await all.check();
  await expect(manager.getByText('已选 4 条', { exact: true })).toBeVisible();
  events = [
    original[0],
    { ...original[1], version: 2 },
    { ...original[3], source: 'automatic', title: '变为不可删除 服务异常' },
    sampleEvent('新增事件'),
  ];
  await page.clock.runFor(31_000);
  await expect(manager.getByText('已选 1 条', { exact: true })).toBeVisible();
  await expect(manager.getByRole('checkbox', { name: '选择「未变更」', exact: true })).toBeChecked();
  await expect(manager.getByRole('checkbox', { name: '选择「已变更」', exact: true })).not.toBeChecked();
  await expect(manager.getByRole('checkbox', { name: '选择「新增事件」', exact: true })).not.toBeChecked();
  await expect(
    manager.getByRole('checkbox', { name: '选择「变为不可删除 服务异常」', exact: true }),
  ).toBeDisabled();
  await expect(all).toHaveJSProperty('indeterminate', true);
  events = original;
  await page.clock.runFor(31_000);
  await expect(manager.getByRole('checkbox', { name: '选择「已移出本页」', exact: true })).toBeVisible();
  await expect(manager.getByRole('checkbox', { name: '选择「已移出本页」', exact: true })).not.toBeChecked();
  await expect(manager.getByText('已选 1 条', { exact: true })).toBeVisible();
});

test('freezes confirmation versions, clears a conflicting batch, and retains a failed request for retry without duplicate submission', async ({
  page,
  request,
}) => {
  await page.clock.install();
  const monitor = await createMonitor(request);
  const first = await publish(request, monitor.id, '并发变更');
  const second = await publish(request, monitor.id, '保持不变');
  await openManager(page);
  const manager = page.locator('.event-manager');
  const all = manager.getByRole('checkbox', { name: '全选本页可删除事件', exact: true });
  const bulk = manager.getByRole('button', { name: '批量删除', exact: true });
  const dialog = page.getByRole('dialog', { name: '批量删除', exact: true });
  await all.check();
  await bulk.click();
  expect(
    (
      await request.post(`/api/admin/events/${first.id}/updates`, {
        headers: origin,
        data: { version: first.version, title: 'Updated', body: '并发进展' },
      })
    ).status(),
  ).toBe(200);
  await page.clock.runFor(31_000);
  await expect(manager.getByText('已选 1 条', { exact: true })).toBeAttached();
  await expect(dialog).toContainText('确定永久删除选中的 2 条事件');
  const submitted = page.waitForRequest((request) => request.url().endsWith('/api/admin/events/bulk-delete'));
  await dialog.getByRole('button', { name: '确认批量删除', exact: true }).click();
  expect(((await submitted).postDataJSON() as EventBulkDeleteRequest).items).toContainEqual({
    id: first.id,
    version: first.version,
  });
  await expect(dialog).toHaveCount(0);
  await expect(manager.getByRole('alert')).toContainText('本次未删除任何事件');
  await expect(manager.getByText('已选 0 条', { exact: true })).toBeVisible();
  expect((await request.get(`/api/events/${second.id}`)).status()).toBe(200);

  const submissions: EventBulkDeleteRequest[] = [];
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/admin/events/bulk-delete', async (route) => {
    submissions.push(route.request().postDataJSON() as EventBulkDeleteRequest);
    if (submissions.length === 1) await route.abort('failed');
    else {
      await gate;
      await route.continue();
    }
  });
  await all.check();
  await bulk.click();
  await dialog.getByRole('button', { name: '确认批量删除', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('网络连接失败');
  await expect(dialog.locator('li')).toHaveCount(2);
  await dialog.getByRole('button', { name: '确认批量删除', exact: true }).click();
  try {
    await expect(dialog.getByRole('button', { name: '正在删除…', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Enter');
  } finally {
    release();
  }
  await expect(dialog).toHaveCount(0);
  await expect(manager.getByText('已删除 2 条事件。', { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  expect(submissions[1].items).toContainEqual({ id: first.id, version: first.version + 1 });
});

test.describe('English bulk deletion', () => {
  test.use({ locale: 'en-US' });
  test('localizes selection, confirmation and success on narrow screens', async ({ page, request }, info) => {
    const monitor = await createMonitor(request);
    const first = await publish(request, monitor.id, 'Current incident');
    await publish(request, monitor.id, 'Previous incident', true);
    await openManager(page, 'en');
    const manager = page.locator('.event-manager');
    await manager.getByRole('checkbox', { name: `Select “${first.title}”`, exact: true }).check();
    await expect(manager.getByText('1 event selected', { exact: true })).toBeVisible();
    await manager
      .getByRole('checkbox', { name: 'Select all deletable events on this page', exact: true })
      .check();
    await expect(manager.getByText('2 events selected', { exact: true })).toBeVisible();
    await checkPageLayout(page, info, 'bulk-selection-en');
    await manager.getByRole('button', { name: 'Bulk delete', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Bulk delete', exact: true });
    await expect(dialog).toContainText('Permanently delete the 2 selected events and all of their updates?');
    await checkDialogLayout(page, dialog, info, 'bulk-confirmation-en');
    await dialog.getByRole('button', { name: 'Confirm bulk deletion', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(manager.getByText('Deleted 2 events.', { exact: true })).toBeVisible();
  });
});
