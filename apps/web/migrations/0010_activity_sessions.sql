-- Who is working on what, and what happened.
--
-- A development session is a person or an agent working on a task, in a
-- repository, in an environment, from a moment to a moment. An activity event
-- is one thing that happened in the development flow, with references to the
-- entities it concerns. Neither is a log: the process output stays with
-- Docker. Activity is pruned in code (ninety days, five thousand rows per
-- project); it answers "what happened this week", not audit.

CREATE TABLE dev_sessions (
  id                BIGSERIAL PRIMARY KEY,
  project_id        BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id           BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  repository_id     BIGINT REFERENCES repositories(id) ON DELETE SET NULL,
  environment_id    BIGINT REFERENCES environments(id) ON DELETE SET NULL,
  actor             TEXT NOT NULL CHECK (btrim(actor) <> ''),
  actor_kind        TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent')),
  agent             TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'abandoned')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  summary           TEXT,
  head_before       TEXT,
  head_after        TEXT,
  commits           JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX dev_sessions_project_status_idx ON dev_sessions (project_id, status, last_activity_at DESC);
CREATE INDEX dev_sessions_task_idx ON dev_sessions (task_id) WHERE task_id IS NOT NULL;

CREATE TABLE activity_events (
  id              BIGSERIAL PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind            TEXT NOT NULL CHECK (btrim(kind) <> ''),
  actor           TEXT,
  actor_kind      TEXT CHECK (actor_kind IS NULL OR actor_kind IN ('human', 'agent', 'system')),
  project_id      BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  task_id         BIGINT REFERENCES tasks(id) ON DELETE SET NULL,
  repository_id   BIGINT REFERENCES repositories(id) ON DELETE SET NULL,
  environment_id  BIGINT REFERENCES environments(id) ON DELETE SET NULL,
  session_id      BIGINT REFERENCES dev_sessions(id) ON DELETE SET NULL,
  summary         TEXT NOT NULL,
  data            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX activity_events_project_at_idx ON activity_events (project_id, at DESC);
CREATE INDEX activity_events_at_idx ON activity_events (at DESC);
CREATE INDEX activity_events_task_idx ON activity_events (task_id, at DESC) WHERE task_id IS NOT NULL;
