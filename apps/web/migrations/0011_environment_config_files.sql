-- Where an Environment's Compose files were when it was last seen.
--
-- `working_dir` says where Compose ran; `config_files` says which files it
-- read, as the daemon recorded them in `com.docker.compose.project.config_files`.
-- With both, an Environment whose containers are gone can be started again
-- through the runner without a container to read labels from (ADR 0030).
-- Empty means "never observed": the runner then looks for compose.yaml in
-- the working directory, as it always did.

ALTER TABLE environments
  ADD COLUMN config_files TEXT[] NOT NULL DEFAULT '{}';
