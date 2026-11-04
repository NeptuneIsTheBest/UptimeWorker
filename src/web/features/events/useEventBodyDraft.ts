import { useState } from 'react';
import type { EventProgressTitle } from '../../../shared/events/types';
import type { MessageKey } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';

const PROGRESS_BODY_KEYS: Record<EventProgressTitle, MessageKey> = {
  Investigating: 'progress.body.Investigating',
  Identified: 'progress.body.Identified',
  Monitoring: 'progress.body.Monitoring',
  Resolved: 'progress.body.Resolved',
  Scheduled: 'progress.body.Scheduled',
  'In Progress': 'progress.body.InProgress',
  Completed: 'progress.body.Completed',
  Updated: 'progress.body.Updated',
};

export function useEventBodyDraft(initialStage: EventProgressTitle, initialBody?: string) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => ({
    stage: initialStage,
    // null follows the template; even an empty string is an intentional manual edit.
    manualBody: initialBody ?? null,
  }));

  function setStage(stage: EventProgressTitle) {
    setDraft((current) => {
      if (current.stage === stage) return current;
      return { stage, manualBody: current.manualBody?.trim() ? current.manualBody : null };
    });
  }

  function setBody(body: string) {
    setDraft((current) => ({ ...current, manualBody: body }));
  }

  function resetBody() {
    setDraft((current) => ({ ...current, manualBody: null }));
  }

  return {
    stage: draft.stage,
    body: draft.manualBody ?? t(PROGRESS_BODY_KEYS[draft.stage]),
    setStage,
    setBody,
    resetBody,
  };
}
