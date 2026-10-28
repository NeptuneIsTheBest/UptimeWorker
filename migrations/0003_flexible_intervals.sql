-- D1 applies each migration atomically. Replace only the interval column so the
-- monitors table and its cascading history relationships remain intact.
DROP TRIGGER summarize_check;

ALTER TABLE monitors ADD COLUMN interval_minutes_new INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(interval_minutes_new) = 'integer' AND interval_minutes_new BETWEEN 1 AND 60);
UPDATE monitors SET interval_minutes_new = interval_minutes;
ALTER TABLE monitors DROP COLUMN interval_minutes;
ALTER TABLE monitors RENAME COLUMN interval_minutes_new TO interval_minutes;

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
