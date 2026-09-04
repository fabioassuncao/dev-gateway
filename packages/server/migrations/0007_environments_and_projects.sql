-- The words match the responsibilities (ADR 0031, closed here).
--
-- `projects` held what this host was *running*: one Compose project, observed
-- from Docker. That is an Environment. `workspaces` held what the operator
-- *decided*: a product, its repositories, the environments it adopted. That is
-- the Project. Types, routes and the CLI already said so; the persistence
-- layer lagged. This migration renames, and drops what nothing ever wrote.
--
-- Order matters: `projects` has to become `environments` before `workspaces`
-- can become `projects`. RENAME keeps constraint, index and sequence names, so
-- each one is renamed explicitly; otherwise the next migration that creates a
-- `projects_pkey` collides with the old one.

-- Environments (was `projects`) ---------------------------------------------

ALTER TABLE projects RENAME TO environments;
ALTER SEQUENCE projects_id_seq RENAME TO environments_id_seq;
ALTER TABLE environments RENAME CONSTRAINT projects_pkey TO environments_pkey;
ALTER TABLE environments RENAME CONSTRAINT projects_compose_project_key TO environments_compose_project_key;
ALTER TABLE environments RENAME CONSTRAINT projects_compose_project_check TO environments_compose_project_check;
ALTER INDEX projects_last_seen_idx RENAME TO environments_last_seen_idx;
ALTER INDEX projects_repo_coordinate_idx RENAME TO environments_repo_coordinate_idx;

-- Never written by any route: an environment's name is its Compose project,
-- and its display name and archived flag live in environment_settings.
ALTER TABLE environments DROP COLUMN slug;
ALTER TABLE environments DROP COLUMN display_name;
ALTER TABLE environments DROP COLUMN archived;

ALTER TABLE project_settings RENAME TO environment_settings;
ALTER TABLE environment_settings RENAME COLUMN project_id TO environment_id;
ALTER TABLE environment_settings RENAME CONSTRAINT project_settings_pkey TO environment_settings_pkey;
ALTER TABLE environment_settings RENAME CONSTRAINT project_settings_project_id_fkey TO environment_settings_environment_id_fkey;
ALTER TABLE environment_settings RENAME CONSTRAINT project_settings_key_check TO environment_settings_key_check;

ALTER TABLE service_settings RENAME COLUMN project_id TO environment_id;
ALTER TABLE service_settings RENAME CONSTRAINT service_settings_project_id_fkey TO service_settings_environment_id_fkey;

-- Created in 0001, never read or written since.
DROP TABLE integrations;

-- Projects (was `workspaces`) -----------------------------------------------

ALTER TABLE workspaces RENAME TO projects;
ALTER SEQUENCE workspaces_id_seq RENAME TO projects_id_seq;
ALTER TABLE projects RENAME CONSTRAINT workspaces_pkey TO projects_pkey;
ALTER TABLE projects RENAME CONSTRAINT workspaces_slug_key TO projects_slug_key;
ALTER TABLE projects RENAME CONSTRAINT workspaces_slug_check TO projects_slug_check;
ALTER TABLE projects RENAME CONSTRAINT workspaces_name_check TO projects_name_check;
ALTER TABLE projects RENAME CONSTRAINT workspaces_relative_path_check TO projects_relative_path_check;
ALTER INDEX workspaces_relative_path_unique RENAME TO projects_relative_path_unique;

ALTER TABLE workspace_repositories RENAME TO project_repositories;
ALTER TABLE project_repositories RENAME COLUMN workspace_id TO project_id;
ALTER TABLE project_repositories RENAME CONSTRAINT workspace_repositories_pkey TO project_repositories_pkey;
ALTER TABLE project_repositories RENAME CONSTRAINT workspace_repositories_workspace_id_fkey TO project_repositories_project_id_fkey;
ALTER TABLE project_repositories RENAME CONSTRAINT workspace_repositories_repository_id_fkey TO project_repositories_repository_id_fkey;

-- Both columns change name, and one of them takes the other's old name, so
-- the environment side goes through a temporary name.
ALTER TABLE workspace_environments RENAME TO project_environments;
ALTER TABLE project_environments RENAME COLUMN project_id TO environment_id_tmp;
ALTER TABLE project_environments RENAME COLUMN workspace_id TO project_id;
ALTER TABLE project_environments RENAME COLUMN environment_id_tmp TO environment_id;
ALTER TABLE project_environments RENAME CONSTRAINT workspace_environments_pkey TO project_environments_pkey;
ALTER TABLE project_environments RENAME CONSTRAINT workspace_environments_workspace_id_fkey TO project_environments_project_id_fkey;
ALTER TABLE project_environments RENAME CONSTRAINT workspace_environments_project_id_fkey TO project_environments_environment_id_fkey;
ALTER INDEX workspace_environments_one_workspace_per_env RENAME TO project_environments_one_project_per_env;
ALTER TABLE project_environments DROP CONSTRAINT workspace_environments_source_check;
ALTER TABLE project_environments ADD CONSTRAINT project_environments_source_check
  CHECK (source IN ('manual', 'label', 'repo-match', 'path'));

-- The issue ↔ environment link keeps its table name until tasks arrive; only
-- the column that pointed at the old `projects` follows the rename.
ALTER TABLE issue_environments RENAME COLUMN project_id TO environment_id;
ALTER TABLE issue_environments RENAME CONSTRAINT issue_environments_project_id_fkey TO issue_environments_environment_id_fkey;
ALTER INDEX issue_environments_one_issue_per_env RENAME TO issue_environments_one_issue_per_environment;
