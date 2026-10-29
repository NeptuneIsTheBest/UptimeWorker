import { useState, type FormEvent } from 'react';
import type { MonitorGroup } from '../../../shared/groups/types';
import { api } from '../../lib/api';
import { ErrorNotice } from '../../components/feedback';
import { Modal } from '../../components/Modal';

export function GroupManager({
  groups,
  changed,
  close,
}: {
  groups: MonitorGroup[];
  changed: () => void;
  close: () => void;
}) {
  const [editing, setEditing] = useState<MonitorGroup | null>(null);
  const [name, setName] = useState('');
  const [order, setOrder] = useState(0);
  const [deleting, setDeleting] = useState<MonitorGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function reset() {
    setEditing(null);
    setName('');
    setOrder(0);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(editing ? `/api/admin/groups/${editing.id}` : '/api/admin/groups', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ name, sortOrder: order, ...(editing ? { version: editing.version } : {}) }),
      });
      reset();
      changed();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/groups/${deleting.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ version: deleting.version }),
      });
      if (editing?.id === deleting.id) reset();
      setDeleting(null);
      changed();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="分组管理"
      close={() => {
        if (!busy) close();
      }}
    >
      <p className="form-note">每个节点归属一个分组。排序数字越小越靠前，未分组始终排在最后。</p>
      <div className="group-manager-list">
        {groups.map((group) => (
          <div className="group-manager-row" key={group.id}>
            <span>
              <strong>{group.name}</strong>
              <small>排序 {group.sortOrder}</small>
            </span>
            <div>
              <button
                type="button"
                className="button small secondary"
                disabled={busy}
                onClick={() => {
                  setEditing(group);
                  setName(group.name);
                  setOrder(group.sortOrder);
                  setDeleting(null);
                  setError(null);
                }}
              >
                编辑 {group.name}
              </button>
              <button
                type="button"
                className="button small secondary"
                disabled={busy}
                onClick={() => setDeleting(group)}
              >
                删除 {group.name}
              </button>
            </div>
          </div>
        ))}
      </div>
      {deleting && (
        <div className="notice group-delete">
          <p>删除「{deleting.name}」后，其中的节点将转为未分组。</p>
          <button className="button small secondary" disabled={busy} onClick={() => setDeleting(null)}>
            取消删除
          </button>
          <button className="button small destructive" disabled={busy} onClick={() => void remove()}>
            确认删除分组
          </button>
        </div>
      )}
      <form className="monitor-form" onSubmit={save}>
        <h3>{editing ? '编辑分组' : '新增分组'}</h3>
        <label className="field">
          分组名称
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          排序
          <input
            type="number"
            required
            min={0}
            max={1000000}
            step={1}
            value={order}
            onChange={(e) => setOrder(Number(e.target.value))}
          />
        </label>
        {error && <ErrorNotice message={error} />}
        <div className="modal-actions">
          {editing && (
            <button type="button" className="button secondary" disabled={busy} onClick={reset}>
              取消编辑
            </button>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? '正在保存…' : '保存分组'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
