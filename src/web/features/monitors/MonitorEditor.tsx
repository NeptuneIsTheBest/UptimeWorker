import { errorMessage, displayMessage, type DisplayMessage } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { ValidationError } from '../../../shared/errors';
import { useState, type FormEvent } from 'react';
import {
  DEFAULT_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  HTTP_METHODS,
} from '../../../shared/monitors/constants';
import type { GlobalSettings } from '../../../shared/settings/types';
import type { MonitorGroup } from '../../../shared/groups/types';
import type { HttpMethod, RequestBody, AdminMonitor, MonitorConfig } from '../../../shared/monitors/types';
import { parseMonitorConfig, wafMonitorDomain } from '../../../shared/monitors/validation';
import { useRemote } from '../../hooks/useRemote';
import { ErrorNotice } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';

export function MonitorEditor({
  initial,
  groups,
  save,
  close,
}: {
  initial?: AdminMonitor;
  groups: MonitorGroup[];
  save: (config: MonitorConfig) => Promise<void>;
  close: () => void;
}) {
  const { t, locale } = useI18n();
  const [type, setType] = useState<'http' | 'tcp'>(initial?.type ?? 'http');
  const [name, setName] = useState(initial?.name ?? '');
  const [groupId, setGroupId] = useState(initial?.groupId ?? '');
  const [url, setUrl] = useState(initial?.type === 'http' ? initial.url : '');
  const [method, setMethod] = useState<HttpMethod>(initial?.type === 'http' ? initial.method : 'GET');
  const [wafBypassEnabled, setWafBypassEnabled] = useState(
    initial?.type === 'http' ? initial.wafBypassEnabled : false,
  );
  const [requestHeaders, setRequestHeaders] = useState<[string, string][]>(
    initial?.type === 'http' ? Object.entries(initial.requestHeaders) : [],
  );
  const [bodyFormat, setBodyFormat] = useState<'none' | RequestBody['format']>(
    initial?.type === 'http' ? (initial.requestBody?.format ?? 'none') : 'none',
  );
  const [bodyContent, setBodyContent] = useState(
    initial?.type === 'http' ? (initial.requestBody?.content ?? '') : '',
  );
  const [includes, setIncludes] = useState(
    initial?.type === 'http' ? (initial.responseCheck?.includes.join('\n') ?? '') : '',
  );
  const [excludes, setExcludes] = useState(
    initial?.type === 'http' ? (initial.responseCheck?.excludes.join('\n') ?? '') : '',
  );
  const [ignoreCase, setIgnoreCase] = useState(
    initial?.type === 'http' ? (initial.responseCheck?.ignoreCase ?? false) : false,
  );
  const settings = useRemote<GlobalSettings>('/api/admin/settings');
  const wafDomain = wafMonitorDomain(url);
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const [hostname, setHostname] = useState(initial?.type === 'tcp' ? initial.hostname : '');
  const [port, setPort] = useState(initial?.type === 'tcp' ? initial.port : 443);
  const [min, setMin] = useState(initial?.type === 'http' ? initial.expectedStatusMin : 200);
  const [max, setMax] = useState(initial?.type === 'http' ? initial.expectedStatusMax : 299);
  const [intervalMinutes, setInterval] = useState<number | ''>(
    initial?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES,
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState(initial?.timeoutSeconds ?? 10);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const headers = requestHeaders.filter(([name, value]) => name.trim() || value);
      const headerNames = headers.map(([name]) => name.trim().toLowerCase());
      if (type === 'http' && new Set(headerNames).size !== headerNames.length)
        throw new ValidationError('header_duplicate');
      const words = (value: string) =>
        value
          .split(/\r?\n/)
          .map((word) => word.trim())
          .filter(Boolean);
      const config = parseMonitorConfig({
        name,
        groupId: groupId || null,
        type,
        url,
        method,
        wafBypassEnabled: wafDomain ? wafBypassEnabled : false,
        requestHeaders: Object.fromEntries(headers.map(([name, value]) => [name.trim(), value])),
        requestBody: hasBody && bodyFormat !== 'none' ? { format: bodyFormat, content: bodyContent } : null,
        responseCheck:
          method === 'HEAD' ? null : { includes: words(includes), excludes: words(excludes), ignoreCase },
        hostname,
        port,
        expectedStatusMin: min,
        expectedStatusMax: max,
        intervalMinutes,
        timeoutSeconds,
        enabled,
      });
      setBusy(true);
      await save(config);
    } catch (err) {
      setError(errorMessage(err, 'error.save'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? t('monitors.edit') : t('monitors.add')}
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <form noValidate onSubmit={submit} className="monitor-form">
        <div className="modal-scroll">
          <div className="type-picker" role="group" aria-label={t('monitor.type')}>
            <button
              type="button"
              className={type === 'http' ? 'selected' : ''}
              onClick={() => setType('http')}
              aria-pressed={type === 'http'}
            >
              <Icon name="globe" />
              <span>HTTP / HTTPS</span>
              {type === 'http' && <Icon name="check" size={16} />}
            </button>
            <button
              type="button"
              className={type === 'tcp' ? 'selected' : ''}
              onClick={() => setType('tcp')}
              aria-pressed={type === 'tcp'}
            >
              <Icon name="server" />
              <span>TCP Port</span>
              {type === 'tcp' && <Icon name="check" size={16} />}
            </button>
          </div>
          <label className="field">
            {t('monitor.name')}
            <input
              required
              maxLength={80}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('monitor.namePlaceholder')}
            />
          </label>
          <label className="field">
            {t('monitor.group')}
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">{t('groups.ungrouped')}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          {type === 'http' ? (
            <>
              <label className="field">
                {t('monitor.url')}
                <input
                  required
                  type="url"
                  maxLength={2048}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/health"
                />
                <small>{t('monitor.urlNote')}</small>
              </label>
              <div className="form-columns">
                <label className="field">
                  {t('monitor.method')}
                  <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
                    {HTTP_METHODS.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  <span>{t('monitor.statusRange')}</span>
                  <div className="range-input">
                    <input
                      aria-label={t('monitor.statusMin')}
                      type="number"
                      min={100}
                      max={599}
                      required
                      value={min}
                      onChange={(e) => setMin(Number(e.target.value))}
                    />
                    <span>—</span>
                    <input
                      aria-label={t('monitor.statusMax')}
                      type="number"
                      min={100}
                      max={599}
                      required
                      value={max}
                      onChange={(e) => setMax(Number(e.target.value))}
                    />
                  </div>
                </div>
              </div>
              {wafDomain && (
                <div className="monitor-waf">
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={wafBypassEnabled}
                      onChange={(e) => setWafBypassEnabled(e.target.checked)}
                    />
                    <span>{t('monitor.waf')}</span>
                  </label>
                  {wafBypassEnabled && (
                    <p className="form-note">{t('monitor.wafNote', { domain: wafDomain })}</p>
                  )}
                  {wafBypassEnabled &&
                    (settings.loading ? (
                      <p className="form-note" role="status">
                        {t('monitor.wafLoading')}
                      </p>
                    ) : settings.error ? (
                      <ErrorNotice
                        message={t('monitor.wafError', { error: displayMessage(settings.error, locale) })}
                        retry={settings.refresh}
                      />
                    ) : (
                      <p className="form-note" role="status">
                        {!settings.data?.wafBypassTokenConfigured
                          ? t('monitor.wafMissing')
                          : !settings.data.wafBypassEnabled
                            ? t('monitor.wafDisabled')
                            : t('monitor.wafReady')}
                      </p>
                    ))}
                </div>
              )}
              <details className="advanced-config">
                <summary>{t('monitor.advanced')}</summary>
                <div className="advanced-fields">
                  <fieldset className="request-headers">
                    <legend>{t('monitor.headers')}</legend>
                    {requestHeaders.map(([name, value], index) => (
                      <div className="request-header-row" key={index}>
                        <input
                          aria-label={t('monitor.headerName', { count: index + 1 })}
                          value={name}
                          placeholder="Authorization"
                          autoCapitalize="none"
                          spellCheck={false}
                          onChange={(e) =>
                            setRequestHeaders((rows) =>
                              rows.map((row, i) => (i === index ? [e.target.value, row[1]] : row)),
                            )
                          }
                        />
                        <input
                          aria-label={t('monitor.headerValue', { count: index + 1 })}
                          value={value}
                          placeholder="Bearer …"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(e) =>
                            setRequestHeaders((rows) =>
                              rows.map((row, i) => (i === index ? [row[0], e.target.value] : row)),
                            )
                          }
                        />
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label={t('monitor.removeHeader', { count: index + 1 })}
                          onClick={() => setRequestHeaders((rows) => rows.filter((_, i) => i !== index))}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="button small secondary"
                      onClick={() => setRequestHeaders((rows) => [...rows, ['', '']])}
                    >
                      {t('monitor.addHeader')}
                    </button>
                    <p className="form-note">{t('monitor.headersNote')}</p>
                  </fieldset>
                  {hasBody ? (
                    <>
                      <label className="field">
                        {t('monitor.bodyFormat')}
                        <select
                          value={bodyFormat}
                          onChange={(e) => setBodyFormat(e.target.value as typeof bodyFormat)}
                        >
                          <option value="none">{t('monitor.noBody')}</option>
                          <option value="text">{t('monitor.textBody')}</option>
                          <option value="json">JSON</option>
                        </select>
                      </label>
                      {bodyFormat !== 'none' && (
                        <label className="field">
                          {t('monitor.body')}
                          <textarea
                            rows={5}
                            value={bodyContent}
                            spellCheck={false}
                            autoCapitalize="none"
                            maxLength={16384}
                            onChange={(e) => setBodyContent(e.target.value)}
                            placeholder={
                              bodyFormat === 'json' ? '{"check": true}' : t('monitor.bodyPlaceholder')
                            }
                          />
                          <small>{t('monitor.bodyNote')}</small>
                        </label>
                      )}
                    </>
                  ) : (
                    <p className="form-note">{t('monitor.bodyUnsupported', { method })}</p>
                  )}
                  {method !== 'HEAD' ? (
                    <>
                      <div className="form-columns">
                        <label className="field">
                          {t('monitor.includes')}
                          <textarea
                            rows={4}
                            value={includes}
                            onChange={(e) => setIncludes(e.target.value)}
                            placeholder={t('monitor.includesPlaceholder')}
                          />
                        </label>
                        <label className="field">
                          {t('monitor.excludes')}
                          <textarea
                            rows={4}
                            value={excludes}
                            onChange={(e) => setExcludes(e.target.value)}
                            placeholder={t('monitor.excludesPlaceholder')}
                          />
                        </label>
                      </div>
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={ignoreCase}
                          onChange={(e) => setIgnoreCase(e.target.checked)}
                        />
                        <span>{t('monitor.ignoreCase')}</span>
                      </label>
                      <p className="form-note">{t('monitor.keywordsNote')}</p>
                    </>
                  ) : (
                    <p className="form-note">{t('monitor.headNote')}</p>
                  )}
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="form-columns host-columns">
                <label className="field">
                  {t('monitor.host')}
                  <input
                    required
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    placeholder="db.example.com"
                  />
                </label>
                <label className="field">
                  {t('monitor.port')}
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="form-hint">
                <Icon name="info" size={16} />
                <span>{t('monitor.tcpNote')}</span>
              </div>
            </>
          )}
          <div className="form-columns">
            <label className="field">
              {t('monitor.intervalInput')}
              <input
                required
                type="number"
                min={MIN_INTERVAL_MINUTES}
                max={MAX_INTERVAL_MINUTES}
                step={1}
                value={intervalMinutes}
                aria-describedby="interval-note"
                onChange={(e) => setInterval(e.target.value === '' ? '' : Number(e.target.value))}
              />
              <small id="interval-note">
                {t('monitor.intervalNote', {
                  min: MIN_INTERVAL_MINUTES,
                  max: MAX_INTERVAL_MINUTES,
                  default: DEFAULT_INTERVAL_MINUTES,
                })}
              </small>
            </label>
            <label className="field">
              {t('monitor.timeoutInput')}
              <input
                required
                type="number"
                min={1}
                max={30}
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>{t('monitor.enabled')}</span>
          </label>
          {initial && (
            <details className="form-help">
              <summary>{t('monitor.checkHelp')}</summary>
              <p>{t('monitor.editNote')}</p>
            </details>
          )}
          {error && <ErrorNotice message={error} />}
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={17} />}
            {busy ? t('common.saving') : t('monitor.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
