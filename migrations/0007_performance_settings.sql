ALTER TABLE global_settings ADD COLUMN workers_plan TEXT NOT NULL DEFAULT 'free'
  CHECK (workers_plan IN ('free', 'paid'));
ALTER TABLE global_settings ADD COLUMN probe_concurrency INTEGER NOT NULL DEFAULT 4
  CHECK (typeof(probe_concurrency) = 'integer' AND probe_concurrency BETWEEN 1 AND 6);
ALTER TABLE global_settings ADD COLUMN max_checks_per_run INTEGER NOT NULL DEFAULT 10
  CHECK (typeof(max_checks_per_run) = 'integer' AND max_checks_per_run BETWEEN 1 AND 500);
ALTER TABLE global_settings ADD COLUMN time_budget_seconds INTEGER NOT NULL DEFAULT 50
  CHECK (typeof(time_budget_seconds) = 'integer' AND time_budget_seconds BETWEEN 40 AND 180);

CREATE INDEX monitors_due ON monitors(enabled, next_check_at, id);
