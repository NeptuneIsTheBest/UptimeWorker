import { message } from '../i18n/core';
import { useI18n } from '../i18n/I18nProvider';
import { useState } from 'react';
import type { GlobalSettings } from '../../shared/settings/types';
import { useRemote } from '../hooks/useRemote';
import { usePageScroll, usePageState } from '../hooks/usePageState';
import { GroupManager } from '../features/groups/GroupManager';
import { EventManager } from '../features/events/EventManager';
import { GlobalSettingsDialog } from '../features/settings/GlobalSettingsDialog';
import { PerformancePanel } from '../features/settings/PerformancePanel';
import { RefreshStatus } from '../components/RefreshStatus';
import { Icon } from '../components/Icon';
import { Layout } from './Layout';
import { MonitorManager } from '../features/monitors/MonitorManager';
import type { AdminResponse, MonitorEditorState, MonitorNotice } from '../features/monitors/types';

export function AdminPage() {
  const { t } = useI18n();
  const remote = useRemote<AdminResponse>('/api/admin/monitors');
  const { data } = remote;
  const [editor, setEditor] = useState<MonitorEditorState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedSettings, setSavedSettings] = useState<GlobalSettings>();
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [tab, setTab] = usePageState<'monitors' | 'events' | 'performance'>(
    'adminTab',
    'monitors',
    (value): value is 'monitors' | 'events' | 'performance' =>
      value === 'monitors' || value === 'events' || value === 'performance',
  );
  const [eventsReady, setEventsReady] = useState(false);
  const [performanceReady, setPerformanceReady] = useState(false);
  usePageScroll(
    Boolean(data) && (tab !== 'events' || eventsReady) && (tab !== 'performance' || performanceReady),
  );
  const [performanceVisited, setPerformanceVisited] = useState(tab === 'performance');
  const [notice, setNotice] = useState<MonitorNotice | null>(null);
  return (
    <Layout admin>
      <div className="admin-heading">
        <div>
          <h1>{t('nav.admin')}</h1>
        </div>
        <div className="admin-heading-actions">
          <button
            className="button secondary"
            disabled={!data || remote.locked}
            onClick={() => setGroupsOpen(true)}
          >
            {t('groups.manage')}
          </button>
          <button className="button secondary" disabled={remote.locked} onClick={() => setSettingsOpen(true)}>
            <Icon name="shield" size={18} />
            {t('settings.title')}
          </button>
          {tab === 'monitors' && (
            <button
              className="button primary"
              onClick={() => setEditor('new')}
              disabled={!data || remote.locked}
            >
              <Icon name="plus" size={18} />
              {t('monitors.add')}
            </button>
          )}
        </div>
      </div>
      <div className="admin-tabs" role="tablist" aria-label={t('admin.content')}>
        <button
          role="tab"
          disabled={remote.locked}
          aria-selected={tab === 'monitors'}
          onClick={() => setTab('monitors')}
        >
          {t('admin.monitors')}
        </button>
        <button
          role="tab"
          disabled={remote.locked}
          aria-selected={tab === 'events'}
          onClick={() => setTab('events')}
        >
          {t('admin.events')}
        </button>
        <button
          role="tab"
          disabled={remote.locked}
          aria-selected={tab === 'performance'}
          onClick={() => {
            setPerformanceVisited(true);
            setTab('performance');
          }}
        >
          {t('performance.tab')}
        </button>
      </div>
      <MonitorManager
        remote={remote}
        visible={tab === 'monitors'}
        orderingDisabled={groupsOpen || settingsOpen}
        editor={editor}
        onEditorChange={setEditor}
        notice={notice}
        onNoticeChange={setNotice}
      />
      {tab === 'events' && data && (
        <EventManager monitors={data.monitors} settings={savedSettings} onReadyChange={setEventsReady} />
      )}
      {performanceVisited && (
        <div hidden={tab !== 'performance'}>
          <RefreshStatus {...remote} />
          <PerformancePanel
            monitors={data?.monitors}
            monitorError={remote.error}
            onReadyChange={setPerformanceReady}
            saved={(settings) => {
              remote.refreshWithSettings(settings);
              setSavedSettings(settings);
            }}
          />
        </div>
      )}
      {groupsOpen && <GroupManager remote={remote} close={() => setGroupsOpen(false)} />}
      {settingsOpen && (
        <GlobalSettingsDialog
          monitors={data?.monitors ?? []}
          close={() => setSettingsOpen(false)}
          saved={(settings) => {
            remote.refreshWithSettings(settings);
            setSavedSettings(settings);
            setSettingsOpen(false);
            setNotice({
              text: message('settings.saved'),
              error: false,
            });
          }}
        />
      )}
    </Layout>
  );
}
