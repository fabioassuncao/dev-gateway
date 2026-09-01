#!/usr/bin/env bash
# `dev-gateway db` and `dev-gateway redis`: ergonomics over `access`.
#
# Two ways in, for two different needs:
#
#   `db open`   opens a bridge so a GUI on the host can connect. It is the
#               generic access bridge, not a second mechanism.
#   `db psql`   runs a client inside the project's own network. Nothing is
#               published, nothing is left behind, and it is what an agent
#               should reach for.

dg_cmd_db() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    status) dg_panel_db_status "$@" ;;
    shell) dg_panel_db_shell "$@" ;;
    dump) dg_panel_db_dump "$@" ;;
    restore) dg_panel_db_restore "$@" ;;
    open)  dg_access_open --service "${DG_DB_SERVICE:-postgres}" "$@" ;;
    close) dg_access_close "$@" ;;
    url)   dg_db_url "$@" ;;
    psql)  dg_client_exec psql "$@" ;;
    mysql) dg_client_exec mysql "$@" ;;
    ''|-h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway db: operate the panel database or reach a project's database

  db status
        Show the panel PostgreSQL state, health, migration and database size.

  db shell
        Open psql for the panel's private PostgreSQL through the toolbox.

  db dump > dev-gateway.dump
        Write a restorable custom-format backup to stdout.

  db restore [--yes] < dev-gateway.dump
  db restore [--yes] dev-gateway.dump
        Restore a panel backup after an explicit confirmation.

  db open  --project <p> [--service postgres] [--port N]
        Open a loopback bridge for a GUI client (TablePlus, DBeaver, DataGrip).

  db psql  --project <p> [--service postgres] [-- <psql args>]
  db mysql --project <p> [--service mysql]    [-- <mysql args>]
        Run a client inside the project's own network. No port is published
        and the container is removed when you exit.

  db url   --project <p> [--service postgres]
        Print a connection string template for an open bridge. Never contains
        a password.

  db close --project <p>
        Close the project's bridges.
DG_HELP
      ;;
    *)
      # `db open <project> <service>` reads naturally, so accept it.
      dg_access_open "$sub" "$@" ;;
  esac
}

DG_PANEL_DB_HOST="db"
DG_PANEL_DB_USER="devgateway"
DG_PANEL_DB_NAME="devgateway"

dg_panel_db_container() {
  dg_gateway_container db
}

# The panel database is intentionally unreachable from the host. Operational
# clients join only its internal network in an ephemeral toolbox container.
# Docker inherits PGPASSWORD from this process, so the secret is absent from
# argv, logs and `ps` output.
dg_panel_db_run() {
  local tty="${1:-}"; shift
  [ -n "${DG_WEB_DB_PASSWORD:-}" ] || {
    err "the panel database credential is not configured"
    hint "dev-gateway web up generates it in .env"
    return 1
  }
  dg_toolbox_ensure || return 1
  export PGPASSWORD="$DG_WEB_DB_PASSWORD"
  if [ "$tty" = "tty" ]; then
    docker run --rm -it --network "$DEV_GATEWAY_DB_NETWORK" -e PGPASSWORD \
      "$DG_TOOLBOX_IMAGE" "$@"
  else
    docker run --rm -i --network "$DEV_GATEWAY_DB_NETWORK" -e PGPASSWORD \
      "$DG_TOOLBOX_IMAGE" "$@"
  fi
}

dg_panel_db_require_running() {
  dg_require_docker || return 1
  local container state
  container=$(dg_panel_db_container)
  [ -n "$container" ] || {
    err "the panel database container is absent"
    hint "dev-gateway web up"
    return 1
  }
  state=$(dg_container_state "$container")
  [ "$state" = "running" ] || {
    err "the panel database is $state"
    hint "dev-gateway web up"
    return 1
  }
  dg_network_exists "$DEV_GATEWAY_DB_NETWORK" || {
    err "the panel data network is absent: $DEV_GATEWAY_DB_NETWORK"
    hint "dev-gateway web up"
    return 1
  }
}

