-- Task: Portta's own unit of work.
--
-- A task exists without GitHub. A GitHub issue is an optional binding
-- (task_github_links) on top of it: the projection in github_issues stays a
-- cache with an age, and a bound task follows it, while an unbound task, or a
-- bound one edited while the App is unavailable, is local and marked pending.
-- See docs/adr/0032-portta-development-model.md.

CREATE TABLE tasks (
  id              BIGSERIAL PRIMARY KEY,
  project_id      BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_id   BIGINT REFERENCES repositories(id) ON DELETE SET NULL,
  environment_id  BIGINT REFERENCES environments(id) ON DELETE SET NULL,
  service         TEXT,
  parent_id       BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
  title           TEXT NOT NULL CHECK (btrim(title) <> ''),
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'backlog'
                  CHECK (status IN ('backlog', 'ready', 'in_progress', 'review', 'blocked', 'done')),
  priority        TEXT CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'urgent')),
  type            TEXT,
  labels          JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignee        TEXT,
  agent           TEXT,
  created_by      TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX tasks_project_status_idx ON tasks (project_id, status, updated_at DESC);
CREATE INDEX tasks_parent_idx ON tasks (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX tasks_repository_idx ON tasks (repository_id) WHERE repository_id IS NOT NULL;

CREATE TABLE task_notes (
  id          BIGSERIAL PRIMARY KEY,
  task_id     BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor       TEXT,
  actor_kind  TEXT NOT NULL DEFAULT 'human' CHECK (actor_kind IN ('human', 'agent', 'system')),
  body        TEXT NOT NULL CHECK (btrim(body) <> ''),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_notes_task_idx ON task_notes (task_id, created_at);

-- One task, one issue, at most. `local_updated_at` and `remote_updated_at`
-- are what the sync compares to tell "apply the remote" from "conflict".
CREATE TABLE task_github_links (
  task_id           BIGINT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  github_issue_id   BIGINT NOT NULL UNIQUE REFERENCES github_issues(id) ON DELETE CASCADE,
  sync_state        TEXT NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced', 'pending', 'conflict', 'error')),
  last_synced_at    TIMESTAMPTZ,
  last_error        TEXT,
  local_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  remote_updated_at TIMESTAMPTZ
);

-- Backfill: every issue (not a pull request) of a repository a Project owns
-- becomes a bound task, so the board that existed before this migration is
-- the board that exists after it. Sub-issues become parents. A temporary
-- column carries the issue id through the insert so the link is exact.
ALTER TABLE tasks ADD COLUMN backfill_issue_id BIGINT;

INSERT INTO tasks (backfill_issue_id, project_id, repository_id, title, description, status, priority, type, labels, assignee, created_by, created_at, updated_at, closed_at)
SELECT
  i.id,
  r.project_id,
  r.id,
  i.title,
  i.body,
  CASE
    WHEN i.state = 'closed' THEN 'done'
    WHEN i.workflow_status IN ('backlog', 'ready', 'in_progress', 'review', 'blocked', 'done') THEN i.workflow_status
    ELSE 'backlog'
  END,
  CASE WHEN i.priority IN ('low', 'medium', 'high', 'urgent') THEN i.priority END,
  i.issue_type,
  COALESCE((
    SELECT jsonb_agg(label) FROM jsonb_array_elements_text(i.labels) AS label
    WHERE label NOT ILIKE 'status:%' AND label NOT ILIKE 'priority:%'
  ), '[]'::jsonb),
  i.assignees ->> 0,
  'github',
  i.github_updated_at,
  i.github_updated_at,
  CASE WHEN i.state = 'closed' THEN i.github_updated_at END
FROM github_issues i
JOIN repositories r ON r.github_repository_id = i.repository_id
WHERE i.is_pull_request = false
ORDER BY i.repository_id, i.number;

INSERT INTO task_github_links (task_id, github_issue_id, sync_state, last_synced_at, local_updated_at, remote_updated_at)
SELECT t.id, i.id, 'synced', i.synced_at, i.github_updated_at, i.github_updated_at
FROM tasks t
JOIN github_issues i ON i.id = t.backfill_issue_id;

ALTER TABLE tasks DROP COLUMN backfill_issue_id;

UPDATE tasks t
SET parent_id = parent_link.task_id
FROM task_github_links child_link
JOIN github_issue_relationships rel ON rel.child_id = child_link.github_issue_id
JOIN task_github_links parent_link ON parent_link.github_issue_id = rel.parent_id
WHERE t.id = child_link.task_id;

-- Task ↔ Environment (was issue_environments). The row now names the task.
CREATE TABLE task_environments (
  task_id         BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  environment_id  BIGINT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('manual', 'label', 'branch', 'namespace')),
  branch          TEXT,
  linked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, environment_id)
);

-- One task many environments; an environment at most one task, so "what is
-- this running for" has one answer.
CREATE UNIQUE INDEX task_environments_one_task_per_env ON task_environments (environment_id);

INSERT INTO task_environments (task_id, environment_id, source, branch, linked_at)
SELECT l.task_id, ie.environment_id, ie.source, ie.branch, ie.linked_at
FROM issue_environments ie
JOIN task_github_links l ON l.github_issue_id = ie.issue_id
ON CONFLICT DO NOTHING;

DROP TABLE issue_environments;
