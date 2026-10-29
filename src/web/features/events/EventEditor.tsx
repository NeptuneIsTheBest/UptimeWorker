import { useState, type FormEvent } from 'react';
import type { AdminEvent, EventConfig } from '../../../shared/events/types';
import type { AdminMonitor } from '../../../shared/monitors/types';
import { parseEventConfig } from '../../../shared/events/validation';
import { ErrorNotice } from '../../components/feedback';
import { Modal } from '../../components/Modal';

const localTime = (time: number) => {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
export function EventEditor({
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