dg_panel_db_status() {
  [ $# -eq 0 ] || { err "unknown flag for 'db status': $1"; return 1; }
  dg_require_docker || return 1

  local container state health details migration size
  container=$(dg_panel_db_container)
  if [ -z "$container" ]; then
    printf 'Panel database: absent\n'
    hint "dev-gateway web up"
    return 1
  fi

  state=$(dg_container_state "$container")
  health=$(dg_container_health "$container")
  printf 'Panel database: %s (%s, health: %s)\n' "${container:0:12}" "$state" "$health"
  printf 'Private network: %s\n' "$DEV_GATEWAY_DB_NETWORK"
  [ "$state" = "running" ] || return 1

  details=$(dg_panel_db_run plain psql \
    -h "$DG_PANEL_DB_HOST" -U "$DG_PANEL_DB_USER" -d "$DG_PANEL_DB_NAME" \
    -v ON_ERROR_STOP=1 -At -F '|' \
    -c "SELECT COALESCE(max(version), 'none'), pg_size_pretty(pg_database_size(current_database())) FROM schema_migrations" \
  ) || {
    warn "PostgreSQL is running, but its schema could not be read"
    return 1
  }
  migration=${details%%|*}
  size=${details#*|}
  printf 'Latest migration: %s\n' "$migration"
  printf 'Database size: %s\n' "$size"
}

dg_panel_db_shell() {
  [ $# -eq 0 ] || { err "unknown flag for 'db shell': $1"; return 1; }
  dg_panel_db_require_running || return 1
  [ -t 0 ] && [ -t 1 ] || {
    err "db shell needs an interactive terminal"
    hint "use 'dev-gateway db dump' for a non-interactive backup"
    return 1
  }
  dg_panel_db_run tty psql \
    -h "$DG_PANEL_DB_HOST" -U "$DG_PANEL_DB_USER" -d "$DG_PANEL_DB_NAME"
}

dg_panel_db_dump() {
  [ $# -eq 0 ] || { err "unknown flag for 'db dump': $1"; return 1; }
  dg_panel_db_require_running || return 1
  # stdout is exclusively the custom-format archive; diagnostics remain on
  # stderr, so ordinary shell redirection produces a valid backup.
  dg_panel_db_run plain pg_dump \
    -h "$DG_PANEL_DB_HOST" -U "$DG_PANEL_DB_USER" -d "$DG_PANEL_DB_NAME" \
    --format=custom --no-owner --no-privileges
}

dg_panel_db_restore() {
  local source=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -y|--yes) DG_ASSUME_YES=true ;;
      -*) err "unknown flag for 'db restore': $1"; return 1 ;;
      *)
        [ -z "$source" ] || { err "db restore accepts at most one backup file"; return 1; }
        source="$1"
        ;;
    esac
    shift
  done
  export DG_ASSUME_YES

  dg_panel_db_require_running || return 1
  if [ -n "$source" ]; then
    [ -f "$source" ] || { err "backup not found: $source"; return 1; }
  elif [ -t 0 ]; then
    err "db restore needs a custom-format backup file or stdin"
    hint "dev-gateway db restore backup.dump"
    return 1
  fi

  dg_confirm "Restore the panel database from backup? Existing persisted panel data may be replaced." \
    || { info "aborted; nothing was changed"; return 1; }

  if [ -n "$source" ]; then
    dg_panel_db_run plain pg_restore \
      -h "$DG_PANEL_DB_HOST" -U "$DG_PANEL_DB_USER" -d "$DG_PANEL_DB_NAME" \
      --clean --if-exists --no-owner --no-privileges --exit-on-error < "$source"
  else
    dg_panel_db_run plain pg_restore \
      -h "$DG_PANEL_DB_HOST" -U "$DG_PANEL_DB_USER" -d "$DG_PANEL_DB_NAME" \
      --clean --if-exists --no-owner --no-privileges --exit-on-error
  fi
  info "panel database restored"
}

dg_cmd_redis() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    open)  dg_access_open --service "${DG_REDIS_SERVICE:-redis}" "$@" ;;
    close) dg_access_close "$@" ;;
    cli)   dg_client_exec redis-cli "$@" ;;
    ''|-h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway redis: reach a project's Redis

  redis open  --project <p> [--service redis]
        Open a loopback bridge for a GUI client.

  redis cli   --project <p> [--service redis] [-- <redis-cli args>]
        Run redis-cli inside the project's own network. Nothing is published.

  redis close --project <p>
DG_HELP
      ;;
    *) dg_access_open "$sub" "$@" ;;
  esac
}

dg_db_url() {
  local project="" service="postgres"
  while [ $# -gt 0 ]; do
    case "$1" in
      --project) shift; project="${1:-}" ;;
      --project=*) project="${1#--project=}" ;;
      --service) shift; service="${1:-}" ;;
      --service=*) service="${1#--service=}" ;;
      *) [ -n "$project" ] && service="$1" || project="$1" ;;
    esac
    shift
  done
  [ -n "$project" ] || { err "--project is required"; return 1; }
  dg_require_docker || return 1

  local c
  c=$(dg_bridge_for "$project" "$service")
  [ -n "$c" ] || {
    err "no bridge is open for $project/$service"
    hint "dev-gateway access open --project $project --service $service"
    return 1
  }
  local port kind
  port=$(dg_bridge_local_port "$c")
  kind=$(dg_access_label "$c" kind)
  case "$kind" in
    postgres) printf 'postgresql://<user>@127.0.0.1:%s/<database>\n' "$port" ;;
    mysql)    printf 'mysql://<user>@127.0.0.1:%s/<database>\n' "$port" ;;
    redis)    printf 'redis://127.0.0.1:%s\n' "$port" ;;
    *)        printf '127.0.0.1:%s\n' "$port" ;;
  esac
  printf '%s\n' "$(dg_dim 'the password belongs to the project and is deliberately not filled in')" >&2
}

