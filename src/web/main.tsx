import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminPage } from './AdminPage';
import { DetailPage } from './DetailPage';
import { EventDetailPage } from './EventDetailPage';
import { StatusPage } from './StatusPage';
import { Empty, Layout } from './components';
import './styles.css';

const path = location.pathname.replace(/\/$/, '') || '/';
const detail = path.match(/^\/monitors\/([^/]+)$/);
const eventDetail = path.match(/^\/events\/([^/]+)$/);
const page =
  path === '/' ? (
    <StatusPage />
  ) : path === '/admin' ? (
    <AdminPage />
  ) : detail ? (
    <DetailPage id={decodeURIComponent(detail[1])} />
  ) : eventDetail ? (
    <EventDetailPage id={decodeURIComponent(eventDetail[1])} />
  ) : (
    <Layout>
      <Empty title="页面不存在">
        这个地址没有对应的页面。
        <br />
        <a className="button secondary empty-action" href="/">
          返回状态概览
        </a>
      </Empty>
    </Layout>
  );
createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>);
