import { ValidationError } from '../errors';
import { MAX_HTTP_REDIRECTS } from '../monitors/constants';
import type { MonitorConfig } from '../monitors/types';
import type { PerformanceSettings } from './types';

export const DEFAULT_PERFORMANCE: Readonly<PerformanceSettings> = {
  workersPlan: 'free',
  concurrency: 4,
  maxChecksPerRun: 10,
  timeBudgetSeconds: 50,
};
export const PERFORMANCE_RANGES = {
  concurrency: [1, 6],
  maxChecksPerRun: [1, 500],
  timeBudgetSeconds: [40, 180],
} as const;

// Scheduler and estimator budgets; see the capacity model in docs/architecture.md.
export const PLATFORM_LIMITS = {
  free: { subrequests: 50, d1Writes: 100_000 },
  paid: { subrequests: 10_000, d1Writes: 50_000_000 },
} as const;
export const RESULT_RESERVE_SECONDS = 5;
export const HTTP_REQUESTS_PER_CHECK = MAX_HTTP_REDIRECTS + 1;

export function parsePerformancePatch(value: unknown, current: PerformanceSettings): PerformanceSettings {
  if (value === undefined) return { ...current };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('performance_object_invalid');
  const input = value as Record<string, unknown>;
  const workersPlan = input.workersPlan === undefined ? current.workersPlan : input.workersPlan;
  if (workersPlan !== 'free' && workersPlan !== 'paid') throw new ValidationError('performance_plan_invalid');
  const result: PerformanceSettings = { ...current, workersPlan };
  for (const field of ['concurrency', 'maxChecksPerRun', 'timeBudgetSeconds'] as const) {
    const value = input[field] === undefined ? current[field] : input[field];
    const [min, max] = PERFORMANCE_RANGES[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
      throw new ValidationError('performance_value_invalid', { field, min, max });
    result[field] = value;
  }
  return result;
}

export type BudgetReason = 'batch' | 'requests' | 'time';
type Target = Pick<MonitorConfig, 'type' | 'timeoutSeconds'>;

// The scheduler and the timeout simulation use exactly the same admission rules.
export function createProbeBudget(settings: PerformanceSettings, startedAt: number) {
  let started = 0;
  let httpRequests = 0;
  const deadline = startedAt + (settings.timeBudgetSeconds - RESULT_RESERVE_SECONDS) * 1000;
  return {
    reserve(target: Target, now: number): BudgetReason | null {
      if (started >= settings.maxChecksPerRun) return 'batch';
      const cost = target.type === 'http' ? HTTP_REQUESTS_PER_CHECK : 0;
      if (httpRequests + cost > PLATFORM_LIMITS[settings.workersPlan].subrequests) return 'requests';
      if (now + target.timeoutSeconds * 1000 > deadline) return 'time';
      started++;
      httpRequests += cost;
      return null;
    },
    get started() {
      return started;
    },
    get httpRequests() {
      return httpRequests;
    },
  };
}

export function estimatePerformance(
  monitors: readonly (MonitorConfig & { id: string })[],
  settings: PerformanceSettings,
) {
  // All targets are assumed due at the same instant; ids break the scheduling tie.
  const enabled = monitors.filter((monitor) => monitor.enabled).sort((a, b) => a.id.localeCompare(b.id));
  const dailyChecks = enabled.reduce((sum, monitor) => sum + 1440 / monitor.intervalMinutes, 0);
  const dailyHttp = enabled.reduce(
    (sum, monitor) => sum + (monitor.type === 'http' ? 1440 / monitor.intervalMinutes : 0),
    0,
  );
  const candidates = enabled.slice(0, settings.maxChecksPerRun);
  const lanes = Array<number>(settings.concurrency).fill(0);
  const budget = createProbeBudget(settings, 0);
  const deferred: Record<BudgetReason, number> = {
    batch: enabled.length - candidates.length,
    requests: 0,
    time: 0,
  };
  for (const monitor of candidates) {
    const lane = lanes.indexOf(Math.min(...lanes));
    const reason = budget.reserve(monitor, lanes[lane]);
    if (reason) deferred[reason]++;
    else lanes[lane] += monitor.timeoutSeconds * 1000;
  }
  const worstHttpRequests =
    candidates.filter((monitor) => monitor.type === 'http').length * HTTP_REQUESTS_PER_CHECK;
  const unboundedProbeSeconds = candidates.length
    ? Math.ceil(candidates.length / settings.concurrency) *
      Math.max(...candidates.map((monitor) => monitor.timeoutSeconds))
    : 0;
  return {
    enabled: enabled.length,
    checksPerMinute: dailyChecks / 1440,
    dailyChecks,
    dailyHttpMin: dailyHttp,
    dailyHttpMax: dailyHttp * HTTP_REQUESTS_PER_CHECK,
    retainedSamples: dailyChecks * 7,
    // Check insertion, daily aggregation, and monitor state update; excludes indexes and other writes.
    dailyWriteFloor: dailyChecks * 3,
    started: budget.started,
    deferred,
    deferredCount: enabled.length - budget.started,
    httpRequests: budget.httpRequests,
    worstHttpRequests,
    probeSeconds: Math.max(...lanes) / 1000,
    unboundedProbeSeconds,
  };
}

export function budgetLevel(usage: number, limit: number): 'within' | 'near' | 'over' {
  return usage > limit ? 'over' : usage >= limit * 0.8 ? 'near' : 'within';
}
