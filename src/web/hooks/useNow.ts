import { useSyncExternalStore } from 'react';
import { createClock } from '../lib/clock';

const clocks = { 1000: createClock(1000), 15000: createClock(15000) };
const subscribeIdle = () => () => {};
const serverSnapshot = () => 0;

export function useNow(intervalMs: 1000 | 15000 = 15000, enabled = true) {
  const clock = clocks[intervalMs];
  return useSyncExternalStore(enabled ? clock.subscribe : subscribeIdle, clock.getSnapshot, serverSnapshot);
}
