import { displayMessage, type DisplayMessage } from '../i18n/core';
import { useI18n } from '../i18n/I18nProvider';
import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export function ErrorNotice({ message, retry }: { message: DisplayMessage; retry?: () => void }) {
  const { t, locale } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current?.closest('dialog')) ref.current.scrollIntoView({ block: 'nearest' });
  }, [message, locale]);
  return (
    <div ref={ref} className="error-notice" role="alert">
      <Icon name="info" />
      <span>{displayMessage(message, locale)}</span>
      {retry && (
        <button type="button" className="text-button" onClick={retry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      <span>{t('common.loading')}</span>
    </div>
  );
}
export function Empty({
  title,
  children,
  icon = 'pulse',
}: {
  title: string;
  children: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
