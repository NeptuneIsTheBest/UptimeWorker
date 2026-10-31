-- Initial release schema. Apply to an empty database.
CREATE TABLE monitor_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
-- This row stores only the display position of monitors whose group_id is NULL.
-- Its empty internal name cannot collide with a valid user-created group name.
INSERT INTO monitor_groups(id, name, sort_order, version, created_at)
VALUES ('__ungrouped__', '', 0, 1, 0);

CREATE TABLE monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'tcp')),
  config_json TEXT NOT NULL,
  timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds BETWEEN 1 AND 30),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  last_ok INTEGER,
  last_latency_ms INTEGER,
  last_error_code TEXT,
  interval_minutes INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(interval_minutes) = 'integer' AND interval_minutes BETWEEN 1 AND 60),
  group_id TEXT REFERENCES monitor_groups(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(sort_order) = 'integer' AND sort_order >= 0)
);
CREATE INDEX monitors_due ON monitors(enabled, next_check_at, id);
CREATE INDEX monitors_display_order ON monitors(group_id, sort_order, created_at, id);

CREATE TABLE check_results (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  monitor_version INTEGER NOT NULL,
  scheduled_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  http_status INTEGER,
  error_code TEXT,
  PRIMARY KEY (monitor_id, scheduled_at)
) WITHOUT ROWID;
CREATE INDEX checks_monitor_time ON check_results(monitor_id, checked_at);
CREATE INDEX checks_retention ON check_results(checked_at);

CREATE TABLE daily_stats (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  total INTEGER NOT NULL,
  successful INTEGER NOT NULL,
  PRIMARY KEY (monitor_id, day)
) WITHOUT ROWID;
CREATE INDEX daily_retention ON daily_stats(day);

CREATE TABLE scheduler_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_completed_slot INTEGER NOT NULL DEFAULT 0
);
INSERT INTO scheduler_state(id) VALUES (1);

CREATE TABLE global_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  waf_bypass_enabled INTEGER NOT NULL DEFAULT 0 CHECK (waf_bypass_enabled IN (0, 1)),
  waf_bypass_token TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  page_refresh_seconds INTEGER NOT NULL DEFAULT 30
    CHECK (typeof(page_refresh_seconds) = 'integer' AND
      (page_refresh_seconds = 0 OR page_refresh_seconds BETWEEN 5 AND 3600)),
  auto_incident_after_minutes INTEGER NOT NULL DEFAULT 5
    CHECK (typeof(auto_incident_after_minutes) = 'integer' AND auto_incident_after_minutes BETWEEN 0 AND 1440),
  workers_plan TEXT NOT NULL DEFAULT 'free' CHECK (workers_plan IN ('free', 'paid')),
  probe_concurrency INTEGER NOT NULL DEFAULT 4
    CHECK (typeof(probe_concurrency) = 'integer' AND probe_concurrency BETWEEN 1 AND 6),
  max_checks_per_run INTEGER NOT NULL DEFAULT 10
    CHECK (typeof(max_checks_per_run) = 'integer' AND max_checks_per_run BETWEEN 1 AND 500),
  time_budget_seconds INTEGER NOT NULL DEFAULT 50
    CHECK (typeof(time_budget_seconds) = 'integer' AND time_budget_seconds BETWEEN 40 AND 180)
);
INSERT INTO global_settings(id) VALUES (1);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('incident', 'maintenance')),
  source TEXT NOT NULL CHECK (source IN ('manual', 'automatic')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'stopped')),
  starts_at INTEGER,
  ends_at INTEGER,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  write_token TEXT NOT NULL DEFAULT '',
  auto_monitor_id TEXT REFERENCES monitors(id) ON DELETE SET NULL,
  CHECK ((type = 'incident' AND starts_at IS NULL AND ends_at IS NULL) OR
    (type = 'maintenance' AND starts_at IS NOT NULL AND ends_at > starts_at))
);
CREATE INDEX events_recent ON events(updated_at DESC, id DESC);
CREATE INDEX events_open_recent ON events(updated_at DESC, id DESC) WHERE status = 'open';
CREATE INDEX events_closed_recent ON events(updated_at DESC, id DESC) WHERE status != 'open';
CREATE INDEX events_monitor_status ON events(auto_monitor_id, status);
CREATE UNIQUE INDEX events_one_open_auto ON events(auto_monitor_id)
  WHERE source = 'automatic' AND status = 'open';

