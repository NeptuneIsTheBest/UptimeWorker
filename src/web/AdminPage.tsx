import { useState, type FormEvent } from 'react';
import {
  ERROR_LABELS,
  INTERVALS,
  type AdminMonitor,
  type MonitorConfig,
  type ProbeResult,
} from '../shared/types';
import { parseMonitorConfig } from '../shared/validation';
import { api, useRemote } from './api';
import {
  Empty,
  ErrorNotice,
  Icon,
  Layout,
  Loading,
  Modal,
  StatusBadge,
  formatTime,
  latency,
} from './components';

interface AdminResponse {
  monitors: AdminMonitor[];
  identity: { email: string };
  limit: number;
}
function MonitorEditor({
  initial,
  save,
  close,
}: {
  initial?: AdminMonitor;
  save: (config: MonitorConfig) => Promise<void>;
  close: () => void;
}) {
  const [type, setType] = useState<'http' | 'tcp'>(initial?.type ?? 'http');
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.type === 'http' ? initial.url : '');
  const [method, setMethod] = useState<'GET' | 'HEAD'>(initial?.type === 'http' ? initial.method : 'GET');
  const [hostname, setHostname] = useState(initial?.type === 'tcp' ? initial.hostname : '');
  const [port, setPort] = useState(initial?.type === 'tcp' ? initial.port : 443);
  const [min, setMin] = useState(initial?.type === 'http' ? initial.expectedStatusMin : 200);
  const [max, setMax] = useState(initial?.type === 'http' ? initial.expectedStatusMax : 299);
  const [intervalMinutes, setInterval] = useState(initial?.intervalMinutes ?? 5);
  const [timeoutSeconds, setTimeoutSeconds] = useState(initial?.timeoutSeconds ?? 10);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const config = parseMonitorConfig({
        name,
        type,
        url,
        method,
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
                <select value={method} onChange={(e) => setMethod(e.target.value as 'GET' | 'HEAD')}>
                  <option>GET</option>
                  <option>HEAD</option>
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
            检测间隔
            <select value={intervalMinutes} onChange={(e) => setInterval(Number(e.target.value))}>
              {INTERVALS.map((n) => (
                <option value={n} key={n}>
                  每 {n} 分钟
                </option>
              ))}
            </select>
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
        {initial && <p className="form-note">保存后等待下一轮检测，已有历史记录会保留。</p>}
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

export function AdminPage() {
  const { data, error, loading, refresh } = useRemote<AdminResponse>('/api/admin/monitors');
  const [editor, setEditor] = useState<AdminMonitor | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminMonitor | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  async function action(id: string, work: () => Promise<string>) {
    setBusy(id);
    setNotice(null);
    try {
      setNotice({ text: await work(), error: false });
      refresh();
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : '操作失败', error: true });
    } finally {
      setBusy(null);
    }
  }
  async function save(config: MonitorConfig) {
    if (editor && editor !== 'new')
      await api(`/api/admin/monitors/${editor.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...config, version: editor.version }),
      });
    else await api('/api/admin/monitors', { method: 'POST', body: JSON.stringify(config) });
    setEditor(null);
    setNotice({ text: '监控已保存，下一轮调度将使用新配置。', error: false });
    refresh();
  }
  async function remove() {
    if (!deleting) return;
    setBusy(deleting.id);
    setDeleteError(null);
    try {
      await api(`/api/admin/monitors/${deleting.id}`, { method: 'DELETE', body: '{}' });
      setDeleting(null);
      setNotice({ text: '监控及其历史数据已删除。', error: false });
      refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(null);
    }
  }
  return (
    <Layout admin>
      <div className="page-eyebrow">
        <span className="eyebrow-line" /> MONITORING CONSOLE
      </div>
      <div className="admin-heading">
        <div>
          <h1>监控管理</h1>
          <p className="muted">配置监控目标、检测间隔与期望响应。</p>
        </div>
        <button
          className="button primary"
          onClick={() => setEditor('new')}
          disabled={!data || data.monitors.length >= data.limit}
        >
          <Icon name="plus" size={18} />
          新增监控
        </button>
      </div>
      {data && (
        <div className="access-strip">
          <span>
            <Icon name="shield" size={17} />
            {data.identity.email === 'local@development' ? '本地开发身份' : 'Cloudflare Access 已验证'}
            <strong>{data.identity.email}</strong>
          </span>
          <span>
            {data.monitors.length} / {data.limit} 个监控
            {data.identity.email !== 'local@development' && <a href="/cdn-cgi/access/logout">退出登录</a>}
          </span>
        </div>
      )}
      {error && <ErrorNotice message={error} retry={refresh} />}
      {notice && (
        <div role="status" className={`notice ${notice.error ? 'error' : ''}`}>
          <Icon name={notice.error ? 'info' : 'check'} size={18} />
          <span>{notice.text}</span>
          <button className="icon-button" onClick={() => setNotice(null)} aria-label="关闭提示">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {loading ? (
        <Loading />
      ) : (
        data && (
          <section className="admin-list">
            {!data.monitors.length ? (
              <Empty title="让你的服务开始被看见" icon="server">
                支持 HTTP / HTTPS 与 TCP 端口检测。
                <br />
                <button className="button primary empty-action" onClick={() => setEditor('new')}>
                  <Icon name="plus" size={16} />
                  添加第一个监控
                </button>
              </Empty>
            ) : (
              data.monitors.map((monitor) => (
                <article className="admin-card" key={monitor.id}>
                  <div className="admin-card-info">
                    <span className="service-icon">
                      <Icon name={monitor.type === 'http' ? 'globe' : 'server'} />
                    </span>
                    <div>
                      <div className="admin-name">
                        <h2>{monitor.name}</h2>
                        <StatusBadge status={monitor.status} />
                      </div>
                      <p
                        className="target-text"
                        title={monitor.type === 'http' ? monitor.url : monitor.hostname}
                      >
                        {monitor.type === 'http'
                          ? monitor.url
                          : `${monitor.hostname.includes(':') ? `[${monitor.hostname}]` : monitor.hostname}:${monitor.port}`}
                      </p>
                      <div className="monitor-meta">
                        <span className="protocol">{monitor.type.toUpperCase()}</span>
                        <span>每 {monitor.intervalMinutes} 分钟</span>
                        <span>超时 {monitor.timeoutSeconds} 秒</span>
                        <span>最近检测 {formatTime(monitor.lastCheckedAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="button small secondary"
                      disabled={busy === monitor.id}
                      onClick={() =>
                        void action(monitor.id, async () => {
                          const result = await api<ProbeResult>(`/api/admin/monitors/${monitor.id}/test`, {
                            method: 'POST',
                            body: '{}',
                          });
                          if (!result.ok)
                            throw new Error(
                              `${monitor.name}：${result.errorCode ? ERROR_LABELS[result.errorCode] : '检测失败'}（${latency(result.latencyMs)}）`,
                            );
                          return `${monitor.name}：连接成功，${latency(result.latencyMs)}。本次测试不计入历史统计。`;
                        })
                      }
                    >
                      <Icon name="pulse" size={16} />
                      {busy === monitor.id ? '处理中' : '测试连接'}
                    </button>
                    <button
                      className="icon-button"
                      title={monitor.enabled ? '暂停监控' : '恢复监控'}
                      aria-label={`${monitor.enabled ? '暂停' : '恢复'} ${monitor.name}`}
                      disabled={busy === monitor.id}
                      onClick={() =>
                        void action(monitor.id, async () => {
                          await api(`/api/admin/monitors/${monitor.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ enabled: !monitor.enabled, version: monitor.version }),
                          });
                          return monitor.enabled ? '监控已暂停。' : '监控已恢复，将在下一轮调度检测。';
                        })
                      }
                    >
                      <Icon name={monitor.enabled ? 'pause' : 'play'} size={17} />
                    </button>
                    <button
                      className="icon-button"
                      title="编辑监控"
                      aria-label={`编辑 ${monitor.name}`}
                      disabled={busy === monitor.id}
                      onClick={() => setEditor(monitor)}
                    >
                      <Icon name="edit" size={17} />
                    </button>
                    <button
                      className="icon-button danger"
                      title="删除监控"
                      aria-label={`删除 ${monitor.name}`}
                      disabled={busy === monitor.id}
                      onClick={() => {
                        setDeleting(monitor);
                        setDeleteError(null);
                      }}
                    >
                      <Icon name="trash" size={17} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        )
      )}
      <div className="info-strip">
        <Icon name="clock" size={17} />
        <span>定时任务每 5 分钟检查到期的监控。连接测试即时执行，不改变当前状态和可用率。</span>
      </div>
      {editor && (
        <MonitorEditor
          initial={editor === 'new' ? undefined : editor}
          save={save}
          close={() => setEditor(null)}
        />
      )}
      {deleting && (
        <Modal
          title="删除监控"
          close={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <div className="delete-body">
            <p>
              确定删除「<strong>{deleting.name}</strong>」？
            </p>
            <p className="muted">此监控的检测明细和历史汇总也将删除，无法恢复。</p>
            {deleteError && <ErrorNotice message={deleteError} />}
          </div>
          <div className="modal-actions">
            <button className="button secondary" disabled={!!busy} onClick={() => setDeleting(null)}>
              取消
            </button>
            <button className="button destructive" disabled={!!busy} onClick={() => void remove()}>
              {busy ? '正在删除…' : '确认删除'}
            </button>
          </div>
        </Modal>
      )}
    </Layout>
  );
}
