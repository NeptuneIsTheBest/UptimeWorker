CREATE TABLE monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('http', 'tcp')),
  config_json TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes IN (5, 10, 15, 30, 60)),
  timeout_seconds INTEGER NOT NULL CHECK (timeout_seconds BETWEEN 1 AND 30),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  last_ok INTEGER,
  last_latency_ms INTEGER,
  last_error_code TEXT
);

CREATE TABLE check_results (
  id INTEGER PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  monitor_version INTEGER NOT NULL,
  scheduled_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  http_status INTEGER,
  error_code TEXT,
  UNIQUE (monitor_id, scheduled_at)
);
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

-- The unique check insertion is the only event that advances current state and counters.
-- INSERT OR IGNORE on a replay cannot run this trigger and inflate the aggregates.
CREATE TRIGGER summarize_check AFTER INSERT ON check_results
BEGIN
  INSERT INTO daily_stats(monitor_id, day, total, successful)
  VALUES (NEW.monitor_id, strftime('%Y-%m-%d', NEW.checked_at / 1000, 'unixepoch'), 1, NEW.ok)
  ON CONFLICT (monitor_id, day) DO UPDATE SET
    total = total + 1,
    successful = successful + NEW.ok;

  UPDATE monitors SET
    last_checked_at = NEW.checked_at,
    last_ok = NEW.ok,
    last_latency_ms = NEW.latency_ms,
    last_error_code = NEW.error_code,
    next_check_at = NEW.scheduled_at + interval_minutes * 60000
  WHERE id = NEW.monitor_id AND version = NEW.monitor_version
    AND (last_checked_at IS NULL OR last_checked_at <= NEW.checked_at);
END;
