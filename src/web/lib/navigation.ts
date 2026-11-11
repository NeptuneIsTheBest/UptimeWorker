const HISTORY_KEY = 'uptimeworker:navigation';
const PENDING_EVENT_KEY = 'uptimeworker:event-navigation';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const currentPath = () => location.pathname + location.search + location.hash;

function pageState(): Record<string, unknown> {
  const state: unknown = history.state;
  const saved = isRecord(state) ? state[HISTORY_KEY] : null;
  return isRecord(saved) && saved.path === currentPath() ? saved : {};
}

export function readPageState<T>(key: string, valid: (value: unknown) => value is T, fallback: T): T {
  try {
    const value = pageState()[key];
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePageState(patch: Record<string, unknown>): void {
  try {
    const state: unknown = history.state;
    history.replaceState(
      {
        ...(isRecord(state) ? state : {}),
        [HISTORY_KEY]: { ...pageState(), ...patch, path: currentPath() },
      },
      '',
    );
  } catch {
    // Navigation still works when the browser cannot save view state.
  }
}

export interface ScrollPosition {
  x: number;
  y: number;
}

const isScrollPosition = (value: unknown): value is ScrollPosition =>
  isRecord(value) &&
  typeof value.x === 'number' &&
  Number.isFinite(value.x) &&
  value.x >= 0 &&
  typeof value.y === 'number' &&
  Number.isFinite(value.y) &&
  value.y >= 0;

export const readScrollPosition = () =>
  readPageState<ScrollPosition | null>('scroll', isScrollPosition, null);

export function saveScrollPosition(): void {
  writePageState({ scroll: { x: Math.max(0, window.scrollX), y: Math.max(0, window.scrollY) } });
  if (readScrollPosition()) history.scrollRestoration = 'manual';
}

export function isPlainLinkClick(
  event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'defaultPrevented'>,
): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  );
}

export interface EventReturn {
  href: string;
  kind: 'overview' | 'events' | 'monitor';
}

function eventReturn(value: unknown): EventReturn | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin) return null;
    const path = url.pathname.replace(/\/$/, '') || '/';
    const kind =
      path === '/'
        ? 'overview'
        : path === '/admin'
          ? 'events'
          : /^\/monitors\/[^/]+$/.test(path)
            ? 'monitor'
            : null;
    return kind ? { href: url.pathname + url.search + url.hash, kind } : null;
  } catch {
    return null;
  }
}

export function readEventReturn(): EventReturn | null {
  const from = readPageState('eventReturn', (value): value is string => typeof value === 'string', '');
  return history.length > 1 ? eventReturn(from) : null;
}

export function rememberEventNavigation(href: string): void {
  const from = eventReturn(currentPath());
  const to = new URL(href, location.href);
  if (!from || to.origin !== location.origin || !/^\/events\/[^/]+\/?$/.test(to.pathname)) return;
  saveScrollPosition();
  try {
    sessionStorage.setItem(PENDING_EVENT_KEY, JSON.stringify({ from: from.href, to: to.href }));
  } catch {
    // A direct event visit remains usable without session storage.
  }
}

// Run once per document, before React mounts (including its StrictMode remounts).
export function initializeNavigation(): void {
  let pending: unknown;
  try {
    const raw = sessionStorage.getItem(PENDING_EVENT_KEY);
    sessionStorage.removeItem(PENDING_EVENT_KEY);
    pending = raw ? JSON.parse(raw) : null;
  } catch {
    pending = null;
  }
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (
    navigation?.type !== 'reload' &&
    navigation?.type !== 'back_forward' &&
    history.length > 1 &&
    isRecord(pending) &&
    pending.to === location.href &&
    /^\/events\/[^/]+\/?$/.test(location.pathname)
  ) {
    const from = eventReturn(pending.from);
    if (from) {
      try {
        // Confirm the departure page too, so a cancelled/stale click cannot send users elsewhere.
        const referrer = new URL(document.referrer);
        const source = new URL(from.href, location.origin);
        if (
          referrer.origin === source.origin &&
          referrer.pathname === source.pathname &&
          referrer.search === source.search
        )
          writePageState({ eventReturn: from.href });
      } catch {
        // No verifiable source: keep the overview fallback.
      }
    }
  }
  if (readScrollPosition()) history.scrollRestoration = 'manual';
}
