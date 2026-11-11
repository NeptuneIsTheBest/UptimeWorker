import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AdminMonitor } from '../../../shared/monitors/types';
import type { GlobalSettings, PerformanceSettings } from '../../../shared/settings/types';
import {
  budgetLevel,
  DEFAULT_PERFORMANCE,
  estimatePerformance,
  parsePerformancePatch,
  PERFORMANCE_RANGES,
  PLATFORM_LIMITS,
  RESULT_RESERVE_SECONDS,
} from '../../../shared/settings/performance';
import { api, ApiError } from '../../lib/api';
import { useI18n } from '../../i18n/I18nProvider';
import { errorMessage, type DisplayMessage, type MessageKey } from '../../i18n/core';
import { ErrorNotice, Loading } from '../../components/feedback';

type NumericField = keyof typeof PERFORMANCE_RANGES;
type Draft = { workersPlan: PerformanceSettings['workersPlan'] } & Record<NumericField, number | ''>;

export function PerformancePanel({
  monitors,
  monitorError,
  saved,
  onReadyChange,
}: {
  monitors: readonly AdminMonitor[] | undefined;
  monitorError: DisplayMessage | null;
  saved: (settings: GlobalSettings) => void;
  onReadyChange: (ready: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...DEFAULT_PERFORMANCE });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage | null>(null);
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSettings(null);
    setError(null);
    setConflict(false);
    setSuccess(false);
    void api<GlobalSettings>('/api/admin/settings', { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setSettings(value);
        setDraft({ ...value.performance });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(err, 'settings.loadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  const ready = Boolean(settings) && !loading;
  useEffect(() => {
    onReadyChange(ready);
    return () => onReadyChange(false);
  }, [ready, onReadyChange]);

  let performance: PerformanceSettings | null = null;
  let validation: DisplayMessage | null = null;
  try {
    performance = parsePerformancePatch(draft, DEFAULT_PERFORMANCE);
  } catch (err) {
    validation = errorMessage(err, 'error.save');
  }
  const estimate = performance && monitors ? estimatePerformance(monitors, performance) : null;
  const number = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format, [locale]);
  const dirty = settings && JSON.stringify(draft) !== JSON.stringify(settings.performance);
  function change(field: keyof Draft, value: number | '' | PerformanceSettings['workersPlan']) {
    setDraft((current) => ({ ...current, [field]: value }));
    setSuccess(false);
    if (!conflict) setError(null);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!settings || !performance || busy || conflict) return;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const updated = await api<GlobalSettings>('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({ version: settings.version, performance }),
      });
      setSettings(updated);
      setDraft({ ...updated.performance });
      setSuccess(true);
      saved(updated);
    } catch (err) {
      setError(errorMessage(err, 'error.save'));
      setConflict(err instanceof ApiError && err.status === 409);
    } finally {
      setBusy(false);
    }
  }
  function metric(label: MessageKey, value: string) {
    return (
      <div className="performance-metric" key={label}>
        <dt>{t(label)}</dt>
        <dd>{value}</dd>
      </div>
    );
  }
  function capacity(label: MessageKey, value: number, limit: number) {
    const level = budgetLevel(value, limit);
    return (
      <div className={`performance-capacity ${level}`} key={label}>
        <div>
          <strong>{t(label)}</strong>
          <span>{t(`performance.${level}`)}</span>
        </div>
        <p>
          {number(value)} / {number(limit)}
        </p>
        <meter min={0} max={limit} value={Math.min(value, limit)} aria-label={t(label)} />
      </div>
    );
  }
  if (loading) return <Loading />;
  if (!settings)
    return (
      <ErrorNotice
        message={error || t('settings.loadFailed')}
        retry={() => setRevision((value) => value + 1)}
      />
    );
  return (
    <section className="performance-panel" aria-label={t('performance.title')}>
      <header className="performance-heading">
        <h2>{t('performance.title')}</h2>
      </header>
      <div className="performance-layout">
        <form className="performance-controls" noValidate onSubmit={submit}>
          <h3>{t('performance.configure')}</h3>
          <fieldset disabled={busy} className="settings-fields">
            <div className="field">
              <label htmlFor="performance-plan">{t('performance.plan')}</label>
              <select
                id="performance-plan"
                value={draft.workersPlan}
                onChange={(event) =>
                  change('workersPlan', event.target.value as PerformanceSettings['workersPlan'])
                }
              >
                <option value="free">Workers Free</option>
                <option value="paid">Workers Paid</option>
              </select>
            </div>
            {(['concurrency', 'maxChecksPerRun', 'timeBudgetSeconds'] as const).map((field) => (
              <div className="field" key={field}>
                <label htmlFor={`performance-${field}`}>{t(`performance.${field}`)}</label>
                <input
                  id={`performance-${field}`}
                  aria-describedby={`performance-${field}-range`}
                  type="number"
                  min={PERFORMANCE_RANGES[field][0]}
                  max={PERFORMANCE_RANGES[field][1]}
                  step={1}
                  required
                  value={draft[field]}
                  onChange={(event) =>
                    change(field, event.target.value === '' ? '' : Number(event.target.value))
                  }
                />
                <small id={`performance-${field}-range`}>
                  {t('performance.range', {
                    min: PERFORMANCE_RANGES[field][0],
                    max: PERFORMANCE_RANGES[field][1],
                  })}
                </small>
              </div>
            ))}
          </fieldset>
          {validation && <ErrorNotice message={validation} />}
          {error && <ErrorNotice message={error} />}
          {conflict && (
            <button type="button" className="text-button" onClick={() => setRevision((value) => value + 1)}>
              {t('settings.reload')}
            </button>
          )}
          {success && (
            <p role="status" className="performance-saved">
              {t('performance.saved')}
            </p>
          )}
          <div className="performance-save">
            <button className="button primary" disabled={busy || conflict || !performance || !dirty}>
              {t(busy ? 'common.saving' : 'settings.save')}
            </button>
            {dirty && <small>{t('performance.unsaved')}</small>}
          </div>
        </form>
        <div className="performance-estimates">
          <h3>{t('performance.estimates')}</h3>
          <p className="form-note">{t('performance.estimateNote')}</p>
          {monitorError && <ErrorNotice message={monitorError} />}
          {!monitors && <p>{t('performance.monitorsUnavailable')}</p>}
          {!performance && <p>{t('performance.correctInputs')}</p>}
          {performance && estimate && (
            <>
              <dl className="performance-metrics">
                {metric('performance.enabled', number(estimate.enabled))}
                {metric('performance.perMinute', number(estimate.checksPerMinute))}
                {metric('performance.dailyChecks', number(estimate.dailyChecks))}
                {metric(
                  'performance.dailyHttp',
                  `${number(estimate.dailyHttpMin)}–${number(estimate.dailyHttpMax)}`,
                )}
                {metric('performance.samples', number(estimate.retainedSamples))}
                {metric('performance.writeFloor', `≥ ${number(estimate.dailyWriteFloor)}`)}
              </dl>
              <div className="performance-simulation" aria-live="polite">
                <h3>{t('performance.simulation')}</h3>
                <p>{t('performance.simulationNote')}</p>
                <dl className="performance-metrics">
                  {metric('performance.started', number(estimate.started))}
                  {metric('performance.deferred', number(estimate.deferredCount))}
                  {metric('performance.duration', t('performance.seconds', { count: estimate.probeSeconds }))}
                  {metric('performance.reservedRequests', number(estimate.httpRequests))}
                </dl>
                {estimate.deferredCount > 0 && (
                  <p className="performance-warning">{t('performance.deferredNote', estimate.deferred)}</p>
                )}
              </div>
              <div className="performance-capacities">
                {capacity('performance.batchCapacity', estimate.enabled, performance.maxChecksPerRun)}
                {capacity(
                  'performance.requestCapacity',
                  estimate.worstHttpRequests,
                  PLATFORM_LIMITS[performance.workersPlan].subrequests,
                )}
                {capacity(
                  'performance.timeCapacity',
                  estimate.unboundedProbeSeconds,
                  performance.timeBudgetSeconds - RESULT_RESERVE_SECONDS,
                )}
              </div>
              {estimate.checksPerMinute > performance.maxChecksPerRun && (
                <p className="performance-warning">{t('performance.averageOverload')}</p>
              )}
              {estimate.dailyWriteFloor * (performance.workersPlan === 'paid' ? 30 : 1) >=
                PLATFORM_LIMITS[performance.workersPlan].d1Writes * 0.8 && (
                <p className="performance-warning">{t('performance.writeWarning')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
