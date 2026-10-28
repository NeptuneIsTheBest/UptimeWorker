import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  STATUS_LABELS,
  type DailyStat,
  type MonitorStatus,
  type ProbeResult,
  type PublicMonitor,
} from '../shared/types';

export function Icon({
  name = 'pulse',
  size = 20,
  ...props
}: {
  name?: string;
  size?: number;
  className?: string;
}) {
  const paths: Record<string, ReactNode> = {
    pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18" />
      </>
    ),
    server: (
      <>
        <rect x="4" y="3" width="16" height="7" rx="2" />
        <rect x="4" y="14" width="16" height="7" rx="2" />
        <path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    back: <path d="m14 5-7 7 7 7M7 12h14" />,
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    edit: (
      <>
        <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z" />
      </>
    ),
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8z" />,
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
  };
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.pulse}
    </svg>
  );
}
export function Layout({
  children,
  admin = false,
  siteName = 'UptimeWorker',
}: {
  children: ReactNode;
  admin?: boolean;
  siteName?: string;
}) {
  useEffect(() => {
    document.title = `${siteName} · ${admin ? '监控管理' : '服务状态'}`;
  }, [siteName, admin]);
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a href="/" className="brand" title={siteName}>
            <span className="brand-mark">
              <Icon size={24} />
            </span>
            <span className="brand-name">
              {siteName === 'UptimeWorker' ? (
                <>
                  Uptime<span className="brand-light">Worker</span>
                </>
              ) : (
                siteName
              )}
            </span>
          </a>
          <nav aria-label="主导航">
            <a href="/" className={!admin ? 'active' : ''}>
              状态概览
            </a>
            <a href="/admin" className={admin ? 'active' : ''}>
              监控管理
            </a>
          </nav>
          <span className="header-note">
            <span className="live-dot" />
            持续观测中
          </span>
        </div>
      </header>
      <main className="main-content">{children}</main>
      <footer className="site-footer">
        <span>
          <Icon size={15} /> UptimeWorker
        </span>
        <span>让每一次连接，都有迹可循。</span>
        <span>每日统计按 UTC 汇总</span>
      </footer>
    </>
  );
}
export const formatTime = (time: number | null, full = false) =>
  time === null
    ? '尚未检测'
    : new Intl.DateTimeFormat('zh-CN', {
        ...(full ? ({ month: '2-digit', day: '2-digit' } as const) : {}),
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(time);
export const percent = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
export const latency = (value: number | null) => (value === null ? '—' : `${value.toLocaleString()} ms`);
export function effectiveStatus(monitor: PublicMonitor, now: number): MonitorStatus {
  return ['up', 'down'].includes(monitor.status) &&
    monitor.lastCheckedAt !== null &&
    now - monitor.lastCheckedAt > monitor.intervalMinutes * 120_000
    ? 'stale'
    : monitor.status;
}
export function StatusBadge({ status }: { status: MonitorStatus }) {
  return (
    <span className={`status-badge ${status}`}>
      <span className="status-dot" />
      {STATUS_LABELS[status]}
    </span>
  );
}
export function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export function HistoryBars({ days }: { days: DailyStat[] }) {
  return (
    <div className="history">
      <div className="history-bars" aria-label="最近 90 天每日检测成功率（UTC）">
        {days.map((day) => (
          <span
            key={day.day}
            className={`history-bar ${day.uptime === null ? 'empty' : day.uptime === 100 ? 'up' : day.uptime === 0 ? 'down' : 'partial'}`}
            title={`${day.day} UTC · ${day.total ? `${percent(day.uptime)} · ${day.successful}/${day.total} 次成功` : '暂无数据'}`}
          />
        ))}
      </div>
      <div className="history-labels">
        <span>90 天前</span>
        <span>每日可用率 · UTC</span>
        <span>今天</span>
      </div>
    </div>
  );
}
export function Legend() {
  return (
    <div className="legend">
      <span>
        <i className="legend-dot up" />
        正常
      </span>
      <span>
        <i className="legend-dot partial" />
        部分异常
      </span>
      <span>
        <i className="legend-dot down" />
        异常
      </span>
      <span>
        <i className="legend-dot empty" />
        无数据
      </span>
    </div>
  );
}
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
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const dialog = ref.current;
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="关闭">
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ResponseChart({
  checks,
  now,
  intervalMinutes,
}: {
  checks: ProbeResult[];
  now: number;
  intervalMinutes: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const hasData = checks.length > 0;
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [hasData]);
  if (!checks.length)
    return (
      <Empty title="还没有响应时间数据" icon="pulse">
        定时检测完成后，这里将展示最近 24 小时的响应趋势。
      </Empty>
    );
  const w = width,
    h = 210,
    x0 = 48,
    right = 18,
    y0 = 18,
    bottom = 30;
  const max = Math.max(100, Math.ceil(Math.max(...checks.map((c) => c.latencyMs)) / 100) * 100);
  const since = now - 86_400_000;
  const x = (time: number) => x0 + Math.max(0, Math.min(1, (time - since) / 86_400_000)) * (w - x0 - right);
  const y = (ms: number) => y0 + (1 - ms / max) * (h - y0 - bottom);
  let d = '';
  checks.forEach((c, index) => {
    const previous = checks[index - 1];
    d += `${!previous || c.checkedAt - previous.checkedAt > intervalMinutes * 120_000 ? 'M' : 'L'} ${x(c.checkedAt)} ${y(c.latencyMs)} `;
  });
  return (
    <div className="chart-wrap" ref={container}>
      <svg
        className="response-chart"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="最近 24 小时响应时间折线图，红点表示检测失败"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((n) => (
          <g key={n}>
            <line
              x1={x0}
              x2={w - right}
              y1={y(n * max)}
              y2={y(n * max)}
              stroke="var(--line)"
              strokeDasharray="3 5"
            />
            <text x={x0 - 12} y={y(n * max) + 4} textAnchor="end">
              {Math.round(n * max)}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--green)" strokeWidth="2" strokeLinejoin="round" />
        {checks
          .filter((c) => !c.ok || checks.length === 1)
          .map((c) => (
            <circle
              key={c.checkedAt}
              cx={x(c.checkedAt)}
              cy={y(c.latencyMs)}
              r="3"
              fill={c.ok ? 'var(--green)' : 'var(--red)'}
            >
              <title>
                {formatTime(c.checkedAt)} · {c.ok ? '检测成功' : '检测失败'}
              </title>
            </circle>
          ))}
        {(w < 500 ? [0, 12, 24] : [0, 6, 12, 18, 24]).map((hours) => (
          <text
            key={hours}
            x={x(since + hours * 3_600_000)}
            y={h - 4}
            textAnchor={hours === 0 ? 'start' : hours === 24 ? 'end' : 'middle'}
          >
            {hours === 24 ? '现在' : `${24 - hours} 小时前`}
          </text>
        ))}
      </svg>
    </div>
  );
}
