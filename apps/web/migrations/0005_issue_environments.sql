-- The join this whole sequence exists for.
--
-- GitHub knows #182 is In Progress on branch fix/182-tcp-proxy. Only the Dev
-- Gateway knows that branch is running as base-empresarial-issue182, with web
-- and api on web.issue-182.localhost, and what its logs say. This table is
-- where those two halves meet.
--
-- Linking writes one row. It never starts, stops, creates or removes anything.

CREATE TABLE issue_environments (
  issue_id      BIGINT NOT NULL REFERENCES github_issues(id) ON DELETE CASCADE,
  project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('manual', 'label', 'branch', 'namespace')),
  branch        TEXT,
  -- Reserved: one repository, several working trees. Null today, and it costs
  -- nothing to keep the worktree model open.
  worktree_path TEXT,
  linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, project_id)
);

-- The composite key gives one issue many environments; this index gives an
-- environment at most one issue, so "what is this running for" has one answer.
CREATE UNIQUE INDEX issue_environments_one_issue_per_env
  ON issue_environments (project_id);
