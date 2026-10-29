import { useState } from 'react';
import { ERROR_LABELS } from './labels';
import type { AdminMonitor, MonitorConfig, ProbeResult } from '../../../shared/monitors/types';
import { api } from '../../lib/api';
import { useRemote } from '../../hooks/useRemote';
import { RefreshStatus } from '../../components/RefreshStatus';
import { Empty, ErrorNotice, Loading } from '../../components/feedback';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { StatusBadge } from './status';
import { formatTime, latency } from '../../lib/format';
import type { AdminResponse, MonitorEditorState, MonitorNotice } from './types';
import { MonitorEditor } from './MonitorEditor';

export function MonitorManager({
  remote,
  visible,
  editor,
  onEditorChange: setEditor,
  notice,
  onNoticeChange: setNotice,
}: {
  remote: ReturnType<typeof useRemote<AdminResponse>>;
  visible: boolean;
  editor: MonitorEditorState;
  onEditorChange: (editor: MonitorEditorState) => void;
  notice: MonitorNotice | null;
  onNoticeChange: (notice: MonitorNotice | null) => void;
}) {
  const { data, error, loading, refresh } = remote;
  const [deleting, setDeleting] = useState<AdminMonitor | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
    setNotice({ text: '监控已保存。', error: false });
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
    <>
      <div hidden={!visible}>
        <RefreshStatus {...remote} />
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
                          <span>
                            {data.groups?.find((group) => group.id === monitor.groupId)?.name ?? '未分组'}
                          </span>
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
          <span>定时任务每分钟检查到期的监控。连接测试即时执行，不改变当前状态和可用率。</span>
        </div>
      </div>
      {editor && (
        <MonitorEditor
          groups={data?.groups ?? []}
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
            <p className="muted">
              此监控的检测明细和历史汇总也将删除，无法恢复。已发布事件会保留，进行中的自动事件将停止跟踪。
            </p>
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
    </>
  );
}
