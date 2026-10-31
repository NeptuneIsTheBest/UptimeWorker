// One timer per display cadence, shared by every mounted subscriber.
export function createClock(intervalMs: number) {
  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const update = () => {
    now = Date.now();
    for (const listener of listeners) listener();
  };
  const visibilityChanged = () => {
    clearInterval(timer);
    timer = undefined;
    if (document.visibilityState === 'visible') {
      update();
      timer = setInterval(update, intervalMs);
    }
  };
  return {
    getSnapshot: () => now,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        document.addEventListener('visibilitychange', visibilityChanged);
        now = Date.now();
        visibilityChanged();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearInterval(timer);
          timer = undefined;
          document.removeEventListener('visibilitychange', visibilityChanged);
        }
      };
    },
  };
}
