import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClock } from '../../../src/web/lib/clock';

let page: EventTarget & { visibilityState: string };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('document', page);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([1000, 15000])('shares a %s ms timer and releases it after the last subscriber', (interval) => {
  const clock = createClock(interval);
  const first = vi.fn(),
    second = vi.fn();
  const removeFirst = clock.subscribe(first);
  const removeSecond = clock.subscribe(second);
  first.mockClear();
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(interval);
  expect(clock.getSnapshot()).toBe(100_000 + interval);
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  removeFirst();
  expect(vi.getTimerCount()).toBe(1);
  removeSecond();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops hidden clocks, catches up immediately on visibility, and cleans up on unmount', () => {
  const clock = createClock(15000);
  const listener = vi.fn();
  let unsubscribe = clock.subscribe(listener);
  page.visibilityState = 'hidden';
  page.dispatchEvent(new Event('visibilitychange'));
  listener.mockClear();
  vi.advanceTimersByTime(300_000);
  expect(listener).not.toHaveBeenCalled();
  expect(clock.getSnapshot()).toBe(100_000);
  expect(vi.getTimerCount()).toBe(0);
  page.visibilityState = 'visible';
  page.dispatchEvent(new Event('visibilitychange'));
  expect(clock.getSnapshot()).toBe(400_000);
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
  page.dispatchEvent(new Event('visibilitychange'));
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(10_000);
  unsubscribe = clock.subscribe(listener);
  expect(clock.getSnapshot()).toBe(410_000);
  unsubscribe();
});
