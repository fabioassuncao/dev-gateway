-- Files attached to a task: a screenshot of the bug, the log that proves it,
-- the JSON the API actually returned.
--
-- The bytes live in this table rather than on disk, and that is the decision
-- worth writing down. Every filesystem path the panel touches is a channel
-- shared with the host — `state/metrics` is written by the collector,
-- `state/runner` is read by the runner, `traefik-dynamic` is read by Traefik.
-- An attachment is none of those: it belongs to a task, it is only ever read
-- back through the API, and it must disappear when the task does. That makes
-- it a durable decision, and ADR 0013 puts durable decisions in PostgreSQL.
--
-- Storing it here also means an existing install gains attachments by running
-- a migration rather than by re-running Compose with a new mount, and that a
-- database backup is a complete backup.
--
-- The cost is database size, so the size limits are enforced in the panel
-- (see ATTACHMENT_LIMITS in src/server/core/attachments.ts) and repeated here
-- as a CHECK, because a limit that only exists in one process is not a limit.

CREATE TABLE task_attachments (
  id           BIGSERIAL PRIMARY KEY,
  task_id      BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL CHECK (btrim(filename) <> '' AND length(filename) <= 255),
  content_type TEXT NOT NULL CHECK (btrim(content_type) <> '' AND length(content_type) <= 128),
  size_bytes   BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  content      BYTEA NOT NULL,
  actor        TEXT,
  actor_kind   TEXT NOT NULL DEFAULT 'human' CHECK (actor_kind IN ('human', 'agent', 'system')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX task_attachments_task_idx ON task_attachments (task_id, created_at DESC);

-- The bytes are large and are never wanted by a listing; asking for them is an
-- explicit second read. Postgres keeps them out of the main heap either way,
-- but naming the intent here keeps the storage decision beside the table.
ALTER TABLE task_attachments ALTER COLUMN content SET STORAGE EXTERNAL;
