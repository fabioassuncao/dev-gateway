-- A Repository is a Project's code, and it exists without GitHub.
--
-- Until now the only repository the panel knew was a GitHub one: a row in the
-- App's projection, linked to a Project through project_repositories. A local
-- clone with no remote, or a remote on another forge, had no place. This table
-- is that place. The GitHub row becomes optional metadata on it.
--
-- local_path is a decision the operator makes (or confirms from what the host
-- scan discovered); the scan itself is an observation the panel reads from
-- state/git and never stores. The environment ↔ repository association is
-- likewise resolved in reading, through the scan index, so no column here
-- points at an environment.
--
-- One GitHub repository belongs to one Project (the tightening ADR 0031
-- announced). The backfill keeps the oldest Project's claim.

CREATE TABLE repositories (
  id                   BIGSERIAL PRIMARY KEY,
  project_id           BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL CHECK (btrim(name) <> ''),
  role                 TEXT,
  local_path           TEXT CHECK (local_path IS NULL OR (local_path LIKE '/%' AND local_path NOT LIKE '%/../%' AND local_path NOT LIKE '%/..')),
  relative_path        TEXT CHECK (relative_path IS NULL OR (btrim(relative_path) <> '' AND relative_path NOT LIKE '/%' AND relative_path NOT LIKE '%..%')),
  remote_url           TEXT,
  provider             TEXT NOT NULL DEFAULT 'local' CHECK (provider IN ('local', 'github', 'gitlab', 'bitbucket', 'other')),
  github_repository_id BIGINT UNIQUE REFERENCES github_repositories(id) ON DELETE SET NULL,
  position             INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE UNIQUE INDEX repositories_local_path_unique ON repositories (local_path) WHERE local_path IS NOT NULL;
CREATE INDEX repositories_project_idx ON repositories (project_id, position);

-- Every GitHub repository a Project owned becomes a Repository of that Project.
-- DISTINCT ON keeps one claim per GitHub repository: the oldest Project wins.
INSERT INTO repositories (project_id, name, role, remote_url, provider, github_repository_id, position)
SELECT DISTINCT ON (pr.repository_id)
  pr.project_id, gr.name, pr.role, gr.html_url, 'github', gr.id, pr.position
FROM project_repositories pr
JOIN github_repositories gr ON gr.id = pr.repository_id
JOIN projects p ON p.id = pr.project_id
ORDER BY pr.repository_id, p.created_at, pr.position;

DROP TABLE project_repositories;
