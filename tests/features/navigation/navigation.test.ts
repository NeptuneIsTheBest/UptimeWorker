import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeNavigation,
  readEventReturn,
  readPageState,
  readScrollPosition,
  rememberEventNavigation,
  saveScrollPosition,
  writePageState,
} from '../../../src/web/lib/navigation';

const origin = 'https://status.example.com';
let navigationType = 'navigate';
let browserHistory: {
  state: unknown;
  length: number;
  scrollRestoration: string;
  replaceState: (state: unknown) => void;
};
let storage: Map<string, string>;
function visit(path: string, referrer = '') {
  vi.stubGlobal('location', new URL(path, origin));
  vi.stubGlobal('document', { referrer });
  browserHistory.state = null;
}

beforeEach(() => {
  navigationType = 'navigate';
  storage = new Map();
  browserHistory = {
    state: null,
    length: 2,
    scrollRestoration: 'auto',
    replaceState: (state) => {
      browserHistory.state = state;
    },
  };
  vi.stubGlobal('history', browserHistory);
  vi.stubGlobal('window', { scrollX: 0, scrollY: 840 });
  vi.stubGlobal('performance', { getEntriesByType: () => [{ type: navigationType }] });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  visit('/admin');
});
afterEach(() => vi.unstubAllGlobals());

describe('event navigation history', () => {
  it('consumes the source once and retains it through reload and forward navigation', () => {
    rememberEventNavigation('/events/one');
    visit('/events/one', `${origin}/admin`);
    initializeNavigation();
    expect(readEventReturn()).toEqual({ href: '/admin', kind: 'events' });
    expect(storage.size).toBe(0);
    navigationType = 'reload';
    initializeNavigation();
    expect(readEventReturn()?.href).toBe('/admin');
    navigationType = 'back_forward';
    initializeNavigation();
    expect(readEventReturn()?.href).toBe('/admin');
    visit('/events/one', `${origin}/admin`);
    initializeNavigation();
    expect(readEventReturn()).toBeNull();
  });

  it.each(['', 'https://external.example/admin', `${origin}/monitors/another`])(
    'does not trust a pending click with a different or missing referrer %s',
    (referrer) => {
      rememberEventNavigation('/events/one');
      visit('/events/one', referrer);
      initializeNavigation();
      expect(readEventReturn()).toBeNull();
      expect(storage.size).toBe(0);
    },
  );

  it.each(['reload', 'back_forward'])('does not consume stale clicks during %s', (type) => {
    rememberEventNavigation('/events/one');
    visit('/events/one', `${origin}/admin`);
    navigationType = type;
    initializeNavigation();
    expect(readEventReturn()).toBeNull();
  });

  it('can verify a same-tab source when navigation timing is unavailable', () => {
    vi.stubGlobal('performance', { getEntriesByType: () => [] });
    rememberEventNavigation('/events/one');
    visit('/events/one', `${origin}/admin`);
    initializeNavigation();
    expect(readEventReturn()).toEqual({ href: '/admin', kind: 'events' });
  });

  it('discards a pending click when another page is visited first', () => {
    rememberEventNavigation('/events/one');
    visit('/events/two', `${origin}/admin`);
    initializeNavigation();
    expect(readEventReturn()).toBeNull();
    visit('/events/one', `${origin}/admin`);
    initializeNavigation();
    expect(readEventReturn()).toBeNull();
  });

  it.each([
    'https://external.example/',
    '//external.example/',
    '/events/one',
    '/api/admin/events',
    'javascript:alert(1)',
  ])('rejects unsupported or external return targets %s', (href) => {
    visit('/events/one');
    writePageState({ eventReturn: href });
    expect(readEventReturn()).toBeNull();
  });

  it('does not use an opener copy of pending storage without a previous history entry', () => {
    rememberEventNavigation('/events/one');
    visit('/events/one', `${origin}/admin`);
    browserHistory.length = 1;
    initializeNavigation();
    expect(readEventReturn()).toBeNull();
  });
});

describe('saved page state', () => {
  it('merges independent view state without replacing unrelated history data', () => {
    browserHistory.state = { unrelated: { value: 42 } };
    writePageState({ adminTab: 'events' });
    saveScrollPosition();
    expect(readScrollPosition()).toEqual({ x: 0, y: 840 });
    expect(readPageState('adminTab', (value): value is string => typeof value === 'string', '')).toBe(
      'events',
    );
    expect(browserHistory.state).toMatchObject({ unrelated: { value: 42 } });
    expect(browserHistory.scrollRestoration).toBe('manual');
    vi.stubGlobal('location', new URL('/', origin));
    expect(readScrollPosition()).toBeNull();
  });

  it.each([null, [], 'bad', { scroll: { x: 0, y: 840 } }])('ignores malformed history state %j', (value) => {
    browserHistory.state = value;
    expect(readScrollPosition()).toBeNull();
    expect(readEventReturn()).toBeNull();
  });

  it('tolerates corrupt storage and browser storage/history failures', () => {
    storage.set('uptimeworker:event-navigation', '{invalid');
    expect(() => initializeNavigation()).not.toThrow();
    expect(storage.size).toBe(0);
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
    browserHistory.replaceState = () => {
      throw new Error('unavailable');
    };
    expect(() => rememberEventNavigation('/events/one')).not.toThrow();
    expect(() => initializeNavigation()).not.toThrow();
    expect(readEventReturn()).toBeNull();
  });
});
