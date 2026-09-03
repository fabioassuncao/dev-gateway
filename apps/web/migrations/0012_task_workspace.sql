-- Task workspace: due date, import key, kick-create drafts, editable notes.
--
-- Existing rows stay as they are. `draft` defaults to false so every task
-- already on a board remains visible. `source_key` is how example (and later
-- portable) imports reconcile without embedding database ids.

ALTER TABLE tasks
  ADD COLUMN due_at TIMESTAMPTZ,
  ADD COLUMN source_key TEXT,
  ADD COLUMN draft BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX tasks_source_key_present
  ON tasks (project_id, source_key)
  WHERE source_key IS NOT NULL;

CREATE INDEX tasks_draft_reuse
  ON tasks (project_id, created_by, parent_id)
  WHERE draft;

ALTER TABLE task_notes
  ADD COLUMN updated_at TIMESTAMPTZ,
  ADD COLUMN source_key TEXT;

CREATE UNIQUE INDEX task_notes_source_key_present
  ON task_notes (task_id, source_key)
  WHERE source_key IS NOT NULL;
