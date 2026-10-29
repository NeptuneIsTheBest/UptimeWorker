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
        <span className="eyebrow-line" /> MONITORING CONSOLE
      </div>
      <div className="admin-heading">
        <div>
          <h1>监控管理</h1>
          <p className="muted">管理监控、服务器分组与服务事件。</p>
        </div>
        <div className="admin-heading-actions">
          <button className="button secondary" disabled={!data} onClick={() => setGroupsOpen(true)}>
            分组管理
          </button>
          <button className="button secondary" onClick={() => setSettingsOpen(true)}>
            <Icon name="shield" size={18} />
            全局设置
          </button>
          <button
            className="button primary"
            onClick={() => setEditor('new')}
            disabled={!data || data.monitors.length >= data.limit}
          >
            <Icon name="plus" size={18} />
            新增监控
          </button>
        </div>
      </div>
      <div className="admin-tabs" role="tablist" aria-label="管理内容">
        <button role="tab" aria-selected={tab === 'monitors'} onClick={() => setTab('monitors')}>
          监控
        </button>
        <button role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')}>
          事件
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
              text: '全局设置已保存，页面刷新和自动事件设置已生效。WAF 设置应用于新的连接测试及下一轮调度。',
              error: false,
            });
          }}
        />
      )}
    </Layout>
  );
}
