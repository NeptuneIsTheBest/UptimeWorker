import { useI18n } from '../i18n/I18nProvider';
import { AdminPage } from './AdminPage';
import { DetailPage } from '../features/monitors/DetailPage';
import { EventDetailPage } from '../features/events/EventDetailPage';
import { StatusPage } from '../features/status/StatusPage';
import { Empty } from '../components/feedback';
import { Layout } from './Layout';

export function App() {
  const { t } = useI18n();
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
        <Empty title={t('page.notFound')}>
          {t('page.notFoundDescription')}
          <br />
          <a className="button secondary empty-action" href="/">
            {t('nav.back')}
          </a>
        </Empty>
      </Layout>
    );
  return page;
}
