import { useEffect, useState, type FormEvent } from 'react';
import {
  isWafToken,
  normalizeWafDomain,
  parseGlobalSettingsPatch,
  parseWafDomains,
  wafSkipExpression,
} from '../shared/settings';
import type { AdminMonitor, GlobalSettings } from '../shared/types';
import { api, ApiError } from './api';
import { ErrorNotice, Icon, Modal } from './components';

function tryNormalizeDomain(value: string): string | null {
  try {
    return normalizeWafDomain(value);
  } catch {
    return null;
  }
}

export function GlobalSettingsDialog({
  monitors,
  monitorsLoading,
  monitorsError,
  retryMonitors,
  close,
  saved,
}: {
  monitors: AdminMonitor[];
  monitorsLoading: boolean;
  monitorsError: string | null;
  retryMonitors: () => void;
  close: () => void;
  saved: () => void;
}) {
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [domains, setDomains] = useState('');
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
        setDomains(value.wafBypassDomains.join('\n'));
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '读取全局设置失败');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  const domainLines = domains
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const selectedDomains = new Set(domainLines.map(tryNormalizeDomain));
  const monitorDomains = new Map<string, string[]>();
  for (const monitor of monitors) {
    if (monitor.type !== 'http') continue;
    let url: URL;
    try {
      url = new URL(monitor.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:') continue;
    const domain = tryNormalizeDomain(url.hostname);
    if (!domain) continue;
    const names = monitorDomains.get(domain) ?? [];
    names.push(monitor.name);
    monitorDomains.set(domain, names);
  }
  let ruleDomains: string[] = [];
  try {
    ruleDomains = parseWafDomains(domainLines);
  } catch {
    // Let the user finish typing; validation errors are shown on save.
  }
  const hasNewToken = isWafToken(token);
  const rule = ruleDomains.length ? wafSkipExpression(ruleDomains) : '';

  function selectDomain(domain: string, checked: boolean) {
    setDomains((current) => {
      const lines = current.split(/\r?\n/);
      if (checked) {
        if (lines.some((line) => tryNormalizeDomain(line) === domain)) return current;
        return `${current}${current && !current.endsWith('\n') ? '\n' : ''}${domain}`;
      }
      // Preserve other manual input, including incomplete or invalid lines.
      return lines.filter((line) => tryNormalizeDomain(line) !== domain).join('\n');
    });
  }

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
          wafBypassEnabled: enabled,
          wafBypassDomains: domainLines,
          wafBypassToken: token,
        },
        settings,
      );
      setBusy(true);
      await api<GlobalSettings>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) });
      setToken('');
      saved();
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
          <p className="form-intro">
            从监控列表选择或手动填写生效域名，为 HTTPS 检测添加放行凭据，需配合目标站点的 WAF Skip 规则。
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
            <fieldset className="settings-domain-picker" aria-describedby="waf-monitor-domains-note">
              <legend>从监控列表选择</legend>
              {monitorsError && (
                <ErrorNotice message={`读取监控列表失败：${monitorsError}`} retry={retryMonitors} />
              )}
              {monitorsLoading ? (
                <p className="settings-domain-status" role="status">
                  正在读取监控列表…
                </p>
              ) : monitorDomains.size ? (
                <div className="settings-domain-options">
                  {[...monitorDomains].map(([domain, names]) => (
                    <label className="checkbox-field settings-domain-option" key={domain}>
                      <input
                        type="checkbox"
                        checked={selectedDomains.has(domain)}
                        onChange={(event) => selectDomain(domain, event.target.checked)}
                      />
                      <span>
                        <strong>{domain}</strong>
                        <small>{names.join('、')}</small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : !monitorsError ? (
                <p className="settings-domain-status">暂无可选的 HTTPS 监控域名，可在下方手动填写。</p>
              ) : (
                <p className="settings-domain-status">可重试读取监控列表，或在下方手动填写域名。</p>
              )}
              <p id="waf-monitor-domains-note" className="settings-domain-note">
                包含已暂停监控，勾选后需保存设置。新增监控需自行勾选，修改或删除监控不会移除已保存的域名。
              </p>
            </fieldset>
            <div className="field">
              <label htmlFor="waf-domains">生效域名</label>
              <textarea
                id="waf-domains"
                rows={3}
                maxLength={12000}
                spellCheck={false}
                autoCapitalize="none"
                value={domains}
                onChange={(event) => setDomains(event.target.value)}
                placeholder={'example.com\napi.example.com'}
                aria-describedby="waf-domains-note"
              />
              <small id="waf-domains-note">
                可手动补充或移除域名，与上方勾选同步。每行一个完整域名，不含协议、端口或路径，不支持通配符。仅向匹配域名的
                HTTPS 请求发送密钥，重定向也会重新检查。
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
                <p>选择或填写有效的生效域名后显示规则模板。</p>
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
          <p className="form-note">保存后应用于新的连接测试及下一轮调度。关闭开关会保留密钥和域名配置。</p>
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
