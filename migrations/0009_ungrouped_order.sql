-- This row stores only the display position of monitors whose group_id is NULL.
-- Its empty internal name cannot collide with a valid user-created group name.
INSERT INTO monitor_groups(id, name, sort_order, version, created_at)
SELECT '__ungrouped__', '', COALESCE(MAX(sort_order), -1) + 1, 1, 0
FROM monitor_groups;
