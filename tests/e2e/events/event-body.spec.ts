import type { AdminEvent } from '../../../src/shared/events/types';
import { test, expect, createMonitor } from '../support/fixtures';

const descriptions = {
  Investigating: '相关服务出现异常，我们正在排查原因，后续进展将在此同步。',
  Identified: '已定位问题原因，正在进行修复。',
  Monitoring: '修复已实施，正在持续观察服务运行情况。',
  Resolved: '故障已恢复，相关服务已恢复正常运行。',
  Scheduled: '已安排维护，将在计划时间内进行，期间相关服务可能短暂受影响。',
  'In Progress': '维护已开始，期间相关服务可能短暂受影响。',
  Completed: '维护已完成。',
  Updated: '事件信息已更新，后续进展将在此同步。',
};

for (const scenario of [
  {
    type: 'incident',
    initial: 'Investigating',
    stages: ['Updated', 'Investigating', 'Identified', 'Monitoring', 'Resolved'],
  },
  {
    type: 'maintenance',
    initial: 'Scheduled',
    stages: ['Updated', 'Scheduled', 'In Progress', 'Completed'],
  },
] as const) {
  test(`publishes ${scenario.type} and every allowed stage with generated descriptions`, async ({
    page,
    request,
  }) => {
    await createMonitor(request, { name: '模板节点' });
    await page.goto('/admin');
    await page.getByRole('tab', { name: '事件', exact: true }).click();
    await page.getByRole('button', { name: '发布事件', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '发布事件' });
    await expect(editor.getByLabel('事件正文')).toHaveValue(descriptions.Investigating);
    await editor.getByLabel('事件标题').fill('阶段说明事件');
    await editor.getByLabel('事件类型').selectOption(scenario.type);
    await expect(editor.getByLabel('事件正文')).toHaveValue(descriptions[scenario.initial]);
    await editor.getByLabel('模板节点', { exact: true }).check();
    const created = page.waitForResponse(
      (response) => response.url().endsWith('/api/admin/events') && response.request().method() === 'POST',
    );
    await editor.getByRole('button', { name: '发布事件', exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const event = (await response.json()) as AdminEvent;
    expect(event).toMatchObject({ body: descriptions[scenario.initial], source: 'manual', status: 'open' });

    const card = page.locator('.event-card');
    const progress = page.getByRole('dialog', { name: '追加事件进展' });
    for (const stage of scenario.stages) {
      await card.getByRole('button', { name: '追加进展' }).click();
      await expect(progress.getByLabel('进展阶段')).toHaveValue('Updated');
      await expect(progress.getByLabel('进展说明')).toHaveValue(descriptions.Updated);
      await progress.getByLabel('进展阶段').selectOption(stage);
      await expect(progress.getByLabel('进展说明')).toHaveValue(descriptions[stage]);
      await progress.getByRole('button', { name: '保存进展' }).click();
      await expect(progress).toHaveCount(0);
      await expect(card.locator('.event-body')).toHaveText(descriptions[stage]);
    }

    const saved = await request.get(`/api/admin/events/${event.id}`);
    expect(await saved.json()).toMatchObject({
      status: 'resolved',
      updates: scenario.stages.map((title) => ({ title, body: descriptions[title], source: 'manual' })),
    });
    await card.getByRole('button', { name: '追加进展' }).click();
    await expect(progress.getByLabel('进展阶段').locator('option')).toHaveText(['进展更新']);
    await expect(progress.getByLabel('进展说明')).toHaveValue(descriptions.Updated);
    await progress.getByRole('button', { name: '保存进展' }).click();
    await expect(progress).toHaveCount(0);
    await expect(card.locator('.event-body')).toHaveText(descriptions.Updated);
    const closed = await request.get(`/api/admin/events/${event.id}`);
    expect((await closed.json()).status).toBe('resolved');

    await card.getByRole('link', { name: '查看时间线', exact: true }).click();
    const bodies = [
      descriptions.Updated,
      ...[...scenario.stages].reverse().map((stage) => descriptions[stage]),
      descriptions[scenario.initial],
    ];
    await expect(page.locator('.event-timeline .event-body')).toHaveText(bodies);
    await page.locator('.language-select').selectOption('en');
    await expect(page.locator('.event-timeline .event-body')).toHaveText(bodies);
  });
}

test('preserves manual and saved descriptions, validates blanks, and restores stage defaults', async ({
  page,
  request,
}) => {
  await createMonitor(request, { name: '草稿节点' });
  await page.goto('/admin');
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.getByRole('button', { name: '发布事件', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '发布事件' });
  const body = editor.getByLabel('事件正文');
  const manualBody = '已联系服务提供商，等待进一步回复。';
  await editor.getByLabel('事件标题').fill('手动草稿事件');
  await editor.getByLabel('草稿节点', { exact: true }).check();
  await body.fill(manualBody);
  await editor.getByLabel('事件类型').selectOption('maintenance');
  await expect(body).toHaveValue(manualBody);
  await body.fill('   ');
  await editor.getByRole('button', { name: '发布事件', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('事件正文需为 1–4000 个字符');
  await expect(body).toHaveValue('   ');
  await editor.getByLabel('事件类型').selectOption('incident');
  await expect(body).toHaveValue(descriptions.Investigating);
  await body.fill(manualBody);
  await editor.getByRole('button', { name: '使用阶段说明' }).click();
  await expect(body).toHaveValue(descriptions.Investigating);
  await editor.getByLabel('事件类型').selectOption('maintenance');
  await expect(body).toHaveValue(descriptions.Scheduled);
  await editor.getByRole('button', { name: '发布事件', exact: true }).click();
  await expect(editor).toHaveCount(0);

  await page.getByRole('button', { name: '编辑事件', exact: true }).click();
  const editing = page.getByRole('dialog', { name: '编辑事件' });
  await expect(editing.getByLabel('事件正文')).toHaveValue(descriptions.Scheduled);
  await editing.getByLabel('事件类型').selectOption('incident');
  await expect(editing.getByLabel('事件正文')).toHaveValue(descriptions.Scheduled);
  await editing.getByRole('button', { name: '使用阶段说明' }).click();
  await expect(editing.getByLabel('事件正文')).toHaveValue(descriptions.Investigating);
  await editing.getByRole('button', { name: '保存事件' }).click();
  await expect(editing).toHaveCount(0);
  await expect(page.locator('.event-card .event-body')).toHaveText(descriptions.Investigating);

  await page.getByRole('button', { name: '追加进展', exact: true }).click();
  const progress = page.getByRole('dialog', { name: '追加事件进展' });
  const progressBody = progress.getByLabel('进展说明');
  await progressBody.fill(manualBody);
  await progress.getByLabel('进展阶段').selectOption('Identified');
  await expect(progressBody).toHaveValue(manualBody);
  await progressBody.fill('');
  await progress.getByRole('button', { name: '保存进展' }).click();
  await expect(progress.getByRole('alert')).toContainText('进展说明需为 1–4000 个字符');
  await expect(progressBody).toHaveValue('');
  await progress.getByLabel('进展阶段').selectOption('Monitoring');
  await expect(progressBody).toHaveValue(descriptions.Monitoring);
  await progressBody.fill(manualBody);
  await progress.getByRole('button', { name: '使用阶段说明' }).click();
  await expect(progressBody).toHaveValue(descriptions.Monitoring);
  await progress.getByLabel('进展阶段').selectOption('Resolved');
  await expect(progressBody).toHaveValue(descriptions.Resolved);
  await progress.getByRole('button', { name: '保存进展' }).click();
  await expect(progress).toHaveCount(0);
  await expect(page.locator('.event-status')).toHaveText('已恢复');
  await expect(page.locator('.event-card .event-body')).toHaveText(descriptions.Resolved);
});

test('localizes generated drafts while preserving manual edits and published descriptions', async ({
  page,
  context,
  request,
}) => {
  await createMonitor(request, { name: '双语节点' });
  await page.goto('/admin');
  await page.getByRole('tab', { name: '事件', exact: true }).click();
  await page.getByRole('button', { name: '发布事件', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const body = dialog.locator('textarea');
  await dialog.getByLabel('事件标题').fill('双语事件');
  await dialog.getByLabel('双语节点', { exact: true }).check();
  const other = await context.newPage();
  await other.goto('/');
  const language = other.locator('.language-select');
  await language.selectOption('en');
  const investigating =
    'Affected services are experiencing issues. We are investigating the cause and will share further updates here.';
  const scheduled =
    'Maintenance is scheduled for the planned window. Affected services may experience brief disruptions.';
  await expect(body).toHaveValue(investigating);
  // Returning to identical template text is still a manual edit.
  await body.fill(`${investigating} Extra details.`);
  await body.fill(investigating);
  await language.selectOption('zh-CN');
  await expect(dialog).toHaveAccessibleName('发布事件');
  await expect(body).toHaveValue(investigating);
  await dialog.getByRole('button', { name: '使用阶段说明' }).click();
  await expect(body).toHaveValue(descriptions.Investigating);
  await language.selectOption('en');
  await expect(body).toHaveValue(investigating);
  await dialog.getByLabel('Event type').selectOption('maintenance');
  await expect(body).toHaveValue(scheduled);
  await dialog.getByRole('button', { name: 'Publish event', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await language.selectOption('zh-CN');
  await page.getByRole('button', { name: '编辑事件', exact: true }).click();
  await expect(body).toHaveValue(scheduled);
  await dialog.getByLabel('事件类型').selectOption('incident');
  await expect(body).toHaveValue(scheduled);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  await page.getByRole('button', { name: '追加进展', exact: true }).click();
  await expect(body).toHaveValue(descriptions.Updated);
  await language.selectOption('en');
  await expect(body).toHaveValue('Event information has been updated. Further updates will be shared here.');
  await dialog.getByLabel('Progress stage').selectOption('In Progress');
  await expect(body).toHaveValue(
    'Maintenance has started. Affected services may experience brief disruptions.',
  );
  const manualBody = '维护中，等待检查结果。';
  await body.fill(manualBody);
  await language.selectOption('zh-CN');
  await expect(dialog).toHaveAccessibleName('追加事件进展');
  await expect(body).toHaveValue(manualBody);
  await dialog.getByLabel('进展阶段').selectOption('Completed');
  await expect(body).toHaveValue(manualBody);
  await body.fill('   ');
  await language.selectOption('en');
  await expect(dialog).toHaveAccessibleName('Add event update');
  await expect(body).toHaveValue('   ');
  await dialog.getByLabel('Progress stage').selectOption('Scheduled');
  await expect(body).toHaveValue(scheduled);
  await dialog.getByLabel('Progress stage').selectOption('Completed');
  await expect(body).toHaveValue('Maintenance has been completed.');
  await dialog.getByRole('button', { name: 'Save update', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('link', { name: 'View timeline', exact: true }).click();
  await language.selectOption('zh-CN');
  await expect(page.locator('.event-timeline h3')).toHaveText(['维护完成', '计划维护']);
  await expect(page.locator('.event-timeline .event-body')).toHaveText([
    'Maintenance has been completed.',
    scheduled,
  ]);
  await other.close();
});
