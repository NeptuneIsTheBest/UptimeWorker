ALTER TABLE monitors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(sort_order) = 'integer' AND sort_order >= 0);

WITH positions AS MATERIALIZED (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY created_at, id) - 1 AS position
  FROM monitors
)
UPDATE monitors SET sort_order = (SELECT position FROM positions WHERE positions.id = monitors.id);

CREATE INDEX monitors_display_order ON monitors(group_id, sort_order, created_at, id);
