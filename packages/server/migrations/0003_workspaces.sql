-- The user's project: a decision, not an observation.
--
-- `projects` is what this host is *running* — one Compose project, derived from
-- Docker, ephemeral, namespaced per ADR 0006. A workspace is what a person
-- decided: a name, some repositories, and any number of those environments. It
-- does not disappear when nothing is up, which is the whole point.
--
-- The existing meaning of "project" in the Docker-facing API is untouched, so
-- GET /api/projects still answers exactly what it answered before.

CREATE TABLE workspaces (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE CHECK (btrim(slug) <> ''),
  name        TEXT NOT NULL CHECK (btrim(name) <> ''),
  description TEXT,
  archived    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One repository may belong to several workspaces, and a monorepo is one
-- repository in one workspace. `role` is free text with a documented
-- vocabulary rather than an enum, so adding one later is not a migration.
CREATE TABLE workspace_repositories (
  workspace_id  BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repository_id BIGINT NOT NULL REFERENCES github_repositories(id) ON DELETE CASCADE,
  role          TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, repository_id)
);

-- How a running Compose project maps to a workspace. Nullable on both sides on
-- purpose: an environment with no workspace, and a workspace with nothing
-- running, are both normal. `source` records *why* the mapping exists, so the
-- UI can explain an adoption instead of presenting it.
CREATE TABLE workspace_environments (
  workspace_id BIGINT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('manual', 'label', 'repo-match')),
  PRIMARY KEY (workspace_id, project_id)
);

-- An environment belongs to at most one workspace: two workspaces claiming one
-- running project would make "which product is this" unanswerable.
CREATE UNIQUE INDEX workspace_environments_one_workspace_per_env
  ON workspace_environments (project_id);
