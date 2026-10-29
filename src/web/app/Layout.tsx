import { useEffect, type ReactNode } from 'react';
import { Icon } from '../components/Icon';

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
