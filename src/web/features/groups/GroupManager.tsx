import { errorMessage, type DisplayMessage } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { parseGroup } from '../../../shared/groups/validation';
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
  const { t } = useI18n();
  const [editing, setEditing] = useState<MonitorGroup | null>(null);
  const [name, setName] = useState('');
  const [order, setOrder] = useState(0);
  const [deleting, setDeleting] = useState<MonitorGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage | null>(null);
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
      const config = parseGroup({ name, sortOrder: order });
      await api(editing ? `/api/admin/groups/${editing.id}` : '/api/admin/groups', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...config, ...(editing ? { version: editing.version } : {}) }),
      });
      reset();
      changed();
    } catch (err) {
      setError(errorMessage(err, 'error.save'));
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
      setError(errorMessage(err, 'error.delete'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('groups.manage')}
      close={() => {
        if (!busy) close();
      }}
    >
      <form noValidate className="monitor-form" onSubmit={save}>
        <div className="modal-scroll">
          <p className="form-note">{t('groups.description')}</p>
          <div className="group-manager-list">
            {groups.map((group) => (
              <div className="group-manager-row" key={group.id}>
                <span>
                  <strong>{group.name}</strong>
                  <small>{t('groups.sortValue', { value: group.sortOrder })}</small>
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
                    {t('common.editNamed', { name: group.name })}
                  </button>
                  <button
                    type="button"
                    className="button small secondary"
                    disabled={busy}
                    onClick={() => setDeleting(group)}
                  >
                    {t('common.deleteNamed', { name: group.name })}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {deleting && (
            <div className="notice group-delete">
              <p>{t('groups.deleteQuestion', { name: deleting.name })}</p>
              <button
                type="button"
                className="button small secondary"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                {t('groups.cancelDelete')}
              </button>
              <button
                type="button"
                className="button small destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                {t('groups.confirmDelete')}
              </button>
            </div>
          )}
          <h3>{editing ? t('groups.edit') : t('groups.add')}</h3>
          <label className="field">
            {t('groups.name')}
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            {t('groups.sort')}
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
        </div>
        <div className="modal-actions">
          {editing && (
            <button type="button" className="button secondary" disabled={busy} onClick={reset}>
              {t('groups.cancelEdit')}
            </button>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? t('common.saving') : t('groups.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
