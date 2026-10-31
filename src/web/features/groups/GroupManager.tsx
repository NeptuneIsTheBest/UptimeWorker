import { displayMessage, errorMessage, type DisplayMessage } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { parseGroup } from '../../../shared/groups/validation';
import { useState, type FormEvent } from 'react';
import { UNGROUPED_ID, type GroupListing, type MonitorGroup } from '../../../shared/groups/types';
import { orderedGroups } from '../../../shared/groups/ordering';
import { api } from '../../lib/api';
import { ErrorNotice } from '../../components/feedback';
import { Modal } from '../../components/Modal';
import { SortControls } from '../../components/SortControls';
import { useReorder } from '../../hooks/useReorder';
import { useRemote } from '../../hooks/useRemote';
import { orderItems } from '../../../shared/ordering';
import type { AdminResponse } from '../monitors/types';

export function GroupManager({
  remote,
  close,
}: {
  remote: ReturnType<typeof useRemote<AdminResponse>>;
  close: () => void;
}) {
  const { t, locale } = useI18n();
  const { refresh: changed, data } = remote;
  const [editing, setEditing] = useState<MonitorGroup | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<MonitorGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage | null>(null);
  const ordering = useReorder({
    items: data ? orderedGroups(data.groups, { ...data.ungrouped, name: t('groups.ungrouped') }) : [],
    disabled: busy || !!editing || !!deleting || remote.locked || !data,
    suspend: remote.suspend,
    save: async (items) => {
      const result = await api<GroupListing>('/api/admin/groups/order', {
        method: 'PUT',
        body: JSON.stringify({ items: orderItems(items) }),
      });
      remote.updateData((current) => ({ ...current, ...result }));
    },
  });
  const locked = busy || remote.locked;
  function reset() {
    setEditing(null);
    setName('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const config = parseGroup({ name });
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
        if (!locked) close();
      }}
    >
      <form noValidate className="monitor-form" onSubmit={save}>
        <div className="modal-scroll">
          <p className="form-note">{t('groups.description')}</p>
          <div className="group-manager-list">
            {ordering.items.map((group, index) => (
              <div className="group-manager-row" key={group.id} {...ordering.rowProps(group)}>
                <span>
                  <strong>{group.name}</strong>
                </span>
                <div>
                  <SortControls
                    name={group.name}
                    index={index}
                    count={ordering.items.length}
                    disabled={ordering.disabled}
                    handleProps={ordering.handleProps(group)}
                    move={(offset) => ordering.move(group, ordering.items[index + offset])}
                  />
                  {group.id !== UNGROUPED_ID && (
                    <>
                      <button
                        type="button"
                        className="button small secondary"
                        disabled={locked}
                        onClick={() => {
                          setEditing(group);
                          setName(group.name);
                          setDeleting(null);
                          setError(null);
                        }}
                      >
                        {t('common.editNamed', { name: group.name })}
                      </button>
                      <button
                        type="button"
                        className="button small secondary"
                        disabled={locked}
                        onClick={() => setDeleting(group)}
                      >
                        {t('common.deleteNamed', { name: group.name })}
                      </button>
                    </>
                  )}
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
                disabled={locked}
                onClick={() => setDeleting(null)}
              >
                {t('groups.cancelDelete')}
              </button>
              <button
                type="button"
                className="button small destructive"
                disabled={locked}
                onClick={() => void remove()}
              >
                {t('groups.confirmDelete')}
              </button>
            </div>
          )}
          <h3>{editing ? t('groups.edit') : t('groups.add')}</h3>
          <label className="field">
            {t('groups.name')}
            <input
              required
              maxLength={80}
              disabled={locked}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {error && <ErrorNotice message={error} />}
          {ordering.notice &&
            (ordering.notice.error ? (
              <ErrorNotice message={ordering.notice.text} />
            ) : (
              <p role="status" className="form-note">
                {displayMessage(ordering.notice.text, locale)}
              </p>
            ))}
        </div>
        <div className="modal-actions">
          {editing && (
            <button type="button" className="button secondary" disabled={locked} onClick={reset}>
              {t('groups.cancelEdit')}
            </button>
          )}
          <button className="button primary" disabled={locked}>
            {busy ? t('common.saving') : t('groups.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
