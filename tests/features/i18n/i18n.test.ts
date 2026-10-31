import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatError } from '../../../src/shared/error-messages';
import { ValidationError } from '../../../src/shared/errors';
import { parseGroup } from '../../../src/shared/groups/validation';
import { api } from '../../../src/web/lib/api';
import { elapsedTime, latency, percent } from '../../../src/web/lib/format';
import {
  displayMessage,
  errorMessage,
  message,
  readLocale,
  resolveLocale,
  translate,
} from '../../../src/web/i18n/core';
import {
  eventTime,
  localizedEntryBody,
  localizedEventTitle,
  relativeEventTime,
} from '../../../src/web/features/events/presentation';

afterEach(() => vi.unstubAllGlobals());

describe('language selection and presentation', () => {
  it.each([
    ['en', ['zh-CN'], 'en'],
    ['zh-CN', ['en-US'], 'zh-CN'],
    [null, ['zh-TW', 'en-US'], 'zh-CN'],
    [null, ['en-GB', 'zh-CN'], 'en'],
    ['invalid', ['zh-Hans'], 'zh-CN'],
    [null, ['fr-FR'], 'en'],
    [null, [], 'en'],
  ])('resolves stored %s and browser %j to %s', (saved, languages, expected) => {
    expect(resolveLocale(saved, languages as string[])).toBe(expected);
  });
  it('uses the browser preference when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('Storage disabled');
      },
    });
    vi.stubGlobal('navigator', { languages: ['zh-CN'], language: 'en' });
    expect(readLocale()).toBe('zh-CN');
    vi.stubGlobal('navigator', { languages: [], language: 'en-GB' });
    expect(readLocale()).toBe('en');
  });
  it('re-renders stored messages and nested probe reasons, including singular and plural counts', () => {
    const notice = message('monitor.testFailed', {
      name: 'API 节点',
      reason: message('probe.timeout'),
      latency: '123 ms',
    });
    expect(displayMessage(notice, 'zh-CN')).toBe('API 节点：检测超时（123 ms）');
    expect(displayMessage(notice, 'en')).toBe('API 节点: Check timed out (123 ms)');
    expect(translate('en', 'monitor.interval', { count: 1 })).toBe('Every 1 minute');
    expect(translate('en', 'monitor.interval', { count: 2 })).toBe('Every 2 minutes');
    expect(translate('en', 'status.pausedCount', { count: 0 })).toBe('0 paused monitors');
    expect(translate('zh-CN', 'monitor.interval', { count: 2 })).toBe('每 2 分钟');
  });
  it('formats time and numbers with the selected language', () => {
    expect(elapsedTime(61_000, 'en')).toBe('1 minute 1 second');
    expect(elapsedTime(61_000, 'zh-CN')).toBe('1 分 1 秒');
    expect(elapsedTime(-1000, 'en')).toBe('0 seconds');
    expect(relativeEventTime(0, 120_000, 'en')).toBe('2 minutes ago');
    expect(relativeEventTime(0, 120_000, 'zh-CN')).toBe('2分钟前');
    expect(relativeEventTime(2000, 1000, 'en')).toBe('Just now');
    const at = Date.UTC(2026, 9, 29, 12);
    expect(eventTime(at, 'en')).not.toBe(eventTime(at, 'zh-CN'));
    expect(latency(12345, 'en')).toBe('12,345 ms');
    expect(percent(99.5, 'en')).toBe('99.50%');
    expect(percent(null, 'en')).toBe('—');
  });
  it('translates only recognized automatic content and preserves the original title name', () => {
    const event = { source: 'automatic' as const, title: '旧名称 服务异常', monitors: [{ name: '新名称' }] };
    expect(localizedEventTitle(event, 'en')).toBe('旧名称 service outage');
    expect(localizedEventTitle({ ...event, source: 'manual' }, 'en')).toBe(event.title);
    expect(localizedEventTitle({ ...event, title: 'Custom title' }, 'en')).toBe('Custom title');
    expect(localizedEntryBody({ source: 'automatic', body: '检测已恢复正常。' }, 'en')).toBe(
      'Checks have returned to normal.',
    );
    expect(localizedEntryBody({ source: 'automatic', body: '节点已删除，已停止跟踪。' }, 'en')).toBe(
      'The monitor was deleted. Tracking has stopped.',
    );
    expect(localizedEntryBody({ source: 'manual', body: '检测已恢复正常。' }, 'en')).toBe('检测已恢复正常。');
    expect(localizedEntryBody({ source: 'automatic', body: '自定义说明' }, 'en')).toBe('自定义说明');
  });
});

describe('localized errors', () => {
  it('localizes shared validation codes and parameters', () => {
    let error: unknown;
    try {
      parseGroup({ name: '' });
    } catch (value) {
      error = value;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({
      code: 'text_length',
      params: { field: 'group_name', max: 80 },
      message: '分组名称需为 1–80 个字符',
    });
    const notice = errorMessage(error, 'error.save');
    expect(displayMessage(notice, 'en')).toBe('Group name must contain 1–80 characters.');
    expect(displayMessage(notice, 'zh-CN')).toBe('分组名称需为 1–80 个字符');
    expect(formatError('monitor_interval_invalid', { min: 1, max: 60 }, 'en')).toContain('1 to 60 minutes');
  });
  it.each([
    [{ code: 'monitor_not_found' }, 'Monitor not found.'],
    [{}, 'The request failed. Please try again later.'],
    [{ code: 'unknown_error' }, 'The request failed. Please try again later.'],
    [
      { code: 'text_length', params: { field: 'event_title', max: 120 } },
      'Event title must contain 1–120 characters.',
    ],
  ])('localizes known codes and uses a generic message for invalid errors: %j', async (body, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status: 400 })));
    const error: unknown = await api('/api/test').catch((value) => value);
    expect(displayMessage(errorMessage(error, 'error.request'), 'en')).toBe(expected);
    expect(error).toHaveProperty('status', 400);
  });
  it('localizes an expired session and network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } })),
    );
    const error: unknown = await api('/api/test').catch((value) => value);
    expect(displayMessage(errorMessage(error, 'error.request'), 'en')).toContain('session may have expired');
    expect(
      displayMessage(errorMessage(new TypeError('Failed to fetch'), 'error.request'), 'zh-CN'),
    ).toContain('网络连接失败');
  });
});
