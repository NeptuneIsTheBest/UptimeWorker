import { message, errorMessage, displayMessage, type DisplayMessage } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { useEffect, useState, type FormEvent } from 'react';
import { isWafToken, parseGlobalSettingsPatch } from '../../../shared/settings/validation';
import { wafRuleDomains, wafSkipExpression } from '../../../shared/settings/waf';
import {
  DEFAULT_PAGE_REFRESH_SECONDS,
  MIN_PAGE_REFRESH_SECONDS,
  MAX_PAGE_REFRESH_SECONDS,
} from '../../../shared/settings/constants';
import type { GlobalSettings } from '../../../shared/settings/types';
import type { MonitorConfig } from '../../../shared/monitors/types';
import { api, ApiError } from '../../lib/api';
import { ErrorNotice } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';

export function GlobalSettingsDialog({
  monitors,
  close,
  saved,
}: {
  monitors: readonly MonitorConfig[];
  close: () => void;
  saved: (settings: GlobalSettings) => void;
}) {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [autoIncidentAfterMinutes, setAutoIncidentAfterMinutes] = useState<number | ''>(5);
  const [refreshPreset, setRefreshPreset] = useState('30');
  const [customRefresh, setCustomRefresh] = useState<number | ''>(DEFAULT_PAGE_REFRESH_SECONDS);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage | null>(null);
  const [conflict, setConflict] = useState(false);
  const [copyNotice, setCopyNotice] = useState<DisplayMessage | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSettings(null);
    setToken('');
    setError(null);
    setConflict(false);
    setCopyNotice(null);
    void api<GlobalSettings>('/api/admin/settings', { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setSettings(value);
        setEnabled(value.wafBypassEnabled);
        setAutoIncidentAfterMinutes(value.autoIncidentAfterMinutes ?? 5);
        setRefreshPreset(
          [0, 15, 30, 60].includes(value.pageRefreshSeconds) ? String(value.pageRefreshSeconds) : 'custom',
        );
        setCustomRefresh(value.pageRefreshSeconds || DEFAULT_PAGE_REFRESH_SECONDS);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(err, 'settings.loadFailed'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  const ruleDomains = wafRuleDomains(monitors);
  const hasNewToken = isWafToken(token);
  const rule = ruleDomains.length ? wafSkipExpression(ruleDomains) : '';

  function generateToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    setToken(Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''));
    setCopyNotice(message('settings.newToken'));
  }
  async function copy(value: string, notice: DisplayMessage) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyNotice(notice);
    } catch {
      setCopyNotice(message('settings.copyFailed'));
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setError(null);
    setConflict(false);
    try {
      const patch = parseGlobalSettingsPatch(
        {
          version: settings.version,
          autoIncidentAfterMinutes,
          pageRefreshSeconds: refreshPreset === 'custom' ? customRefresh : Number(refreshPreset),
          wafBypassEnabled: enabled,
          wafBypassToken: token,
        },
        settings,
      );
      setBusy(true);
      const updated = await api<GlobalSettings>('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setToken('');
      saved(updated);
    } catch (err) {
      setError(errorMessage(err, 'error.save'));
      setConflict(err instanceof ApiError && err.status === 409);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('settings.title')}
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      {loading ? (
        <div className="loading" role="status">
          <span className="spinner" />
          {t('settings.loading')}
        </div>
      ) : !settings ? (
        <div className="settings-load-error">
          <ErrorNotice
            message={error || t('settings.loadFailed')}
            retry={() => setRevision((value) => value + 1)}
          />
        </div>
      ) : (
        <form noValidate onSubmit={submit} className="monitor-form settings-form">
          <fieldset className="settings-fields" disabled={busy}>
            <legend>{t('settings.autoIncidents')}</legend>
            <label className="field">
              {t('settings.threshold')}
              <input
                type="number"
                required
                min={0}
                max={1440}
                step={1}
                value={autoIncidentAfterMinutes}
                onChange={(e) =>
                  setAutoIncidentAfterMinutes(e.target.value === '' ? '' : Number(e.target.value))
                }
              />
            </label>
            <p className="form-note">{t('settings.thresholdNote')}</p>
          </fieldset>
          <fieldset className="settings-fields refresh-settings" disabled={busy}>
            <legend>{t('settings.refresh')}</legend>
            <div className="field">
              <label htmlFor="page-refresh">{t('settings.refreshInterval')}</label>
              <select
                id="page-refresh"
                value={refreshPreset}
                onChange={(event) => setRefreshPreset(event.target.value)}
              >
                <option value="0">{t('settings.refreshOff')}</option>
                <option value="15">{t('settings.refresh15')}</option>
                <option value="30">{t('settings.refresh30')}</option>
                <option value="60">{t('settings.refresh60')}</option>
                <option value="custom">{t('settings.custom')}</option>
              </select>
            </div>
            {refreshPreset === 'custom' && (
              <div className="field">
                <label htmlFor="custom-page-refresh">{t('settings.customInterval')}</label>
                <input
                  id="custom-page-refresh"
                  type="number"
                  min={MIN_PAGE_REFRESH_SECONDS}
                  max={MAX_PAGE_REFRESH_SECONDS}
                  step={1}
                  required
                  value={customRefresh}
                  onChange={(event) =>
                    setCustomRefresh(event.target.value === '' ? '' : Number(event.target.value))
                  }
                />
                <small>{t('settings.customNote')}</small>
              </div>
            )}
            <p className="form-note">{t('settings.refreshNote')}</p>
          </fieldset>
          <p className="form-intro">{t('settings.wafDescription')}</p>
          <fieldset className="settings-fields" disabled={busy}>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span>{t('settings.wafEnabled')}</span>
            </label>
            <div className="field">
              <label htmlFor="waf-token">
                {t('settings.token')}
                {settings.wafBypassTokenConfigured && (
                  <span className="settings-configured">{t('settings.configured')}</span>
                )}
              </label>
              <input
                id="waf-token"
                type="password"
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={256}
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  setCopyNotice(null);
                }}
                placeholder={
                  settings.wafBypassTokenConfigured ? t('settings.keepToken') : t('settings.enterToken')
                }
                aria-describedby="waf-token-note"
              />
              <div className="settings-tools">
                <button type="button" className="button small secondary" onClick={generateToken}>
                  {t('settings.generateToken')}
                </button>
                <button
                  type="button"
                  className="button small secondary"
                  disabled={!hasNewToken}
                  onClick={() => void copy(token, message('settings.tokenCopied'))}
                >
                  {t('settings.copyToken')}
                </button>
              </div>
              <small id="waf-token-note">{t('settings.tokenNote')}</small>
            </div>
            <details className="waf-rule-help">
              <summary>{t('settings.skipHelp')}</summary>
              <p>{t('settings.skipInstructions')}</p>
              {rule ? (
                <>
                  <p>{t('settings.ruleDomains')}</p>
                  <pre aria-label={t('settings.ruleTemplate')}>{rule}</pre>
                  <button
                    type="button"
                    className="button small secondary"
                    disabled={token !== '' && !hasNewToken}
                    onClick={() =>
                      void copy(
                        hasNewToken ? wafSkipExpression(ruleDomains, token) : rule,
                        hasNewToken ? message('settings.fullRuleCopied') : message('settings.templateCopied'),
                      )
                    }
                  >
                    {hasNewToken ? t('settings.copyFullRule') : t('settings.copyTemplate')}
                  </button>
                  <p>{t('settings.ruleTokenNote')}</p>
                </>
              ) : (
                <p>{t('settings.noRule')}</p>
              )}
              <p>
                {t('settings.botFightNote')}{' '}
                <a
                  href="https://developers.cloudflare.com/waf/custom-rules/skip/options/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('settings.supportedFeatures')}
                </a>
              </p>
            </details>
          </fieldset>
          {copyNotice && (
            <p className="settings-copy-notice" role="status">
              {displayMessage(copyNotice, locale)}
            </p>
          )}
          {error && <ErrorNotice message={error} />}
          {conflict && (
            <button
              type="button"
              className="text-button settings-reload"
              onClick={() => setRevision((value) => value + 1)}
            >
              {t('settings.reload')}
            </button>
          )}
          <p className="form-note">{t('settings.applyNote')}</p>
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={close}>
              {t('common.cancel')}
            </button>
            <button className="button primary" disabled={busy || conflict}>
              {busy ? <span className="spinner" /> : <Icon name="check" size={17} />}
              {busy ? t('common.saving') : t('settings.save')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
