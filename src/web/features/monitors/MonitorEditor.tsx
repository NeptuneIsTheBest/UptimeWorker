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
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const headers = requestHeaders.filter(([name, value]) => name.trim() || value);
      const headerNames = headers.map(([name]) => name.trim().toLowerCase());
      if (type === 'http' && new Set(headerNames).size !== headerNames.length)
        throw new Error('请求头名称不能重复（不区分大小写）');
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
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? '编辑监控' : '新增监控'}
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <form onSubmit={submit} className="monitor-form">
        <p className="form-intro">选择检测方式，配置你的服务连接信息。</p>
        <div className="type-picker" role="group" aria-label="检测类型">
          <button
            type="button"
            className={type === 'http' ? 'selected' : ''}
            onClick={() => setType('http')}
            aria-pressed={type === 'http'}
          >
            <Icon name="globe" />
            <span>
              HTTP / HTTPS<small>网站与 API 服务</small>
            </span>
            {type === 'http' && <Icon name="check" size={16} />}
          </button>
          <button
            type="button"
            className={type === 'tcp' ? 'selected' : ''}
            onClick={() => setType('tcp')}
            aria-pressed={type === 'tcp'}
          >
            <Icon name="server" />
            <span>
              TCP Port<small>服务端口连接</small>
            </span>
            {type === 'tcp' && <Icon name="check" size={16} />}
          </button>
        </div>
        <label className="field">
          服务名称
          <input
            required
            maxLength={80}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：官方网站"
          />
        </label>
        <label className="field">
          所属分组
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">未分组</option>
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
              检测地址
              <input
                required
                type="url"
                maxLength={2048}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/health"
              />
              <small>仅支持公网地址，最多跟随 3 次重定向。</small>
            </label>
            <div className="form-columns">
              <label className="field">
                请求方法
                <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
                  {HTTP_METHODS.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span>期望状态码</span>
                <div className="range-input">
                  <input
                    aria-label="最小状态码"
                    type="number"
                    min={100}
                    max={599}
                    required
                    value={min}
                    onChange={(e) => setMin(Number(e.target.value))}
                  />
                  <span>—</span>
                  <input
                    aria-label="最大状态码"
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
                  <span>启用 WAF 放行</span>
                </label>
                <p className="form-note">
                  仅向当前监控域名 {wafDomain} 的 HTTPS 请求发送共享密钥；跨域场景请直接配置最终检测地址。
                </p>
                {wafBypassEnabled &&
                  (settings.loading ? (
                    <p className="form-note" role="status">
                      正在读取全局 WAF 设置…
                    </p>
                  ) : settings.error ? (
                    <ErrorNotice
                      message={`无法确认全局 WAF 设置：${settings.error}`}
                      retry={settings.refresh}
                    />
                  ) : (
                    <p className="form-note" role="status">
                      {!settings.data?.wafBypassTokenConfigured
                        ? '尚未配置共享密钥，请到全局设置配置密钥并开启总开关。'
                        : !settings.data.wafBypassEnabled
                          ? '全局 WAF 总开关已关闭，请到全局设置开启后生效。'
                          : '全局 WAF 已就绪，请确保目标站点已配置对应的 Skip 规则。'}
                    </p>
                  ))}
              </div>
            )}
            <details className="advanced-config">
              <summary>高级配置（请求参数与响应校验）</summary>
              <div className="advanced-fields">
                <fieldset className="request-headers">
                  <legend>自定义请求头</legend>
                  {requestHeaders.map(([name, value], index) => (
                    <div className="request-header-row" key={index}>
                      <input
                        aria-label={`请求头名称 ${index + 1}`}
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
                        aria-label={`请求头值 ${index + 1}`}
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
                        aria-label={`删除请求头 ${index + 1}`}
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
                    添加请求头
                  </button>
                  <p className="form-note">合计最多 8 KiB；跨源重定向时移除自定义请求头。</p>
                </fieldset>
                {hasBody ? (
                  <>
                    <label className="field">
                      请求体格式
                      <select
                        value={bodyFormat}
                        onChange={(e) => setBodyFormat(e.target.value as typeof bodyFormat)}
                      >
                        <option value="none">不发送请求体</option>
                        <option value="text">文本</option>
                        <option value="json">JSON</option>
                      </select>
                    </label>
                    {bodyFormat !== 'none' && (
                      <label className="field">
                        请求体内容
                        <textarea
                          rows={5}
                          value={bodyContent}
                          spellCheck={false}
                          autoCapitalize="none"
                          maxLength={16384}
                          onChange={(e) => setBodyContent(e.target.value)}
                          placeholder={bodyFormat === 'json' ? '{"check": true}' : '请求正文'}
                        />
                        <small>
                          最多 16 KiB；自动补充 Content-Type，可通过请求头覆盖。请求体不会转发到其他源。
                        </small>
                      </label>
                    )}
                  </>
                ) : (
                  <p className="form-note">{method} 不支持请求体。</p>
                )}
                {method !== 'HEAD' ? (
                  <>
                    <div className="form-columns">
                      <label className="field">
                        必须包含
                        <textarea
                          rows={4}
                          value={includes}
                          onChange={(e) => setIncludes(e.target.value)}
                          placeholder={'healthy\n服务正常'}
                        />
                      </label>
                      <label className="field">
                        不能包含
                        <textarea
                          rows={4}
                          value={excludes}
                          onChange={(e) => setExcludes(e.target.value)}
                          placeholder={'error\n维护中'}
                        />
                      </label>
                    </div>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={ignoreCase}
                        onChange={(e) => setIgnoreCase(e.target.checked)}
                      />
                      <span>忽略大小写</span>
                    </label>
                    <p className="form-note">
                      每行一个关键词，每组最多 20 个、每个最多 256
                      字符。要求包含项全部出现、排除项全部不出现；留空只检查状态码。最多校验 1 MiB 响应文本。
                    </p>
                  </>
                ) : (
                  <p className="form-note">HEAD 不返回响应正文，不进行关键词校验。</p>
                )}
              </div>
            </details>
          </>
        ) : (
          <>
            <div className="form-columns host-columns">
              <label className="field">
                主机地址
                <input
                  required
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="db.example.com"
                />
              </label>
              <label className="field">
                端口
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
              <span>TCP 仅检测连接能否建立。Cloudflare 不支持连接内网地址、Cloudflare IP 或端口 25。</span>
            </div>
          </>
        )}
        <div className="form-columns">
          <label className="field">
            检测间隔（分钟）
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
              支持 {MIN_INTERVAL_MINUTES}–{MAX_INTERVAL_MINUTES} 的整数，新建默认 {DEFAULT_INTERVAL_MINUTES}{' '}
              分钟。
            </small>
          </label>
          <label className="field">
            超时时间（秒）
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
          <span>启用定时检测</span>
        </label>
        {initial && (
          <p className="form-note">修改检测参数后等待下一轮检测；仅修改名称或分组会保留当前状态。</p>
        )}
        {error && <ErrorNotice message={error} />}
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={close}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={17} />}
            {busy ? '正在保存…' : '保存监控'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
