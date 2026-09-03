-- A persisted Kanban order, local comments that may be published explicitly,
-- and the origin of activity. Existing names stay in place so upgrades do not
-- need a destructive table rewrite.

ALTER TABLE tasks ALTER COLUMN position TYPE BIGINT;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY project_id, status
    ORDER BY position, updated_at DESC, id
  ) * 1024 AS rank
  FROM tasks
)
UPDATE tasks SET position = ranked.rank
FROM ranked WHERE tasks.id = ranked.id;

CREATE INDEX tasks_board_order_idx
  ON tasks (project_id, status, position, id);

ALTER TABLE task_notes
  ADD COLUMN github_comment_id BIGINT,
  ADD COLUMN github_html_url TEXT,
  ADD COLUMN publish_state TEXT NOT NULL DEFAULT 'local'
    CHECK (publish_state IN ('local', 'pending', 'synced', 'error')),
  ADD COLUMN publish_error TEXT;

ALTER TABLE activity_events
  ADD COLUMN source TEXT
    CHECK (source IS NULL OR source IN ('web', 'cli', 'mcp', 'api', 'github', 'system'));
