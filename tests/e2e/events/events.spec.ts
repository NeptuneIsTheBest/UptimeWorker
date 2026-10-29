import { checkDialogLayout } from '../support/layout';
import { test, expect, createMonitor, origin } from '../support/fixtures';
import type { PublicMonitor } from '../../../src/shared/monitors/types';
import type { StatusEvent } from '../../../src/shared/events/types';

const localTime = (time: number) => {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

test('admin manages groups, publishes multi-node maintenance and follows progress on public pages', async ({
  page,
  request,
}, info) => {
  const first = await createMonitor(request, { name: '香港节点', wafBypassEnabled: false });
  const second = await createMonitor(request, { name: '东京节点', wafBypassEnabled: false });
  await page.goto('/admin');
  await page.getByRole('button', { name: '分组管理', exact: true }).click();
  const groups = page.getByRole('dialog', { name: '分组管理' });
  await groups.getByLabel('分组名称').fill('亚洲区域');
  await groups.getByLabel('排序', { exact: true }).fill('1');
  await groups.getByRole('button', { name: '保存分组', exact: true }).click();
  await expect(groups.getByRole('button', { name: '编辑 亚洲区域', exact: true })).toBeVisible();
  await checkDialogLayout(page, groups, info, 'groups-zh-CN');
  await groups.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '编辑 香港节点', exact: true }).click();
  const monitor = page.getByRole('dialog', { name: '编辑监控' });
  await monitor.getByLabel('所属分组').selectOption({ label: '亚洲区域' });
  await checkDialogLayout(page, monitor, info, 'monitor-editor-zh-CN');
  await monitor.getByRole('button', { name: '保存监控' }).click();
  await expect(page.locator('.admin-card').filter({ hasText: '香港节点' })).toContainText('亚洲区域');
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.getByRole('button', { name: '发布事件', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '发布事件' });
  await editor.getByLabel('事件标题').fill('网络设备升级');
  await editor.getByLabel('事件正文').fill('升级网络设备，期间可能短暂断开。\n我们会同步进度。');
  await editor.getByLabel('事件类型').selectOption('maintenance');
  await checkDialogLayout(page, editor, info, 'event-editor-zh-CN');
  await editor.getByLabel('香港节点', { exact: true }).check();
  await editor.getByLabel('东京节点', { exact: true }).check();
  await editor.getByLabel('计划开始时间').fill(localTime(Date.now() - 60_000));
  await editor.getByLabel('计划结束时间').fill(localTime(Date.now() + 3_600_000));
  await editor.getByRole('button', { name: '发布事件', exact: true }).click();
  const card = page.locator('.event-card').filter({ hasText: '网络设备升级' });
  await expect(card).toContainText('维护进行中');
  await expect(card.getByRole('heading', { name: '计划维护', exact: true })).toBeVisible();
  await expect(card.locator('.event-body')).toContainText('升级网络设备');
  await card.getByRole('button', { name: '追加进展' }).click();
  const progress = page.getByRole('dialog', { name: '追加事件进展' });
  await checkDialogLayout(page, progress, info, 'progress-zh-CN');
  await expect(progress.getByLabel('进展阶段')).toHaveValue('Updated');
  await expect(progress.getByLabel('进展阶段').locator('option')).toHaveText([
    '计划维护',
    '进展更新',
    '维护进行中',
    '维护完成',
  ]);
  await progress.getByLabel('进展阶段').selectOption('In Progress');
  await progress.getByLabel('进展说明').fill('正在升级网络设备。');
  await progress.getByRole('button', { name: '保存进展' }).click();
  await expect(progress).toHaveCount(0);
  await card.getByRole('button', { name: '追加进展' }).click();
  await progress.getByLabel('进展阶段').selectOption('Completed');
  await progress.getByLabel('进展说明').fill('升级完成，所有节点恢复正常。');
  await progress.getByRole('button', { name: '保存进展' }).click();
  await expect(card.locator('.event-status')).toHaveText('已完成');
  await expect(card.getByRole('heading', { name: '维护完成', exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.locator('.group-heading').first()).toContainText('亚洲区域');
  await page.getByLabel('按分组筛选').selectOption({ label: '亚洲区域' });
  await expect(page.locator('.monitor-card')).toHaveCount(1);
  await expect(page.locator('.monitor-card')).toContainText('香港节点');
  await expect(page.locator('.event-card')).toContainText('网络设备升级');
  await expect(page.locator('.event-latest')).toContainText('升级完成');
  await expect(page.locator('.event-card')).not.toContainText('正在升级网络设备。');
  await expect(page.locator('.event-card')).not.toContainText('我们会同步进度。');
  await page.getByRole('link', { name: '查看时间线', exact: true }).click();
  await expect(page).toHaveURL(/\/events\//);
  await expect(page.locator('.event-timeline h3')).toHaveText(['维护完成', '维护进行中', '计划维护']);
  await expect(page.locator('.event-timeline')).toContainText('我们会同步进度。');
  await page.reload();
  await expect(page.locator('.event-timeline h3')).toHaveText(['维护完成', '维护进行中', '计划维护']);
  for (const id of [first.id, second.id]) {
    await page.goto(`/monitors/${id}`);
    await expect(page.getByRole('heading', { name: '历史事件', exact: true })).toBeVisible();
    await expect(page.locator('.event-card')).toContainText('网络设备升级');
    await expect(page.getByRole('heading', { name: '维护完成', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '查看时间线', exact: true })).toHaveAttribute(
      'href',
      /\/events\//,
    );
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

test('fixed stages and completion drafts survive refresh and failed submission', async ({
  page,
  request,
}, testInfo) => {
  const monitor = await createMonitor(request, { name: '跟进节点' });
  const response = await request.post('/api/admin/events', {
    headers: origin,
    data: { title: '连接故障', body: '开始排查', type: 'incident', monitorIds: [monitor.id] },
  });
  expect(response.status()).toBe(201);
  const event = (await response.json()) as { id: string };
  await page.clock.install();
  await page.goto('/admin');
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.getByRole('button', { name: '追加进展', exact: true }).click();
  const progress = page.getByRole('dialog', { name: '追加事件进展' });
  const title = 'Resolved';
  const body = '<img src=x onerror=alert("body")>\n已部署修复\n继续观察';
  await expect(progress.getByRole('textbox', { name: /进展标题/ })).toHaveCount(0);
  await expect(progress.getByLabel('进展阶段')).toHaveValue('Updated');
  await expect(progress.getByLabel('进展阶段').locator('option')).toHaveText([
    '正在排查',
    '已定位问题',
    '持续观察',
    '进展更新',
    '故障恢复',
  ]);
  await progress.getByLabel('进展阶段').selectOption(title);
  await progress.getByLabel('进展说明').fill(body);
  await expect(progress.getByRole('checkbox')).toHaveCount(0);
  const refreshed = page.waitForResponse((value) => value.url().endsWith('/api/admin/events'));
  await page.clock.runFor(31_000);
  await refreshed;
  await expect(progress.getByLabel('进展阶段')).toHaveValue(title);
  await expect(progress.getByLabel('进展说明')).toHaveValue(body);

  const endpoint = `**/api/admin/events/${event.id}/updates`;
  await page.route(endpoint, (route) => route.fulfill({ status: 503, json: { error: '保存暂时失败' } }));
  await progress.getByRole('button', { name: '保存进展' }).click();
  await expect(progress.getByRole('alert')).toContainText('保存暂时失败');
  await expect(progress.getByLabel('进展阶段')).toHaveValue(title);
  await expect(progress.getByLabel('进展说明')).toHaveValue(body);
  await page.unroute(endpoint);
  await progress.getByRole('button', { name: '保存进展' }).click();
  await expect(progress).toHaveCount(0);
  await expect(page.locator('.event-status')).toHaveText('已恢复');
  await expect(page.locator('.event-latest h4')).toHaveText('故障恢复');
  await expect(page.locator('.event-latest img')).toHaveCount(0);
  const saved = await request.get(`/api/admin/events/${event.id}`);
  expect(await saved.json()).toMatchObject({
    title: '连接故障',
    status: 'resolved',
    updates: [{ title, body, status: 'resolved' }],
  });
  await page.getByRole('button', { name: '追加进展', exact: true }).click();
  await expect(progress.getByLabel('进展阶段').locator('option')).toHaveText(['进展更新']);
  await progress.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('link', { name: '查看时间线', exact: true }).click();
  await expect(page.locator('.event-timeline h3')).toHaveText(['故障恢复', '正在排查']);
  await expect(page.locator('.event-timeline img')).toHaveCount(0);
  await expect(page.locator('.event-timeline .event-body').first()).toHaveText(body);
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`progress-title-${width}.png`), fullPage: true });
  }
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
  await expect(page.getByText('暂无关联事件', { exact: true })).toBeVisible();
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
  for (const path of ['/', `/monitors/${monitor.id}`]) {
    await page.goto(path);
    await expect(page.getByRole('region', { name: '进行中与计划事件' }).locator('.event-card')).toHaveCount(
      21,
    );
    await expect(page.getByText('暂无历史事件', { exact: true })).toBeVisible();
  }
});

for (const view of ['overview', 'detail'] as const) {
  test(`${view} keeps open events prominent and moves them to history after refresh`, async ({
    page,
  }, testInfo) => {
    const now = Date.UTC(2026, 9, 28, 2, 0);
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    const monitor: PublicMonitor = {
      id: 'event-node',
      name: '事件节点',
      type: 'http',
      status: 'up',
      intervalMinutes: 5,
      lastCheckedAt: now,
      latencyMs: 42,
      uptime30d: 100,
      days: [],
    };
    const makeEvent = (id: string, title: string, changes: Partial<StatusEvent> = {}): StatusEvent => ({
      id,
      title,
      body: '事件说明\n我们会持续同步进展。',
      type: 'incident',
      source: 'manual',
      status: 'open',
      startsAt: null,
      endsAt: null,
      startedAt: now - 120_000,
      endedAt: null,
      createdAt: now - 120_000,
      updatedAt: now - 60_000,
      monitors: [{ id: monitor.id, name: monitor.name }],
      updates: [],
      ...changes,
    });
    let events = [
      makeEvent('history', '此前已恢复', { status: 'resolved', endedAt: now, updatedAt: now }),
      makeEvent('automatic', '自动检测故障', { source: 'automatic', updatedAt: now - 30_000 }),
      makeEvent('manual', '人工排查故障', { updatedAt: now - 45_000 }),
      makeEvent('maintenance', '即将进行的维护', {
        type: 'maintenance',
        startsAt: now + 30_000,
        endsAt: now + 60_000,
        updates: [
          {
            id: 'preparation',
            title: null,
            body: '维护准备完成',
            source: 'manual',
            status: null,
            createdAt: now - 60_000,
          },
        ],
      }),
    ];
    const endpoint = view === 'overview' ? '/api/status' : `/api/monitors/${monitor.id}/history`;
    let fail = false;
    await page.route(`**${endpoint}`, (route) =>
      route.fulfill(
        fail
          ? { status: 503, json: { error: '事件刷新暂时失败' } }
          : {
              json: {
                ...(view === 'overview'
                  ? { siteName: 'UptimeWorker', monitors: [monitor] }
                  : { monitor, checks: [] }),
                generatedAt: now,
                pageRefreshSeconds: 30,
                // Older cached responses do not yet include progress titles.
                events: events.map((event) => ({
                  ...event,
                  updates: event.updates.map(({ title: _title, ...update }) => update),
                })),
              },
            },
      ),
    );
    await page.goto(view === 'overview' ? '/' : `/monitors/${monitor.id}`);
    const active = page.getByRole('region', { name: '进行中与计划事件', exact: true });
    const history = page.getByRole('region', { name: '历史事件', exact: true });
    const maintenance = active.locator('.event-card').filter({ hasText: '即将进行的维护' });
    await expect(active.locator('h3')).toHaveText(['自动检测故障', '人工排查故障', '即将进行的维护']);
    await expect(active.locator('.event-status')).toHaveText(['处理中', '处理中', '待开始']);
    await expect(history.locator('h3')).toHaveText(['此前已恢复']);
    await expect(page.locator('.event-card')).toHaveCount(4);
    await expect(maintenance.locator('.event-window')).toContainText('计划时间');
    await expect(maintenance.locator('.event-latest')).toContainText('维护准备完成');
    await expect(maintenance.locator('.event-latest h4')).toHaveText('进展更新');
    for (const [width, height] of [
      [1440, 1000],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      const top = (await active.boundingBox())!;
      const summary = (await page
        .locator(view === 'overview' ? '.status-hero' : '.detail-heading')
        .boundingBox())!;
      if (view === 'overview') {
        expect(summary.y + summary.height).toBeLessThan(top.y);
        const services = (await page.locator('.services-section').boundingBox())!;
        expect(top.y + top.height).toBeLessThan(services.y);
      } else {
        expect(top.y + top.height).toBeLessThan(summary.y);
      }
      if (view === 'detail') {
        const back = (await page.getByRole('link', { name: '返回状态概览' }).boundingBox())!;
        expect(back.y + back.height).toBeLessThan(top.y);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`open-events-${width}.png`), fullPage: true });
    }
    async function nextRefresh() {
      const response = page.waitForResponse((value) => value.url().endsWith(endpoint));
      await page.clock.runFor(30_000);
      await response;
      await expect(page.locator('.refresh-button')).toHaveAttribute('aria-busy', 'false');
    }
    await nextRefresh();
    await expect(maintenance.locator('.event-status')).toHaveText('维护进行中');
    await nextRefresh();
    await expect(maintenance.locator('.event-status')).toHaveText('已过计划时间');
    await expect(active.locator('.event-card')).toHaveCount(3);

    events = events
      .map<StatusEvent>((event) =>
        event.status === 'open'
          ? {
              ...event,
              status: event.id === 'automatic' ? 'stopped' : 'resolved',
              endedAt: now + 60_000,
              updatedAt: now + 60_000,
            }
          : event,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
    fail = true;
    await nextRefresh();
    await expect(page.getByRole('alert')).toContainText('事件刷新暂时失败');
    await expect(active.locator('.event-card')).toHaveCount(3);
    await expect(history.locator('.event-card')).toHaveCount(1);
    fail = false;
    await nextRefresh();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(active).toHaveCount(0);
    await expect(history.locator('h3')).toHaveText([
      '人工排查故障',
      '即将进行的维护',
      '自动检测故障',
      '此前已恢复',
    ]);
    await expect(history.locator('.event-status')).toHaveText(['已恢复', '已完成', '已停止跟踪', '已恢复']);
    await expect(page.locator('.event-card')).toHaveCount(4);
  });
}
