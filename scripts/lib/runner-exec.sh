#!/usr/bin/env bash
# The command the project runner container is created with. Fixed at creation;
# the panel supplies no argument. The request is { verb, project } in
# state/runner/request.json. See docs/adr/0030-the-panel-and-a-project-lifecycle.md.
set -euo pipefail

PORTTA_ROOT="${PORTTA_ROOT:?PORTTA_ROOT is required}"
REQUEST="$PORTTA_ROOT/state/runner/request.json"
HOST_ROOT=/host

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

[ -f "$REQUEST" ] || die "no runner request at $REQUEST"

# Two fields, closed values. A full JSON parser is not needed and would be a
# dependency this image does not have.
verb=$(sed -n 's/.*"verb"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REQUEST" | head -n1)
project=$(sed -n 's/.*"project"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REQUEST" | head -n1)
nocache=$(grep -q '"no-cache"' "$REQUEST" && printf '1' || printf '0')
directory=$(grep -q '"directory"' "$REQUEST" && printf '1' || printf '0')

case "$verb" in
  up|stop|restart|build|down|down-volumes) ;;
  *) die "unknown runner verb '$verb'" ;;
esac

[[ "$project" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "refusing project name '$project'"

id=$(docker ps -aq --filter "label=com.docker.compose.project=${project}" | head -n1)
[ -n "$id" ] || die "no container on this host belongs to project '$project'"

managed=$(docker inspect "$id" --format '{{ index .Config.Labels "portta.managed" }}' 2>/dev/null || true)
[ "$managed" != "true" ] || die "refusing to operate Portta's own project"

working_dir=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')
config_files=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}')

[ -n "$working_dir" ] || die "project '$project' has no Compose working directory label"
[ -d "${HOST_ROOT}${working_dir}" ] || die "working directory ${working_dir} does not exist on this host"

# Compose files as the daemon recorded them. Read through /host; pass the host
# path to --project-directory so bind mounts resolve on the host.
files=()
if [ -n "$config_files" ]; then
  IFS=',' read -r -a listed <<< "$config_files"
  for file in "${listed[@]}"; do
    file="${file#"${file%%[![:space:]]*}"}"
    file="${file%"${file##*[![:space:]]}"}"
    [ -n "$file" ] || continue
    [ -f "${HOST_ROOT}${file}" ] || die "compose file ${file} is not readable"
    files+=(-f "${HOST_ROOT}${file}")
  done
fi
if [ ${#files[@]} -eq 0 ]; then
  for name in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    if [ -f "${HOST_ROOT}${working_dir}/${name}" ]; then
      files+=(-f "${HOST_ROOT}${working_dir}/${name}")
      break
    fi
  done
fi
[ ${#files[@]} -gt 0 ] || die "no compose file in ${working_dir}"

compose() {
  docker compose --project-name "$project" --project-directory "$working_dir" "${files[@]}" "$@"
}

# The working directory is Docker's label. Removal is the same bound as
# packages/core/src/paths.ts: absolute, no walk-up, not `/`, not a top-level
# directory. `realpath` is the last check so a symlink cannot leave /host.
remove_working_dir() {
  local dir="$1"
  [[ "$dir" == /* ]] || die "working directory is not absolute"
  [[ "$dir" != *..* ]] || die "refusing working directory that walks up"
  [[ "$dir" != "/" ]] || die "refusing to remove /"
  case "${dir#/}" in
    */*) ;;
    *) die "refusing to remove a top-level directory" ;;
  esac
  local target="${HOST_ROOT}${dir}"
  [ -d "$target" ] || die "working directory ${dir} does not exist on this host"
  local real
  real=$(realpath "$target")
  case "$real" in
    /host/*) ;;
    *) die "resolved path is outside /host" ;;
  esac
  [ "$real" != "/host" ] && [ "$real" != "/" ] || die "refusing to remove the host root"
  rm -rf -- "$real"
}

case "$verb" in
  up) compose up -d --remove-orphans ;;
  stop) compose stop ;;
  restart) compose stop && compose up -d --remove-orphans ;;
  build)
    if [ "$nocache" = "1" ]; then
      compose build --no-cache
    else
      compose build
    fi
    compose up -d --remove-orphans
    ;;
  down) compose down ;;
  down-volumes)
    compose down --volumes
    if [ "$directory" = "1" ]; then
      remove_working_dir "$working_dir"
    fi
    ;;
esac
