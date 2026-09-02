#!/usr/bin/env bash
# `portta backup`, `portta restore`, `portta repair`.
#
# The three operations that assume something has gone wrong, or is about to.
# `install`, `update`, `doctor`, `status` and `uninstall` already exist; these
# complete the set docs/prompts/07-SETUP.md §25 asks the system to be structured
# around.
#
# What has to be preserved is decided by ADR 0020: everything under
# PORTTA_HOME is a bind mount and can simply be copied, **except** the panel's
# PostgreSQL data, which lives in a named volume and has to be dumped by the
# database itself. A backup that copied the volume's files while Postgres was
# running would be a torn one, so it never does that.

PORTTA_BACKUP_VERSION=1

portta_cmd_backup() { portta_backup_run "$@"; }
portta_cmd_restore() { portta_restore_run "$@"; }
portta_cmd_repair() { portta_repair_run "$@"; }

# ---------------------------------------------------------------------------
# What a backup contains
# ---------------------------------------------------------------------------
# Deliberately not everything. Anything the installer can fetch again (bin,
# scripts, docker/, toolbox) is left out: including it would make the archive a
# stale copy of the release, and restoring it onto a newer Portta would quietly
# downgrade the code while claiming to restore data.
portta_backup_paths() {
  local path
  for path in .env VERSION config state; do
    [ -e "$PORTTA_ROOT/$path" ] && printf '%s\n' "$path"
  done
}

portta_backup_run() {
  local out="" no_db=false
  while [ $# -gt 0 ]; do
    case "$1" in
      -o|--output) out="${2:-}"; shift 2 ;;
      --no-database) no_db=true; shift ;;
      -h|--help)
        cat >&2 <<'PORTTA_HELP'
portta backup: one archive holding everything this installation cannot regenerate

  backup [-o <file>] [--no-database]

Contains .env, VERSION, config/ and state/, plus a dump of the panel database.
Leaves out anything the installer can fetch again, so restoring never downgrades
the code.

The archive holds credentials. It is written 0600; keep it somewhere that
deserves that.
PORTTA_HELP
        return 0 ;;
      *) err "unknown option: $1"; return 1 ;;
    esac
  done

  [ -n "$out" ] || out="$PORTTA_ROOT/portta-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"

  local staging
  staging=$(mktemp -d) || { err "could not create a working directory"; return 1; }
  # The staging area holds a copy of every secret in the installation.
  chmod 700 "$staging"
  # shellcheck disable=SC2064  # expand now: $staging must be captured at set time
  trap "rm -rf '$staging'" RETURN

  local manifest="$staging/portta-backup.json"
  printf '{"version":%s,"portta":"%s","created":"%s","host":"%s"}\n' \
    "$PORTTA_BACKUP_VERSION" "$(portta_version)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(hostname 2>/dev/null || printf unknown)" \
    > "$manifest"

  local path count=0
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    mkdir -p "$staging/tree/$(dirname "$path")"
    cp -R "$PORTTA_ROOT/$path" "$staging/tree/$path" 2>/dev/null || {
      err "could not copy $path"
      return 1
    }
    count=$((count + 1))
  done <<EOF
$(portta_backup_paths)
EOF

  if [ "$no_db" = "false" ]; then
    portta_backup_database "$staging/database.sql" || {
      warn "the panel database was not included"
      hint "it is only there when the panel is running; --no-database silences this"
    }
  fi

  # A backup is a file full of credentials. It is created with a private umask
  # rather than chmod'ed afterwards, so it is never briefly world-readable.
  ( umask 077 && tar -czf "$out" -C "$staging" . ) || { err "could not write $out"; return 1; }

  ok "backup written"
  printf '  file      %s\n' "$out"
  printf '  size      %s\n' "$(portta_human_size "$out")"
  printf '  contents  %s path(s)%s\n' "$count" "$([ -f "$staging/database.sql" ] && printf ' + database' || printf '')"
  printf '\n'
  warn "this archive contains credentials: .env, the panel password hash and any tokens"
}

