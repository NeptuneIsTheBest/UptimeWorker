import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <Icon name="info" />
      <span>{message}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          重试
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      <span>正在读取服务状态…</span>
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
