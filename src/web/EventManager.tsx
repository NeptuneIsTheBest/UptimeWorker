import { useEffect, useState, type FormEvent } from 'react';
import type {
  AdminEvent,
  AdminMonitor,
  EventConfig,
  EventProgressTitle,
  EventsResponse,
  GlobalSettings,
} from '../shared/types';
import {
  EVENT_PROGRESS_LABELS,
  eventProgressOptions,
  parseEventConfig,
  parseEventUpdateConfig,
} from '../shared/events';
import { api, useRemote } from './api';
import { ErrorNotice, Loading, Modal } from './components';
import { EventList } from './EventList';
import { RefreshStatus } from './RefreshStatus';

const localTime = (time: number) => {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
function EventEditor({
  initial,
  monitors,
  save,
  close,
}: {
  initial?: AdminEvent;
  monitors: AdminMonitor[];
  save: (config: EventConfig) => Promise<void>;
  close: () => void;
}) {
  const deletedMonitors = initial?.monitors.filter((monitor) => monitor.id === null) ?? [];
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [type, setType] = useState<EventConfig['type']>(initial?.type ?? 'incident');
  const [ids, setIds] = useState<string[]>(initial?.monitors.flatMap((m) => (m.id ? [m.id] : [])) ?? []);
  const [start, setStart] = useState(localTime(initial?.startsAt ?? Date.now() + 3_600_000));
  const [end, setEnd] = useState(localTime(initial?.endsAt ?? Date.now() + 7_200_000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const config = parseEventConfig(
        {
          title,
          body,
          type,
          monitorIds: ids,
          startsAt: new Date(start).getTime(),
          endsAt: new Date(end).getTime(),
        },
        deletedMonitors.length > 0,
      );
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
      title={initial ? '编辑事件' : '发布事件'}
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <form className="monitor-form" onSubmit={submit}>
        <p className="form-note">保存后会在公开状态页展示。可关联多个节点，并在发布后追加进展。</p>
        <label className="field">
          事件标题
          <input
            autoFocus
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          事件类型
          <select value={type} onChange={(e) => setType(e.target.value as EventConfig['type'])}>
            <option value="incident">故障事件</option>
            <option value="maintenance">计划维护</option>
          </select>
        </label>
        <label className="field">
          事件正文
          <textarea
            required
            rows={5}
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <fieldset className="event-node-picker">
          <legend>关联节点</legend>
          {!monitors.length && !deletedMonitors.length && <p className="muted">请先添加监控节点。</p>}
          {deletedMonitors.length > 0 && (
            <p className="form-note">
              保留已删除节点的历史关联：{deletedMonitors.map((monitor) => monitor.name).join('、')}
            </p>
          )}
          {monitors.map((monitor) => (
            <label className="checkbox-field" key={monitor.id}>
              <input
                type="checkbox"
                checked={ids.includes(monitor.id)}
                onChange={(e) =>
                  setIds((current) =>
                    e.target.checked ? [...current, monitor.id] : current.filter((id) => id !== monitor.id),
                  )
                }
              />
              <span>{monitor.name}</span>
            </label>
          ))}
        </fieldset>
        {type === 'maintenance' && (
          <>
            <label className="field">
              计划开始时间
              <input
                required
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="field">
              计划结束时间
              <input required type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <p className="form-note">
              时间按浏览器时区填写。窗口内继续检测和统计，暂停新发离线事件；到结束时间恢复自动发布计时，维护是否完成需手动确认。
            </p>
          </>
        )}
        {error && <ErrorNotice message={error} />}
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={close}>
            取消
          </button>
          <button className="button primary" disabled={busy || (!monitors.length && !deletedMonitors.length)}>
            {busy ? '正在保存…' : initial ? '保存事件' : '发布事件'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ProgressEditor({
  event,
  saved,
  close,
}: {
  event: AdminEvent;
  saved: () => void;
  close: () => void;
}) {
  const [title, setTitle] = useState<EventProgressTitle>('Updated');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const config = parseEventUpdateConfig({ title, body });
      await api(`/api/admin/events/${event.id}/updates`, {
        method: 'POST',
        body: JSON.stringify({ version: event.version, ...config }),
      });
      saved();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="追加事件进展"
      close={() => {
        if (!busy) close();
      }}
    >
      <form className="monitor-form" onSubmit={submit}>
        <p>{event.title}</p>
        <label className="field">
          进展阶段
          <select
            autoFocus
            required
            value={title}
            onChange={(e) => setTitle(e.target.value as EventProgressTitle)}
          >
            {eventProgressOptions(event).map((option) => (
              <option key={option} value={option}>
                {option} · {EVENT_PROGRESS_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          进展说明
          <textarea
            required
            rows={5}
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {(title === 'Completed' || title === 'Resolved') && (
          <p className="form-note">
            保存此进展将同时{event.type === 'maintenance' ? '完成维护' : '标记故障已恢复'}。
          </p>
        )}
        {event.source === 'automatic' && (
          <p className="form-note">自动事件由成功检测确认恢复，这里可以补充处理说明。</p>
        )}
        {error && <ErrorNotice message={error} />}
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={close}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? '正在保存…' : '保存进展'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function EventManager({
  monitors,
  settings,
}: {
  monitors: AdminMonitor[];
  settings?: GlobalSettings;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const remote = useRemote<EventsResponse>(
    `/api/admin/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  );
  useEffect(() => {
    if (settings) remote.refreshWithSettings(settings);
  }, [settings, remote.refreshWithSettings]);
  const [editor, setEditor] = useState<AdminEvent | 'new' | null>(null);
  const [progress, setProgress] = useState<AdminEvent | null>(null);
  const [deleting, setDeleting] = useState<AdminEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(config: EventConfig) {
    const existing = editor !== 'new' ? editor : null;
    await api(existing ? `/api/admin/events/${existing.id}` : '/api/admin/events', {
      method: existing ? 'PATCH' : 'POST',
      body: JSON.stringify({ ...config, ...(existing ? { version: existing.version } : {}) }),
    });
    setEditor(null);
    latest();
  }
  function latest() {
    setCursor(null);
    setPrevious([]);
    remote.refresh();
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/events/${deleting.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: deleting.version }),
      });
      setDeleting(null);
      remote.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="event-manager">
      <div className="event-toolbar">
        <p className="muted">发布维护安排，记录故障处理与恢复过程。</p>
        <button className="button primary" disabled={!monitors.length} onClick={() => setEditor('new')}>
          发布事件
        </button>
      </div>
      <RefreshStatus {...remote} />
      {remote.error && <ErrorNotice message={remote.error} retry={remote.refresh} />}
      {remote.loading ? (
        <Loading />
      ) : (
        <EventList
          events={remote.data?.events ?? []}
          actions={(event) => (
            <>
              <button className="button small secondary" onClick={() => setProgress(event)}>
                追加进展
              </button>
              {event.source === 'manual' && (
                <button className="button small secondary" onClick={() => setEditor(event)}>
                  编辑事件
                </button>
              )}
              {(event.source === 'manual' || event.status !== 'open') && (
                <button
                  className="button small secondary"
                  onClick={() => {
                    setDeleting(event);
                    setError(null);
                  }}
                >
                  删除事件
                </button>
              )}
            </>
          )}
        />
      )}
      <div className="event-pagination">
        {previous.length > 0 && (
          <>
            <button
              className="button secondary"
              onClick={() => {
                setCursor(previous.at(-1)!);
                setPrevious((values) => values.slice(0, -1));
              }}
            >
              上一页
            </button>
            <button className="button secondary" onClick={latest}>
              返回最新
            </button>
          </>
        )}
        {remote.data?.nextCursor && (
          <button
            className="button secondary"
            onClick={() => {
              setPrevious((values) => [...values, cursor]);
              setCursor(remote.data!.nextCursor);
            }}
          >
            更早事件
          </button>
        )}
      </div>
      {editor && (
        <EventEditor
          initial={editor === 'new' ? undefined : editor}
          monitors={monitors}
          save={save}
          close={() => setEditor(null)}
        />
      )}
      {progress && <ProgressEditor event={progress} saved={latest} close={() => setProgress(null)} />}
      {deleting && (
        <Modal
          title="删除事件"
          close={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>确定删除「{deleting.title}」及其全部进展记录？</p>
          {error && <ErrorNotice message={error} />}
          <div className="modal-actions">
            <button className="button secondary" disabled={busy} onClick={() => setDeleting(null)}>
              取消
            </button>
            <button className="button destructive" disabled={busy} onClick={() => void remove()}>
              确认删除事件
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
