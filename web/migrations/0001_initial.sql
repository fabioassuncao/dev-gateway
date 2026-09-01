CREATE TABLE instance (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton   BOOLEAN NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  name        TEXT NOT NULL CHECK (btrim(name) <> ''),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO instance (name) VALUES ('dev-gateway') ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE settings (
  key         TEXT PRIMARY KEY CHECK (btrim(key) <> ''),
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id              BIGSERIAL PRIMARY KEY,
  compose_project TEXT NOT NULL UNIQUE CHECK (btrim(compose_project) <> ''),
  working_dir     TEXT,
  repo_url        TEXT,
  repo_subpath    TEXT,
  slug            TEXT UNIQUE,
  display_name    TEXT,
  archived        BOOLEAN NOT NULL DEFAULT false,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX projects_last_seen_idx ON projects (last_seen_at DESC);
CREATE INDEX projects_repo_coordinate_idx ON projects (repo_url, repo_subpath)
  WHERE repo_url IS NOT NULL;

CREATE TABLE project_settings (
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key         TEXT NOT NULL CHECK (btrim(key) <> ''),
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, key)
);

CREATE TABLE service_settings (
  project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service     TEXT NOT NULL CHECK (btrim(service) <> ''),
  key         TEXT NOT NULL CHECK (btrim(key) <> ''),
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, service, key)
);

CREATE TABLE integrations (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (btrim(kind) <> ''),
  project_id  BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  config      JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (kind, project_id)
);

-- Persist decisions, never observations: container state, health, ports,
-- networks, URLs, logs and Git/Traefik snapshots deliberately have no table.
