import { message } from '../i18n/core';
import { useI18n } from '../i18n/I18nProvider';
import { useState } from 'react';
import type { GlobalSettings } from '../../shared/settings/types';
import { useRemote } from '../hooks/useRemote';
import { GroupManager } from '../features/groups/GroupManager';
import { EventManager } from '../features/events/EventManager';
import { GlobalSettingsDialog } from '../features/settings/GlobalSettingsDialog';
import { Icon } from '../components/Icon';
import { Layout } from './Layout';
import { MonitorManager } from '../features/monitors/MonitorManager';
import type { AdminResponse, MonitorEditorState, MonitorNotice } from '../features/monitors/types';

export function AdminPage() {
  const { t } = useI18n();
  const remote = useRemote<AdminResponse>('/api/admin/monitors');
  const { data, refresh } = remote;
  const [editor, setEditor] = useState<MonitorEditorState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedSettings, setSavedSettings] = useState<GlobalSettings>();
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [tab, setTab] = useState<'monitors' | 'events'>('monitors');
  const [notice, setNotice] = useState<MonitorNotice | null>(null);
  return (
    <Layout admin>
      <div className="page-eyebrow">
        <span className="eyebrow-line" /> {t('page.console')}
      </div>
      <div className="admin-heading">
        <div>
          <h1>{t('nav.admin')}</h1>
          <p className="muted">{t('admin.description')}</p>
        </div>
        <div className="admin-heading-actions">
          <button className="button secondary" disabled={!data} onClick={() => setGroupsOpen(true)}>
            {t('groups.manage')}
          </button>
          <button className="button secondary" onClick={() => setSettingsOpen(true)}>
            <Icon name="shield" size={18} />
            {t('settings.title')}
          </button>
          <button
            className="button primary"
            onClick={() => setEditor('new')}
            disabled={!data || data.monitors.length >= data.limit}
          >
            <Icon name="plus" size={18} />
            {t('monitors.add')}
          </button>
        </div>
      </div>
      <div className="admin-tabs" role="tablist" aria-label={t('admin.content')}>
        <button role="tab" aria-selected={tab === 'monitors'} onClick={() => setTab('monitors')}>
          {t('admin.monitors')}
        </button>
        <button role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')}>
          {t('admin.events')}
        </button>
      </div>
      <MonitorManager
        remote={remote}
        visible={tab === 'monitors'}
        editor={editor}
        onEditorChange={setEditor}
        notice={notice}
        onNoticeChange={setNotice}
      />
      {tab === 'events' && data && <EventManager monitors={data.monitors} settings={savedSettings} />}
      {groupsOpen && (
        <GroupManager groups={data?.groups ?? []} changed={refresh} close={() => setGroupsOpen(false)} />
      )}
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
