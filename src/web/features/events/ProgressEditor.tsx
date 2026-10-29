import { errorMessage, type DisplayMessage } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';
import { localizedEventTitle, PROGRESS_LABELS } from './presentation';
import { useState, type FormEvent } from 'react';
import type { AdminEvent, EventProgressTitle } from '../../../shared/events/types';
import { eventProgressOptions } from '../../../shared/events/progress';
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
  const { t, locale } = useI18n();
  const [title, setTitle] = useState<EventProgressTitle>('Updated');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayMessage | null>(null);
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
      setError(errorMessage(err, 'error.save'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('progress.title')}
      close={() => {
        if (!busy) close();
      }}
    >
      <form noValidate className="monitor-form" onSubmit={submit}>
        <div className="modal-scroll">
          <p>{localizedEventTitle(event, locale)}</p>
          <label className="field">
            {t('progress.stage')}
            <select
              autoFocus
              required
              value={title}
              onChange={(e) => setTitle(e.target.value as EventProgressTitle)}
            >
              {eventProgressOptions(event).map((option) => (
                <option key={option} value={option}>
                  {t(PROGRESS_LABELS[option])}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('progress.body')}
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
              {t(
                event.type === 'maintenance' ? 'progress.completesMaintenance' : 'progress.resolvesIncident',
              )}
            </p>
          )}
          {event.source === 'automatic' && <p className="form-note">{t('progress.automaticNote')}</p>}
          {error && <ErrorNotice message={error} />}
        </div>
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? t('common.saving') : t('progress.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