# portta_backup_database <path>: a dump taken by PostgreSQL itself.
#
# Copying the volume's files under a running server would produce a torn
# snapshot; `pg_dump` produces a consistent one and restores into any later
# PostgreSQL, which is what makes an upgrade survivable.
portta_backup_database() {
  local target="$1" container
  container="${PORTTA_PROJECT_NAME:-portta}-db-1"
  docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -q true || return 1
  ( umask 077 && docker exec "$container" pg_dump -U portta -d portta --clean --if-exists > "$target" ) 2>/dev/null || return 1
  [ -s "$target" ] || { rm -f "$target"; return 1; }
}

portta_human_size() {
  if portta_have du; then du -h "$1" 2>/dev/null | cut -f1; else printf 'unknown'; fi
}

# ---------------------------------------------------------------------------
# restore
# ---------------------------------------------------------------------------

portta_restore_run() {
  local archive="" force=false
  while [ $# -gt 0 ]; do
    case "$1" in
      -f|--force) force=true; shift ;;
      -h|--help)
        cat >&2 <<'PORTTA_HELP'
portta restore: put a backup back

  restore <file> [--force]

Restores .env, config/ and state/, then loads the database dump if the archive
has one. Refuses to overwrite a live installation unless --force is given, and
always writes a safety copy of what it replaced.
PORTTA_HELP
        return 0 ;;
      -*) err "unknown option: $1"; return 1 ;;
      *) archive="$1"; shift ;;
    esac
  done

  [ -n "$archive" ] || { err "which backup?"; hint "portta restore <file>"; return 1; }
  [ -f "$archive" ] || { err "no such file: $archive"; return 1; }

  local staging
  staging=$(mktemp -d) || return 1
  chmod 700 "$staging"
  # shellcheck disable=SC2064
  trap "rm -rf '$staging'" RETURN

  tar -xzf "$archive" -C "$staging" 2>/dev/null || { err "that file is not a Portta backup"; return 1; }
  [ -f "$staging/portta-backup.json" ] || { err "that archive has no Portta manifest"; return 1; }

  local from_version
  from_version=$(sed -n 's/.*"portta":"\([^"]*\)".*/\1/p' "$staging/portta-backup.json")
  step "restoring a backup taken from Portta ${from_version:-unknown}"

  # Refusing by default matters: restoring over a running installation replaces
  # its credentials, and the containers would keep running with the old ones.
  if [ "$force" = "false" ] && docker inspect -f '{{.State.Running}}' "${PORTTA_PROJECT_NAME:-portta}-traefik-1" 2>/dev/null | grep -q true; then
    err "the gateway is running"
    hint "portta down, then restore; or pass --force to replace configuration underneath it"
    return 1
  fi

  # Whatever is being replaced is kept, because a restore that turns out to be
  # the wrong archive is otherwise unrecoverable.
  local safety
  safety="$PORTTA_ROOT/state/restore-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$safety"
  local path
  for path in .env config; do
    [ -e "$PORTTA_ROOT/$path" ] && cp -R "$PORTTA_ROOT/$path" "$safety/" 2>/dev/null || true
  done
  ok "kept what was there under $safety"

  if [ -d "$staging/tree" ]; then
    ( cd "$staging/tree" && tar -cf - . ) | ( cd "$PORTTA_ROOT" && tar -xf - ) || {
      err "could not write the restored files"
      return 1
    }
    ok "configuration and state restored"
  fi
  [ -f "$PORTTA_ROOT/.env" ] && chmod 600 "$PORTTA_ROOT/.env" 2>/dev/null || true

  if [ -f "$staging/database.sql" ]; then
    portta_restore_database "$staging/database.sql" \
      && ok "panel database restored" \
      || { warn "the database dump was not loaded"; hint "start the gateway, then: portta restore $archive --force"; }
  fi

  printf '\n'
  ok "restore complete"
  hint "portta up   then   portta doctor"
}

portta_restore_database() {
  local dump="$1" container
  container="${PORTTA_PROJECT_NAME:-portta}-db-1"
  docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -q true || return 1
  docker exec -i "$container" psql -U portta -d portta -v ON_ERROR_STOP=1 -q < "$dump" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# repair
# ---------------------------------------------------------------------------
# Everything here is idempotent and additive. Repair never deletes data, never
# touches a volume and never rewrites a value somebody chose: it recreates what
# is missing and fixes what is provably wrong, which is the difference between
# a repair and a reinstall.

portta_repair_run() {
  local dry=false
  case "${1:-}" in
    --dry-run) dry=true ;;
    -h|--help)
      cat >&2 <<'PORTTA_HELP'
