-- Issues, as a projection.
--
-- GitHub owns the issue. This is a cache with an age, and every row says how
-- old it is, so the panel can be honest rather than confidently wrong. A board
-- action that means "close" closes it on GitHub; the row follows.
--
-- `metadata_source` is what makes the status fallback honest: the API and the
-- UI can say *this status came from a label, not from a field*, which changes
-- what a write will do.
--
-- Comments are deliberately not projected: they are large, they change often,
-- and a link to GitHub beats a worse comment reader — the same reasoning
-- ADR 0010 used for commit lists.

CREATE TABLE github_issues (
  id                BIGSERIAL PRIMARY KEY,
  github_id         BIGINT NOT NULL UNIQUE,
  node_id           TEXT NOT NULL,
  repository_id     BIGINT NOT NULL REFERENCES github_repositories(id) ON DELETE CASCADE,
  number            INTEGER NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT,
  state             TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  state_reason      TEXT,
  issue_type        TEXT,
  workflow_status   TEXT,
  priority          TEXT,
  metadata_source   TEXT NOT NULL DEFAULT 'none' CHECK (metadata_source IN ('fields', 'labels', 'none')),
  labels            JSONB NOT NULL DEFAULT '[]'::jsonb,
  assignees         JSONB NOT NULL DEFAULT '[]'::jsonb,
  milestone         JSONB,
  html_url          TEXT NOT NULL,
  is_pull_request   BOOLEAN NOT NULL DEFAULT false,
  github_updated_at TIMESTAMPTZ NOT NULL,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (repository_id, number)
);

CREATE INDEX github_issues_repo_state_idx ON github_issues (repository_id, state);
CREATE INDEX github_issues_updated_idx ON github_issues (github_updated_at DESC);

-- Sub-issues come from GitHub's own API. The check refuses the one-step cycle
-- outright; longer cycles are refused in the code that writes here, because
-- SQL cannot see a path.
CREATE TABLE github_issue_relationships (
  parent_id BIGINT NOT NULL REFERENCES github_issues(id) ON DELETE CASCADE,
  child_id  BIGINT NOT NULL REFERENCES github_issues(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL DEFAULT 'sub_issue',
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (parent_id, child_id),
  CHECK (parent_id <> child_id)
);

CREATE INDEX github_issue_relationships_child_idx ON github_issue_relationships (child_id);
