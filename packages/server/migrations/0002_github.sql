-- The GitHub projection.
--
-- Nothing here is a credential. An installation token lives for an hour, is
-- minted on demand and cached in memory; it is never written to a row, a log
-- line or an API response. What is stored is what the panel is allowed to see
-- and when it last looked, so every screen can say how old the answer is.
--
-- github_repositories is also the authorisation boundary: an operation on a
-- repository absent from it is refused before a request is made, the way
-- docker/allowlist.ts refuses a Docker call before emitting it.

CREATE TABLE github_installations (
  id              BIGSERIAL PRIMARY KEY,
  installation_id BIGINT NOT NULL UNIQUE,
  account_login   TEXT NOT NULL CHECK (btrim(account_login) <> ''),
  account_type    TEXT NOT NULL,
  target_id       BIGINT,
  suspended       BOOLEAN NOT NULL DEFAULT false,
  permissions     JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE github_repositories (
  id              BIGSERIAL PRIMARY KEY,
  github_id       BIGINT NOT NULL UNIQUE,
  node_id         TEXT NOT NULL,
  installation_id BIGINT NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  owner           TEXT NOT NULL,
  name            TEXT NOT NULL,
  full_name       TEXT NOT NULL UNIQUE,
  default_branch  TEXT,
  private         BOOLEAN NOT NULL,
  html_url        TEXT NOT NULL,
  archived        BOOLEAN NOT NULL DEFAULT false,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX github_repositories_installation_idx
  ON github_repositories (installation_id);

-- One row per sync scope, so a run can be resumed and a failure is visible
-- rather than silent. Written with ON CONFLICT so two panels sharing one
-- database do not need a single-writer assumption.
CREATE TABLE github_sync_state (
  scope          TEXT PRIMARY KEY,
  cursor         TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error     TEXT
);
