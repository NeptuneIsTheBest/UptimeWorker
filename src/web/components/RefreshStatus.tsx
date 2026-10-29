import { useEffect, useState } from 'react';
import { formatTime } from '../lib/format';
import { Icon } from './Icon';

function elapsedTime(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时 ${minutes % 60} 分`;
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}

export function RefreshStatus({
  lastRefreshedAt,
  pageRefreshSeconds,
  refreshing,
  refresh,
  card = false,
}: {
  lastRefreshedAt: number | null;
  pageRefreshSeconds: number;
  refreshing: boolean;
  refresh: () => void;
  card?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (lastRefreshedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const update = () => setNow(Date.now());
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [lastRefreshedAt]);

  return (
    <div
      className={`refresh-status ${card ? 'stat-card refresh-card' : 'refresh-strip'}`}
      aria-label="页面刷新"
    >
      <div className="refresh-time">
        <span className="stat-label">
          <Icon name="clock" size={16} /> 上次刷新
        </span>
        {lastRefreshedAt === null ? (
          <span className="refresh-pending">尚未成功刷新</span>
        ) : (
          <time
            className={card ? 'stat-value time-value' : 'tabular'}
            dateTime={new Date(lastRefreshedAt).toISOString()}
            title={new Date(lastRefreshedAt).toLocaleString('zh-CN', { hour12: false })}
          >
            {formatTime(lastRefreshedAt)}
          </time>
        )}
      </div>
      <div className="refresh-details">
        {lastRefreshedAt !== null && (
          <span className="refresh-elapsed tabular">已过去 {elapsedTime(now - lastRefreshedAt)}</span>
        )}
        <span className="refresh-interval">
          {pageRefreshSeconds === 0 ? '自动刷新已关闭' : `每 ${pageRefreshSeconds} 秒自动刷新`}
        </span>
      </div>
      <button type="button" className="text-button refresh-button" onClick={refresh} aria-busy={refreshing}>
        {refreshing ? <span className="spinner" /> : <Icon name="refresh" size={14} />}
        立即刷新
      </button>
    </div>
  );
}