CREATE TABLE event_monitors (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  monitor_key TEXT NOT NULL,
  monitor_id TEXT REFERENCES monitors(id) ON DELETE SET NULL,
  monitor_name TEXT NOT NULL,
  PRIMARY KEY (event_id, monitor_key)
);
CREATE INDEX event_monitors_monitor ON event_monitors(monitor_id, event_id);

CREATE TABLE event_updates (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT CHECK (status IN ('open', 'resolved', 'stopped')),
  source TEXT NOT NULL CHECK (source IN ('manual', 'automatic')),
  created_at INTEGER NOT NULL,
  title TEXT NOT NULL CHECK (title IN (
    'Scheduled', 'Updated', 'In Progress', 'Completed',
    'Investigating', 'Identified', 'Monitoring', 'Resolved', 'Stopped'
  ) AND (title != 'Stopped' OR source = 'automatic'))
);
CREATE INDEX event_updates_event ON event_updates(event_id, created_at, id);

CREATE TABLE monitor_outages (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  last_failed_at INTEGER NOT NULL
);

-- Keep completed suppression intervals even if an announcement is deleted. A
-- maintenance window between two probes must still break the failure streak.
CREATE TABLE event_suppressions (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX event_suppressions_monitor ON event_suppressions(monitor_id, starts_at, ends_at);
CREATE INDEX event_suppressions_event ON event_suppressions(event_id);
CREATE INDEX event_suppressions_retention ON event_suppressions(ends_at);

CREATE TRIGGER reset_pending_outage AFTER UPDATE ON monitors
WHEN NEW.last_checked_at IS NULL AND OLD.last_checked_at IS NOT NULL
BEGIN
  DELETE FROM monitor_outages WHERE monitor_id = NEW.id;
END;

CREATE TRIGGER reset_disabled_auto_events AFTER UPDATE OF auto_incident_after_minutes ON global_settings
WHEN NEW.auto_incident_after_minutes != OLD.auto_incident_after_minutes
  AND (NEW.auto_incident_after_minutes = 0 OR OLD.auto_incident_after_minutes = 0)
BEGIN
  DELETE FROM monitor_outages;
END;

CREATE TRIGGER stop_deleted_monitor_events BEFORE DELETE ON monitors
BEGIN
  UPDATE event_monitors SET monitor_name = OLD.name WHERE monitor_id = OLD.id;
  INSERT INTO event_updates (id, event_id, title, body, status, source, created_at)
    SELECT 'stop-' || id, id, 'Stopped', '节点已删除，已停止跟踪。', 'stopped', 'automatic',
      CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    FROM events WHERE auto_monitor_id = OLD.id AND status = 'open';
  UPDATE events SET status = 'stopped', version = version + 1,
    ended_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER),
    updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
    WHERE auto_monitor_id = OLD.id AND status = 'open';
END;

