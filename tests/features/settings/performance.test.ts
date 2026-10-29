import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  budgetLevel,
  createProbeBudget,
  DEFAULT_PERFORMANCE,
  estimatePerformance,
  parsePerformancePatch,
} from '../../../src/shared/settings/performance';
import { apiClient } from '../../support/api-client';
import { databaseFixture, httpConfig, resetDatabase, tcpConfig } from '../../support/fixtures';

describe('performance configuration and estimates', () => {
  it('merges partial settings and accepts boundary values', () => {
    expect(parsePerformancePatch(undefined, DEFAULT_PERFORMANCE)).toEqual(DEFAULT_PERFORMANCE);
    expect(parsePerformancePatch({ concurrency: 6 }, DEFAULT_PERFORMANCE)).toEqual({
      ...DEFAULT_PERFORMANCE,
      concurrency: 6,
    });
    for (const performance of [
      { workersPlan: 'free', concurrency: 1, maxChecksPerRun: 1, timeBudgetSeconds: 40 },
      { workersPlan: 'paid', concurrency: 6, maxChecksPerRun: 500, timeBudgetSeconds: 180 },
    ])
      expect(parsePerformancePatch(performance, DEFAULT_PERFORMANCE)).toEqual(performance);
  });
  it.each([
    null,
    [],
    false,
    'free',
    { workersPlan: 'enterprise' },
    { workersPlan: null },
    ...['concurrency', 'maxChecksPerRun', 'timeBudgetSeconds'].flatMap((key) =>
      [null, '', '4', true, 0, -1, 1.5, Infinity, NaN].map((value) => ({ [key]: value })),
    ),
    { concurrency: 7 },
    { maxChecksPerRun: 501 },
    { timeBudgetSeconds: 39 },
    { timeBudgetSeconds: 181 },
  ])('rejects invalid performance configuration %j', (input) => {
    expect(() => parsePerformancePatch(input, DEFAULT_PERFORMANCE)).toThrow();
  });
  it('reserves a full redirect chain, separates TCP, and enforces the exact time boundary', () => {
    const budget = createProbeBudget({ ...DEFAULT_PERFORMANCE, maxChecksPerRun: 30 }, 1000);
    for (let i = 0; i < 12; i++) expect(budget.reserve(httpConfig, 1000)).toBeNull();
    expect(budget.reserve(httpConfig, 1000)).toBe('requests');
    expect(budget.reserve(tcpConfig, 36_000)).toBeNull();
    expect(budget.reserve(tcpConfig, 36_001)).toBe('time');
    expect(budget.started).toBe(13);
    expect(budget.httpRequests).toBe(48);
    const one = createProbeBudget({ ...DEFAULT_PERFORMANCE, maxChecksPerRun: 1 }, 0);
    expect(one.reserve(tcpConfig, 0)).toBeNull();
    expect(one.reserve(httpConfig, 0)).toBe('batch');
  });
  it('handles no monitors, paused monitors, and mixed frequencies without counting TCP as HTTP', () => {
    for (const monitors of [[], [{ ...httpConfig, id: 'paused', enabled: false }]]) {
      expect(estimatePerformance(monitors, DEFAULT_PERFORMANCE)).toMatchObject({
        enabled: 0,
        dailyChecks: 0,
        started: 0,
        deferredCount: 0,
        probeSeconds: 0,
      });
    }
    expect(
      estimatePerformance(
        [
          { ...httpConfig, id: 'http', intervalMinutes: 2 },
          { ...tcpConfig, id: 'tcp', intervalMinutes: 1 },
          { ...httpConfig, id: 'paused', enabled: false },
        ],
        DEFAULT_PERFORMANCE,
      ),
    ).toMatchObject({
      enabled: 2,
      checksPerMinute: 1.5,
      dailyChecks: 2160,
      dailyHttpMin: 720,
      dailyHttpMax: 2880,
      retainedSamples: 15120,
      dailyWriteFloor: 6480,
      httpRequests: 4,
      started: 2,
    });
  });
  it('shows how the plan, batch, concurrency and time budget affect a simultaneous burst', () => {
    const monitors = Array.from({ length: 14 }, (_, index) => ({
      ...httpConfig,
      id: String(index).padStart(2, '0'),
      timeoutSeconds: 10,
    }));
    const settings = { ...DEFAULT_PERFORMANCE, maxChecksPerRun: 20 };
    expect(estimatePerformance(monitors, settings)).toMatchObject({
      started: 12,
      deferred: { requests: 2 },
      httpRequests: 48,
      probeSeconds: 30,
    });
    expect(estimatePerformance(monitors, { ...settings, workersPlan: 'paid' })).toMatchObject({
      started: 14,
      deferredCount: 0,
      probeSeconds: 40,
    });
    expect(estimatePerformance(monitors, { ...settings, concurrency: 1 })).toMatchObject({
      started: 4,
      deferred: { time: 10 },
      probeSeconds: 40,
    });
    expect(
      estimatePerformance(monitors, {
        ...settings,
        concurrency: 1,
        timeBudgetSeconds: 180,
        workersPlan: 'paid',
      }),
    ).toMatchObject({ started: 14, probeSeconds: 140 });
    expect(estimatePerformance(monitors, DEFAULT_PERFORMANCE)).toMatchObject({
      started: 10,
      deferred: { batch: 4 },
    });
    expect(budgetLevel(79, 100)).toBe('within');
    expect(budgetLevel(80, 100)).toBe('near');
    expect(budgetLevel(100, 100)).toBe('near');
    expect(budgetLevel(101, 100)).toBe('over');
  });
});

describe('performance settings API', () => {
  let fixture: Awaited<ReturnType<typeof databaseFixture>>;
  beforeAll(async () => {
    fixture = await databaseFixture();
  });
  afterAll(async () => {
    await fixture?.dispose();
  });
  beforeEach(async () => {
    await resetDatabase(fixture.db);
  });
  it('persists partial performance edits, keeps unrelated settings, and rejects concurrent stale writers', async () => {
    const { request } = apiClient(fixture.db);
    const read = async () => (await request('admin/settings')).json();
    expect(await read()).toMatchObject({ version: 1, performance: DEFAULT_PERFORMANCE });
    const save = await request('admin/settings', 'PATCH', {
      version: 1,
      pageRefreshSeconds: 15,
      wafBypassToken: 'fixture-secret-'.repeat(4),
      performance: { workersPlan: 'paid', concurrency: 6, maxChecksPerRun: 120, timeBudgetSeconds: 120 },
    });
    expect(save.status).toBe(200);
    expect(
      (await request('admin/settings', 'PATCH', { version: 2, performance: { concurrency: 2 } })).status,
    ).toBe(200);
    expect(await read()).toMatchObject({
      version: 3,
      pageRefreshSeconds: 15,
      wafBypassTokenConfigured: true,
      performance: { workersPlan: 'paid', concurrency: 2, maxChecksPerRun: 120, timeBudgetSeconds: 120 },
    });
    const concurrent = await Promise.all([
      request('admin/settings', 'PATCH', { version: 3, performance: { concurrency: 3 } }),
      request('admin/settings', 'PATCH', { version: 3, pageRefreshSeconds: 60 }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(
      (await request('admin/settings', 'PATCH', { version: 4, performance: { concurrency: 7 } })).status,
    ).toBe(400);
    expect(await read()).toMatchObject({ version: 4 });
  });
});