# dg_container_env <container> <NAME>: read one environment variable from a
# container's configuration.
#
# Docker's --format is plain Go templates plus a handful of Docker helpers; it
# has no hasPrefix/trimPrefix (those are Traefik's sprig additions) and fails
# with a usage error if you try. Print the list and filter it here instead.
dg_container_env() {
  docker inspect "$1" --format '{{ range .Config.Env }}{{ println . }}{{ end }}' 2>/dev/null \
    | sed -n "s/^$2=//p" | head -1
}

# dg_client_exec <client> [flags] [-- args...]
#
# Runs a one-shot client container on the project's private network. This is
# the path with the smallest blast radius: no published port, no bridge to
# forget about, and nothing to clean up.
dg_client_exec() {
  local client="$1"; shift
  local project="" service="" port="" network="" user="" database=""

  case "$client" in
    psql) service="postgres" ;;
    mysql) service="mysql" ;;
    redis-cli) service="redis" ;;
  esac

  while [ $# -gt 0 ]; do
    case "$1" in
      --) shift; break ;;
      --project) shift; project="${1:-}" ;;
      --project=*) project="${1#--project=}" ;;
      --service) shift; service="${1:-}" ;;
      --service=*) service="${1#--service=}" ;;
      --port) shift; port="${1:-}" ;;
      --port=*) port="${1#--port=}" ;;
      --user) shift; user="${1:-}" ;;
      --user=*) user="${1#--user=}" ;;
      --database|--db) shift; database="${1:-}" ;;
      --database=*) database="${1#--database=}" ;;
      -*) die "unknown flag: $1" ;;
      *) [ -n "$project" ] || project="$1" ;;
    esac
    shift
  done

  [ -n "$project" ] || { err "--project is required"; hint "dev-gateway services"; return 1; }
  dg_require_docker || return 1

  local target
  target=$(dg_find_container "$project" "$service")
  [ -n "$target" ] || {
    err "no running container for $project/$service"
    hint "dev-gateway services --project $project"
    return 1
  }

  local image
  image=$(docker inspect "$target" --format '{{ .Config.Image }}' 2>/dev/null)
  [ -n "$port" ] || port=$(dg_default_port_for_image "$image")
  [ -n "$port" ] || { err "cannot tell which port $service listens on"; hint "--port <port>"; return 1; }

  network=$(dg_container_private_networks "$target" | head -1)
  [ -n "$network" ] || { err "$project/$service is not on a private network"; return 1; }

  dg_toolbox_ensure || return 1

  # Credentials are read from the target container's own environment, in the
  # target container. They are passed straight to the client and never printed.
  local envs=""
  case "$client" in
    psql)
      [ -n "$user" ] || user=$(dg_container_env "$target" POSTGRES_USER)
      [ -n "$database" ] || database=$(dg_container_env "$target" POSTGRES_DB)
      # `-e NAME` with no value tells Docker to take it from this process's
      # environment, so the password never appears in the command line and
      # therefore never in `ps` output.
      local pass
      pass=$(dg_container_env "$target" POSTGRES_PASSWORD)
      if [ -n "$pass" ]; then export PGPASSWORD="$pass"; envs="-e PGPASSWORD"; fi
      set -- -h "$service" -p "$port" ${user:+-U "$user"} ${database:+-d "$database"} "$@"
      ;;
    mysql)
      [ -n "$user" ] || user=$(dg_container_env "$target" MYSQL_USER)
      [ -n "$database" ] || database=$(dg_container_env "$target" MYSQL_DATABASE)
      local mpass
      mpass=$(dg_container_env "$target" MYSQL_PASSWORD)
      if [ -n "$mpass" ]; then export MYSQL_PWD="$mpass"; envs="-e MYSQL_PWD"; fi
      set -- -h "$service" -P "$port" ${user:+-u "$user"} ${database:+"$database"} "$@"
      ;;
    redis-cli)
      set -- -h "$service" -p "$port" "$@"
      ;;
  esac

  local tty=""
  [ -t 0 ] && [ -t 1 ] && tty="-t"

  info "running $client inside $network; no port is published"
  # shellcheck disable=SC2086  # envs is a deliberately split flag list
  docker run --rm -i $tty --network "$network" $envs "$DG_TOOLBOX_IMAGE" "$client" "$@"
}