-- The unique check insertion is the only event that advances current state and counters.
-- INSERT OR IGNORE on a replay cannot run this trigger and inflate the aggregates.
-- One accepted check drives statistics AND incidents atomically. The event
-- trigger is guarded against obsolete versions and out-of-order samples; it
-- does not depend on the execution order of separate AFTER INSERT triggers.
CREATE TRIGGER summarize_check AFTER INSERT ON check_results
BEGIN
  INSERT INTO daily_stats(monitor_id, day, total, successful)
  VALUES (NEW.monitor_id, strftime('%Y-%m-%d', NEW.checked_at / 1000, 'unixepoch'), 1, NEW.ok)
  ON CONFLICT (monitor_id, day) DO UPDATE SET
    total = total + 1, successful = successful + NEW.ok;

  INSERT INTO event_updates(id, event_id, title, body, status, source, created_at)
    SELECT 'recovery-' || e.id, e.id, 'Resolved', '检测已恢复正常。', 'resolved', 'automatic', NEW.checked_at
    FROM events e JOIN monitors m ON m.id = e.auto_monitor_id
    WHERE m.id = NEW.monitor_id AND m.version = NEW.monitor_version AND m.enabled = 1
      AND (m.last_checked_at IS NULL OR m.last_checked_at <= NEW.checked_at)
      AND e.status = 'open' AND NEW.ok = 1;
  UPDATE events SET status = 'resolved', ended_at = NEW.checked_at,
    updated_at = MAX(updated_at, NEW.checked_at), version = version + 1
    WHERE auto_monitor_id = NEW.monitor_id AND status = 'open' AND NEW.ok = 1
      AND EXISTS (SELECT 1 FROM monitors m WHERE m.id = NEW.monitor_id
        AND m.version = NEW.monitor_version AND m.enabled = 1
        AND (m.last_checked_at IS NULL OR m.last_checked_at <= NEW.checked_at));

  DELETE FROM monitor_outages WHERE monitor_id = NEW.monitor_id
    AND EXISTS (SELECT 1 FROM monitors m WHERE m.id = NEW.monitor_id
      AND m.version = NEW.monitor_version AND m.enabled = 1
      AND (m.last_checked_at IS NULL OR m.last_checked_at <= NEW.checked_at))
    AND (NEW.ok = 1 OR (SELECT auto_incident_after_minutes FROM global_settings WHERE id = 1) = 0
      OR NEW.checked_at - last_failed_at > (SELECT interval_minutes * 120000 FROM monitors WHERE id = NEW.monitor_id)
      OR EXISTS (SELECT 1 FROM event_suppressions s WHERE s.monitor_id = NEW.monitor_id
        AND s.starts_at <= NEW.checked_at AND (s.ends_at IS NULL OR s.ends_at > monitor_outages.started_at)));

  INSERT INTO monitor_outages(monitor_id, started_at, last_failed_at)
    SELECT m.id, NEW.checked_at, NEW.checked_at FROM monitors m
    WHERE m.id = NEW.monitor_id AND m.version = NEW.monitor_version AND m.enabled = 1
      AND (m.last_checked_at IS NULL OR m.last_checked_at <= NEW.checked_at) AND NEW.ok = 0
      AND (SELECT auto_incident_after_minutes FROM global_settings WHERE id = 1) > 0
      AND NOT EXISTS (SELECT 1 FROM events WHERE auto_monitor_id = m.id AND status = 'open')
      AND NOT EXISTS (SELECT 1 FROM event_suppressions s WHERE s.monitor_id = m.id
        AND s.starts_at <= NEW.checked_at AND (s.ends_at IS NULL OR s.ends_at > NEW.checked_at))
    ON CONFLICT(monitor_id) DO UPDATE SET last_failed_at = NEW.checked_at;

  INSERT INTO events(id, title, body, type, source, status, started_at, created_at, updated_at, auto_monitor_id)
    SELECT 'auto-' || m.id || '-' || NEW.scheduled_at, m.name || ' 服务异常',
      '检测持续失败，恢复后将自动更新。',
      'incident', 'automatic', 'open', o.started_at, NEW.checked_at, NEW.checked_at, m.id
    FROM monitors m JOIN monitor_outages o ON o.monitor_id = m.id
    WHERE m.id = NEW.monitor_id AND m.version = NEW.monitor_version AND m.enabled = 1
      AND (m.last_checked_at IS NULL OR m.last_checked_at <= NEW.checked_at) AND NEW.ok = 0
      AND (SELECT auto_incident_after_minutes FROM global_settings WHERE id = 1) > 0
      AND NEW.checked_at - o.started_at >= (SELECT auto_incident_after_minutes * 60000 FROM global_settings WHERE id = 1)
      AND NOT EXISTS (SELECT 1 FROM events WHERE auto_monitor_id = m.id AND status = 'open');
  INSERT INTO event_monitors(event_id, monitor_key, monitor_id, monitor_name)
    SELECT e.id, m.id, m.id, m.name FROM events e JOIN monitors m ON m.id = e.auto_monitor_id
    WHERE e.id = 'auto-' || NEW.monitor_id || '-' || NEW.scheduled_at;
  DELETE FROM monitor_outages WHERE monitor_id = NEW.monitor_id
    AND EXISTS (SELECT 1 FROM events WHERE auto_monitor_id = NEW.monitor_id AND status = 'open');

  UPDATE monitors SET last_checked_at = NEW.checked_at, last_ok = NEW.ok,
    last_latency_ms = NEW.latency_ms, last_error_code = NEW.error_code,
    next_check_at = NEW.scheduled_at + interval_minutes * 60000
  WHERE id = NEW.monitor_id AND version = NEW.monitor_version
    AND (last_checked_at IS NULL OR last_checked_at <= NEW.checked_at);
END;
