-- Projects Home location of a Project. The table is still named `workspaces`
-- (ADR 0031: persistence may lag the domain). Types and APIs say Project.
--
-- `relative_path` is the first-level directory under Projects Home
-- (`brasil-data-hub`), never an absolute path and never the identity.
-- Changing PORTTA_PROJECTS_HOME must not invent new Projects.

ALTER TABLE workspaces
  ADD COLUMN relative_path TEXT
    CHECK (relative_path IS NULL OR (
      btrim(relative_path) <> ''
      AND relative_path NOT LIKE '/%'
      AND relative_path NOT LIKE '%..%'
      AND relative_path NOT LIKE '%/%'
    ));

CREATE UNIQUE INDEX workspaces_relative_path_unique
  ON workspaces (relative_path)
  WHERE relative_path IS NOT NULL;