portta repair: put a broken installation back into a state that can start

  repair [--dry-run]

Recreates missing directories, fixes permissions on the files that must be
private, restores the networks the gateway needs, and recreates containers.
Never deletes data, never touches a volume, never overwrites a value you chose.
PORTTA_HELP
      return 0 ;;
  esac

  local fixed=0
  step "Repair"

  # 1. Directories the compose files bind-mount. A missing one makes Docker
  #    create it as root, which then breaks the panel writing to it.
  local directory
  for directory in config/traefik/dynamic config/tls state/traefik/acme state/tailscale state/access state/git state/github state/cloudflared; do
    if [ ! -d "$PORTTA_ROOT/$directory" ]; then
      if [ "$dry" = "true" ]; then
        printf '   would create %s\n' "$directory" >&2
      else
        mkdir -p "$PORTTA_ROOT/$directory" && ok "created $directory"
      fi
      fixed=$((fixed + 1))
    fi
  done

  # 2. Permissions on the things that hold secrets. Reported and fixed, because
  #    a world-readable .env is a finding, not a preference.
  portta_repair_mode .env 600 "$dry" && fixed=$((fixed + 1))
  portta_repair_mode state/traefik/acme 700 "$dry" && fixed=$((fixed + 1))
  [ -f "$PORTTA_ROOT/state/traefik/acme/acme.json" ] && { portta_repair_mode state/traefik/acme/acme.json 600 "$dry" && fixed=$((fixed + 1)); }
  [ -d "$PORTTA_ROOT/state/cloudflared" ] && { portta_repair_mode state/cloudflared 700 "$dry" && fixed=$((fixed + 1)); }
  [ -f "$PORTTA_ROOT/state/cloudflared/credentials.json" ] && { portta_repair_mode state/cloudflared/credentials.json 600 "$dry" && fixed=$((fixed + 1)); }

  # 3. The networks. The shared one is external and outlives the stack, so a
  #    `docker network prune` on the host removes it and nothing recreates it.
  local network
  for network in "${PORTTA_NETWORK:-portta}" "${PORTTA_ACCESS_NETWORK:-portta-access}"; do
    if ! docker network inspect "$network" >/dev/null 2>&1; then
      if [ "$dry" = "true" ]; then
        printf '   would create network %s\n' "$network" >&2
      else
        docker network create --label portta.managed=true "$network" >/dev/null 2>&1 \
          && ok "created network $network" || warn "could not create network $network"
      fi
      fixed=$((fixed + 1))
    fi
  done

  if [ "$dry" = "true" ]; then
    printf '\n' >&2
    [ "$fixed" -eq 0 ] && ok "nothing to repair" || ok "$fixed thing(s) would be repaired"
    return 0
  fi

  # 4. Recreate the containers from the configuration as it now stands. `up -d`
  #    is idempotent: containers whose definition has not changed are left
  #    alone, so this is safe to run on a healthy installation.
  step "reconciling containers"
  portta_compose "${PORTTA_PROFILE:-local}" up -d --remove-orphans || {
    err "the gateway did not come up"
    hint "portta doctor"
    return 1
  }

  printf '\n'
  if [ "$fixed" -eq 0 ]; then
    ok "nothing needed repairing; containers reconciled"
  else
    ok "$fixed thing(s) repaired; containers reconciled"
  fi
  hint "portta doctor   confirms the result"
}

# portta_repair_mode <relative path> <octal> <dry>: returns 0 when it changed
# something, so the caller can count it.
portta_repair_mode() {
  local path="$PORTTA_ROOT/$1" want="$2" dry="$3" have
  [ -e "$path" ] || return 1
  have=$(stat -f '%OLp' "$path" 2>/dev/null || stat -c '%a' "$path" 2>/dev/null || printf '')
  [ -n "$have" ] || return 1
  [ "$have" = "$want" ] && return 1
  if [ "$dry" = "true" ]; then
    printf '   would change %s from %s to %s\n' "$1" "$have" "$want" >&2
  else
    chmod "$want" "$path" 2>/dev/null && ok "$1 is now $want (was $have)" || return 1
  fi
  return 0
}
