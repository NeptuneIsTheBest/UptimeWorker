import { test, expect, createMonitor, origin } from './fixtures';

const localTime = (time: number) => {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

test('admin manages groups, publishes multi-node maintenance and follows progress on public pages', async ({
  page,
  request,
}) => {
  const first = await createMonitor(request, { name: '香港节点', wafBypassEnabled: false });
  const second = await createMonitor(request, { name: '东京节点', wafBypassEnabled: false });
  await page.goto('/admin');
  await page.getByRole('button', { name: '分组管理', exact: true }).click();
  const groups = page.getByRole('dialog', { name: '分组管理' });
  await groups.getByLabel('分组名称').fill('亚洲区域');
  await groups.getByLabel('排序', { exact: true }).fill('1');
  await groups.getByRole('button', { name: '保存分组', exact: true }).click();
  await expect(groups.getByRole('button', { name: '编辑 亚洲区域', exact: true })).toBeVisible();
  await groups.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '编辑 香港节点', exact: true }).click();
  const monitor = page.getByRole('dialog', { name: '编辑监控' });
  await monitor.getByLabel('所属分组').selectOption({ label: '亚洲区域' });
  await monitor.getByRole('button', { name: '保存监控' }).click();
  await expect(page.locator('.admin-card').filter({ hasText: '香港节点' })).toContainText('亚洲区域');
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.getByRole('button', { name: '发布事件', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '发布事件' });
  await editor.getByLabel('事件标题').fill('网络设备升级');
  await editor.getByLabel('事件正文').fill('升级网络设备，期间可能短暂断开。\n我们会同步进度。');
  await editor.getByLabel('事件类型').selectOption('maintenance');
  await editor.getByLabel('香港节点', { exact: true }).check();
  await editor.getByLabel('东京节点', { exact: true }).check();
  await editor.getByLabel('计划开始时间').fill(localTime(Date.now() - 60_000));
  await editor.getByLabel('计划结束时间').fill(localTime(Date.now() + 3_600_000));
  await editor.getByRole('button', { name: '发布事件', exact: true }).click();
  const card = page.locator('.event-card').filter({ hasText: '网络设备升级' });
  await expect(card).toContainText('维护进行中');
  await card.getByRole('button', { name: '追加进展' }).click();
  const progress = page.getByRole('dialog', { name: '追加事件进展' });
  await progress.getByLabel('进展说明').fill('升级完成，所有节点恢复正常。');
  await progress.getByLabel('同时标记事件已完成').check();
  await progress.getByRole('button', { name: '保存进展' }).click();
  await expect(card.locator('.event-status')).toHaveText('已完成');
  await page.goto('/');
  await expect(page.locator('.group-heading').first()).toContainText('亚洲区域');
  await page.getByLabel('按分组筛选').selectOption({ label: '亚洲区域' });
  await expect(page.locator('.monitor-card')).toHaveCount(1);
  await expect(page.locator('.monitor-card')).toContainText('香港节点');
  await expect(page.locator('.event-card')).toContainText('网络设备升级');
  await page.locator('.event-progress summary').click();
  await expect(page.locator('.event-progress')).toContainText('升级完成');
  for (const id of [first.id, second.id]) {
    await page.goto(`/monitors/${id}`);
    await expect(page.getByRole('heading', { name: '关联事件', exact: true })).toBeVisible();
    await expect(page.locator('.event-card')).toContainText('网络设备升级');
    await expect(page.getByRole('heading', { name: '最近检测', exact: true })).toHaveCount(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/admin');
  await page.getByRole('button', { name: '分组管理', exact: true }).click();
  await groups.getByRole('button', { name: '编辑 亚洲区域', exact: true }).click();
  await groups.getByLabel('分组名称').fill('亚太区域');
  await groups.getByRole('button', { name: '保存分组' }).click();
  await groups.getByRole('button', { name: '删除 亚太区域', exact: true }).click();
  await groups.getByRole('button', { name: '确认删除分组' }).click();
  await expect(groups.getByRole('button', { name: '编辑 亚太区域', exact: true })).toHaveCount(0);
  await groups.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.admin-card').filter({ hasText: '香港节点' })).toContainText('未分组');
});

test('event drafts survive refresh, editing persists, and the global threshold is configurable', async ({
  page,
  request,
}) => {
  const monitor = await createMonitor(request, { name: '草稿节点' });
  await page.clock.install();
  await page.goto('/admin');
  await page.getByRole('button', { name: '全局设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '全局设置' });
  await expect(settings.getByLabel('连续离线阈值（分钟）')).toHaveValue('5');
  await settings.getByLabel('连续离线阈值（分钟）').fill('12');
  await settings.getByRole('button', { name: '保存设置' }).click();
  const response = await request.get('/api/admin/settings');
  expect((await response.json()).autoIncidentAfterMinutes).toBe(12);
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.getByRole('button', { name: '发布事件', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '发布事件' });
  await editor.getByLabel('事件标题').fill('保留未保存的草稿');
  await editor.getByLabel('事件正文').fill('<script>alert("text")</script>\n连接故障排查中');
  await editor.getByLabel('草稿节点', { exact: true }).check();
  const refreshed = page.waitForResponse(
    (value) => value.url().endsWith('/api/admin/events') && value.request().method() === 'GET',
  );
  await page.clock.runFor(31_000);
  await refreshed;
  await expect(editor.getByLabel('事件标题')).toHaveValue('保留未保存的草稿');
  await editor.getByRole('button', { name: '发布事件', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.locator('.event-card').getByRole('button', { name: '编辑事件' }).click();
  const editing = page.getByRole('dialog', { name: '编辑事件' });
  await editing.getByLabel('事件标题').fill('连接故障排查');
  await editing.getByRole('button', { name: '保存事件' }).click();
  await expect(page.locator('.event-card')).toContainText('连接故障排查');
  await page.goto(`/monitors/${monitor.id}`);
  await expect(page.locator('.event-body').first()).toContainText('<script>');
  await page.goto('/admin');
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.locator('.event-card').getByRole('button', { name: '删除事件' }).click();
  await page.getByRole('dialog', { name: '删除事件' }).getByRole('button', { name: '确认删除事件' }).click();
  await expect(page.getByRole('heading', { name: '暂无关联事件', exact: true })).toBeVisible();
});

test('admin can page through older events', async ({ page, request }) => {
  const monitor = await createMonitor(request);
  for (let index = 0; index < 21; index++) {
    const response = await request.post('/api/admin/events', {
      headers: origin,
      data: {
        title: `记录 ${index}`,
        body: '故障进展',
        type: 'incident',
        monitorIds: [monitor.id],
      },
    });
    expect(response.status()).toBe(201);
  }
  await page.goto('/admin');
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await expect(page.locator('.event-card')).toHaveCount(20);
  await page.getByRole('button', { name: '更早事件' }).click();
  await expect(page.locator('.event-card')).toHaveCount(1);
  await page.getByRole('button', { name: '返回最新' }).click();
  await expect(page.locator('.event-card')).toHaveCount(20);
});
