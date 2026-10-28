import { useEffect, useState, type FormEvent } from 'react';
import { isWafToken, parseGlobalSettingsPatch, wafRuleDomains, wafSkipExpression } from '../shared/settings';
import {
  DEFAULT_PAGE_REFRESH_SECONDS,
  MIN_PAGE_REFRESH_SECONDS,
  MAX_PAGE_REFRESH_SECONDS,
  type GlobalSettings,
  type MonitorConfig,
} from '../shared/types';
import { api, ApiError } from './api';
import { ErrorNotice, Icon, Modal } from './components';

export function GlobalSettingsDialog({
  monitors,
  close,
  saved,
}: {
  monitors: readonly MonitorConfig[];
  close: () => void;
  saved: (settings: GlobalSettings) => void;
}) {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [refreshPreset, setRefreshPreset] = useState('30');
  const [customRefresh, setCustomRefresh] = useState<number | ''>(DEFAULT_PAGE_REFRESH_SECONDS);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
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
        setRefreshPreset(
          [0, 15, 30, 60].includes(value.pageRefreshSeconds) ? String(value.pageRefreshSeconds) : 'custom',
        );
        setCustomRefresh(value.pageRefreshSeconds || DEFAULT_PAGE_REFRESH_SECONDS);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '读取全局设置失败');
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
    setCopyNotice('新密钥尚未保存，请先复制并妥善保管，再同步更新目标站点的 WAF 规则。');
  }
  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyNotice(message);
    } catch {
      setCopyNotice('复制失败，请允许浏览器访问剪贴板后重试。');
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
      setError(err instanceof Error ? err.message : '保存失败');
      setConflict(err instanceof ApiError && err.status === 409);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="全局设置"
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      {loading ? (
        <div className="loading" role="status">
          <span className="spinner" />
          正在读取全局设置…
        </div>
      ) : !settings ? (
        <div className="settings-load-error">
          <ErrorNotice
            message={error || '读取全局设置失败'}
            retry={() => setRevision((value) => value + 1)}
          />
        </div>
      ) : (
        <form onSubmit={submit} className="monitor-form settings-form">
          <fieldset className="settings-fields refresh-settings" disabled={busy}>
            <legend>页面自动刷新</legend>
            <div className="field">
              <label htmlFor="page-refresh">刷新间隔</label>
              <select
                id="page-refresh"
                value={refreshPreset}
                onChange={(event) => setRefreshPreset(event.target.value)}
              >
                <option value="0">关闭自动刷新</option>
                <option value="15">每 15 秒</option>
                <option value="30">每 30 秒（默认）</option>
                <option value="60">每 60 秒</option>
                <option value="custom">自定义</option>
              </select>
            </div>
            {refreshPreset === 'custom' && (
              <div className="field">
                <label htmlFor="custom-page-refresh">自定义间隔（秒）</label>
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
                <small>支持 5–3600 的整数秒。</small>
              </div>
            )}
            <p className="form-note">
              统一应用于状态概览、监控详情和管理页。其他页面在下次成功刷新时获取新设置；关闭后可点击“立即刷新”。重新开启后，已关闭的页面需手动刷新或重新打开。
            </p>
          </fieldset>
          <p className="form-intro">
            为开启单站 WAF 放行的监控提供共享密钥和总开关，需配合目标站点的 WAF Skip 规则。
          </p>
          <fieldset className="settings-fields" disabled={busy}>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              <span>启用 Cloudflare WAF 放行</span>
            </label>
            <div className="field">
              <label htmlFor="waf-token">
                放行密钥
                {settings.wafBypassTokenConfigured && <span className="settings-configured">已配置</span>}
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
                  settings.wafBypassTokenConfigured ? '留空保留已保存的密钥' : '生成或输入 32–256 位密钥'
                }
                aria-describedby="waf-token-note"
              />
              <div className="settings-tools">
                <button type="button" className="button small secondary" onClick={generateToken}>
                  生成随机密钥
                </button>
                <button
                  type="button"
                  className="button small secondary"
                  disabled={!hasNewToken}
                  onClick={() => void copy(token, '新密钥已复制，保存后不会回显。')}
                >
                  复制新密钥
                </button>
              </div>
              <small id="waf-token-note">
                新密钥请在保存前复制，保存后不会回显。留空保留原密钥，更换后需同步更新 WAF 规则。
              </small>
            </div>
            <details className="waf-rule-help">
              <summary>Cloudflare Skip 规则配置</summary>
              <p>
                在目标站点的「Security rules」中新建自定义规则，操作选择
                Skip，置于相关拦截规则之前，并选择需要跳过的安全功能。
              </p>
              {rule ? (
                <>
                  <p>
                    模板域名来自已开启 WAF 放行的监控，包含已暂停监控。调整监控域名后需同步更新目标站点规则。
                  </p>
                  <pre aria-label="WAF 规则模板">{rule}</pre>
                  <button
                    type="button"
                    className="button small secondary"
                    disabled={token !== '' && !hasNewToken}
                    onClick={() =>
                      void copy(
                        hasNewToken ? wafSkipExpression(ruleDomains, token) : rule,
                        hasNewToken
                          ? '完整规则已复制，包含尚未保存的新密钥。'
                          : '模板已复制，请将 <YOUR_TOKEN> 替换为已保存的密钥。',
                      )
                    }
                  >
                    {hasNewToken ? '复制完整规则' : '复制规则模板'}
                  </button>
                  <p>
                    模板中的 &lt;YOUR_TOKEN&gt;
                    需替换为放行密钥。启用前先保存目标站点的规则；更换密钥时需同步修改规则。
                  </p>
                </>
              ) : (
                <p>在网站监控中开启 WAF 放行并保存后显示规则模板。</p>
              )}
              <p>
                普通 Bot Fight Mode 无法通过 Skip 跳过。
                <a
                  href="https://developers.cloudflare.com/waf/custom-rules/skip/options/"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看支持范围
                </a>
              </p>
            </details>
          </fieldset>
          {copyNotice && (
            <p className="settings-copy-notice" role="status">
              {copyNotice}
            </p>
          )}
          {error && <ErrorNotice message={error} />}
          {conflict && (
            <button
              type="button"
              className="text-button settings-reload"
              onClick={() => setRevision((value) => value + 1)}
            >
              重新加载最新设置（放弃当前编辑）
            </button>
          )}
          <p className="form-note">
            WAF 设置保存后应用于新的连接测试及下一轮调度。关闭 WAF 总开关会保留密钥和单站开关设置。
          </p>
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={close}>
              取消
            </button>
            <button className="button primary" disabled={busy || conflict}>
              {busy ? <span className="spinner" /> : <Icon name="check" size={17} />}
              {busy ? '正在保存…' : '保存设置'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
