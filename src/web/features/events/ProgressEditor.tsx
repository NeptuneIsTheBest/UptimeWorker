import { useState, type FormEvent } from 'react';
import type { AdminEvent, EventProgressTitle } from '../../../shared/events/types';
import { EVENT_PROGRESS_LABELS, eventProgressOptions } from '../../../shared/events/progress';
import { parseEventUpdateConfig } from '../../../shared/events/validation';
import { api } from '../../lib/api';
import { ErrorNotice } from '../../components/feedback';
import { Modal } from '../../components/Modal';

export function ProgressEditor({
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
