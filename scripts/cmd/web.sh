#!/usr/bin/env bash
# `dev-gateway web`: the administration panel.
#
# The panel is a development convenience, not part of the data path: the
# gateway routes traffic perfectly well without it. It is opt-in, published on
# loopback, and it runs in containers so the host never needs Node installed.

DG_WEB_SERVICES="web web-socket-proxy"
DG_WEB_DEV_SERVICES="web web-ui web-socket-proxy"

dg_cmd_web() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    up|start) dg_web_up "$@" ;;
    down|stop) dg_web_down "$@" ;;
    restart) dg_web_restart "$@" ;;
    status) dg_web_status "$@" ;;
    open) dg_web_open "$@" ;;
    logs) dg_web_logs "$@" ;;
    build) dg_web_build "$@" ;;
    dev) dg_web_dev "$@" ;;
    disable) dg_web_disable "$@" ;;
    auth) dg_web_auth "$@" ;;
    -h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway web: the administration panel

  web up [--expose local|vpn] [--port N] [--read-only|--writable]
                         Enable and start the panel
  web down               Stop it. The gateway itself keeps running
  web disable            Stop it and take it out of `dev-gateway up`
  web restart            Restart the panel containers
  web status             Where it is listening, and whether it is healthy
  web open               Print (and open) the panel URL
  web logs [service]     Follow the panel logs
  web build              Build the panel image
  web dev                Run it with hot reloading, Vite in front of the API
  web auth [set|clear|apply]
                         The credential Traefik asks for once the panel is routed

The panel binds 127.0.0.1 by default and is never routed through the public
entrypoints. `--expose vpn` adds a Traefik router so it is reachable from the
tailnet, requires a credential, and is refused on the remote-public profile.

See docs/web-ui.md.
DG_HELP
      ;;
    *) err "unknown web subcommand: $sub"; hint "dev-gateway web --help"; return 1 ;;
  esac
}

# The panel bind-mounts four host paths; Docker would silently create
# directories in place of the two files if they were missing.
dg_web_prepare_mounts() {
  [ -f "$DG_ROOT/.env" ] || {
    info "creating .env (the panel edits it from Settings)"
    : > "$DG_ROOT/.env"
    chmod 600 "$DG_ROOT/.env"
  }
  [ -f "$DG_ROOT/VERSION" ] || printf '0.0.0\n' > "$DG_ROOT/VERSION"
  # Read-only in the container, and empty until `dev-gateway git scan` runs.
  mkdir -p "$DG_STATE_DIR/git"
  chmod 700 "$DG_STATE_DIR/git" 2>/dev/null || true
  mkdir -p "$(dg_web_dynamic_dir)"
}

dg_web_prepare_database_secret() {
  [ -n "${DG_WEB_DB_PASSWORD:-}" ] && return 0
  dg_env_set DG_WEB_DB_PASSWORD "$(dg_random_hex 32)"
  info "generated the panel database credential in .env"
}

# The panel opens TCP bridges through the Docker API, which cannot pull an
# image. Doing it here, on the host, keeps that failure out of the browser.
dg_web_prepare_bridge_image() {
  docker image inspect "$DG_BRIDGE_IMAGE" >/dev/null 2>&1 && return 0
  info "pulling $DG_BRIDGE_IMAGE so the panel can open TCP bridges"
  docker pull "$DG_BRIDGE_IMAGE" >/dev/null 2>&1 \
    || warn "could not pull $DG_BRIDGE_IMAGE; 'Open local access' will ask you to pull it"
}

# Leaving development mode drops the Vite container from the Compose config, so
# it would be left behind as an orphan. Removing it here is safe: it is a
# gateway-owned container, and the check is made rather than assumed.
dg_web_drop_hmr() {
  local id
  id=$(dg_gateway_container web-ui)
  [ -n "$id" ] || return 0
  dg_container_is_managed "$id" || return 0
  info "removing the development UI container"
  docker rm -f "$id" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# The panel's own front door
# ---------------------------------------------------------------------------
# Traefik holds the credential, not the panel: no session, no cookie, no login
# form, and no route handler that a bug could let past. The middleware lives in
# one generated file, which both this command and the panel itself render, byte
# for byte. See docs/adr/0012-panel-authentication-is-traefiks.md.

DG_WEB_AUTH_FILE="dev-gateway-panel.yaml"
DG_WEB_AUTH_MIDDLEWARE="dev-gateway-web-auth"

dg_web_dynamic_dir() { printf '%s' "$DG_ROOT/config/traefik/dynamic"; }
dg_web_auth_path() { printf '%s/%s' "$(dg_web_dynamic_dir)" "$DG_WEB_AUTH_FILE"; }

dg_web_auth_configured() {
  [ "${DEV_GATEWAY_WEB_AUTH:-none}" = "basic" ] \
    && [ -n "${DEV_GATEWAY_WEB_AUTH_USER:-}" ] \
    && [ -n "${DEV_GATEWAY_WEB_AUTH_HASH:-}" ]
}

# dg_web_auth_password: 20 characters over 32 symbols, so about 100 bits.
# No 0, 1, I or O: this gets read aloud and typed by hand.
#
# The bounded `head` comes first on purpose. Reading /dev/urandom into `tr` and
# closing the pipe from the far end kills `tr` with SIGPIPE, and under
# `set -o pipefail` the whole command then exits 141 having printed nothing.
# A finite input means every stage reaches EOF and exits cleanly.
dg_web_auth_password() {
  LC_ALL=C head -c 4096 /dev/urandom \
    | LC_ALL=C tr -dc '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' \
    | cut -c1-20 \
    | sed -e 's/\(.....\)/\1-/g' -e 's/-$//'
}

# dg_web_auth_hash: apr1, from stdin. Never as an argument: `ps` shows those to
# every user on the host.
dg_web_auth_hash() {
  if dg_have openssl; then
    openssl passwd -apr1 -stdin
  else
    dg_toolbox_stdin openssl passwd -apr1 -stdin
  fi
}

# dg_web_auth_render: write exactly what web/src/server/core/dynamic.ts writes.
# tests/unit/web.test.sh compares the two, so a drift fails the build rather
# than leaving the panel and the CLI disagreeing about its own front door.
dg_web_auth_render() {
  local file tmp dir
  dir=$(dg_web_dynamic_dir)
  file=$(dg_web_auth_path)
  mkdir -p "$dir" || { err "could not create $dir"; return 1; }
  tmp="$file.dg-tmp.$$"

  {
    cat <<'DG_HEADER'
# ============================================================================
# Generated by the Dev Gateway panel. Edits are overwritten.
# ============================================================================
# The panel writes this file and one other in this directory, and nothing
# else here. See docs/adr/0011-panel-reads-traefik-writes-one-file.md.
# ============================================================================

DG_HEADER
    if dg_web_auth_configured; then
      cat <<'DG_BODY'
# BasicAuth in front of the panel's own router. There is no session, no
# cookie and no login form: the request either reaches the container or it
# does not. See docs/adr/0012-panel-authentication-is-traefiks.md.
http:
  middlewares:
DG_BODY
      printf '    %s:\n' "$DG_WEB_AUTH_MIDDLEWARE"
      printf '      basicAuth:\n'
      printf '        users:\n'
      printf '          - "%s:%s"\n' "$DEV_GATEWAY_WEB_AUTH_USER" "$DEV_GATEWAY_WEB_AUTH_HASH"
      printf '        realm: "Dev Gateway"\n'
      printf '        removeHeader: true\n'
    else
      # Comments and no `http` key at all. `http: {}` is not an empty
      # configuration to Traefik, it is an invalid one, and ONE invalid file
      # aborts the whole directory: every other generated router stops being
      # served with it. Found by running it, not by reading the docs.
      cat <<'DG_BODY'
# DEV_GATEWAY_WEB_AUTH is not `basic`, so the panel declares no middleware.
# A router that references one will be rejected by Traefik, which is the
# correct direction to fail.
DG_BODY
    fi
  } > "$tmp" || { rm -f "$tmp"; err "could not write $file"; return 1; }

  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

dg_cmd_web_auth_help() {
  cat >&2 <<'DG_HELP'
dev-gateway web auth: the credential Traefik asks for once the panel is routed

  web auth               Show whether the panel is protected, and as whom
  web auth set [--user <name>] [--password-stdin]
                         Generate a credential (or read one from stdin), store
                         its hash, and render the middleware
  web auth clear         Remove it. Refused while the panel is routed
  web auth apply         Re-render the middleware file from .env

The password is shown exactly once and only its hash is stored, in .env and in
config/traefik/dynamic/dev-gateway-panel.yaml. Nothing here ever puts it on a
command line, where `ps` would show it to every user on the host.

Loopback needs none of this: a password in front of 127.0.0.1 protects nothing.
See docs/adr/0012-panel-authentication-is-traefiks.md.
DG_HELP
}

dg_web_auth() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    status) dg_web_auth_status "$@" ;;
    set) dg_web_auth_set "$@" ;;
    clear|remove) dg_web_auth_clear "$@" ;;
    apply|render) dg_web_auth_apply "$@" ;;
    -h|--help|help) dg_cmd_web_auth_help ;;
    *) err "unknown web auth subcommand: $sub"; hint "dev-gateway web auth --help"; return 1 ;;
  esac
}

dg_web_auth_status() {
  printf '%s\n' "$(dg_bold 'Panel authentication')"
  printf '  %-16s %s\n' "expose" "${DEV_GATEWAY_WEB_EXPOSE:-local}"
  printf '  %-16s %s\n' "mode" "${DEV_GATEWAY_WEB_AUTH:-none}"
  printf '  %-16s %s\n' "user" "${DEV_GATEWAY_WEB_AUTH_USER:-<unset>}"
  printf '  %-16s %s\n' "hash" "$([ -n "${DEV_GATEWAY_WEB_AUTH_HASH:-}" ] && printf '<set>' || printf '<unset>')"
  printf '  %-16s %s\n' "middleware" "$([ -f "$(dg_web_auth_path)" ] && printf '%s' "$(dg_web_auth_path)" || printf '<not rendered>')"

  if [ "${DEV_GATEWAY_WEB_EXPOSE:-local}" = "local" ]; then
    hint "the panel is on loopback, where a credential adds nothing"
  elif dg_web_auth_configured; then
    ok "the panel is routed and Traefik asks for a password"
  else
    err "the panel is routed with nothing in front of it"
    hint "dev-gateway web auth set"
  fi
}

dg_web_auth_set() {
  local user="" from_stdin=0 password="" hash=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --user) shift; user="${1:-}" ;;
      --user=*) user="${1#--user=}" ;;
      --password-stdin) from_stdin=1 ;;
      -*) die "unknown flag for 'web auth set': $1" ;;
      *) die "unexpected argument: $1" ;;
    esac
    shift
  done

  [ -n "$user" ] || user="${DEV_GATEWAY_WEB_AUTH_USER:-dev}"
  case "$user" in
    *[!A-Za-z0-9._-]*|'') die "invalid username: $user" ;;
  esac

  if [ "$from_stdin" = "1" ]; then
    IFS= read -r password || true
    [ -n "$password" ] || die "no password on stdin"
  else
    password=$(dg_web_auth_password)
  fi

  hash=$(printf '%s' "$password" | dg_web_auth_hash) || die "could not hash the password"
  case "$hash" in
    '$apr1$'*) ;;
    *) die "unexpected hash format from openssl: $hash" ;;
  esac

  dg_env_set DEV_GATEWAY_WEB_AUTH basic
  dg_env_set DEV_GATEWAY_WEB_AUTH_USER "$user"
  dg_env_set DEV_GATEWAY_WEB_AUTH_HASH "$hash"
  dg_web_auth_render || return 1

  ok "the panel is now behind Traefik BasicAuth"
  if [ "$from_stdin" = "1" ]; then
    printf '\n  %-12s %s\n\n' "user" "$user"
  else
    printf '\n  %-12s %s\n' "user" "$user"
    printf '  %-12s %s\n\n' "password" "$(dg_bold "$password")"
    warn "this is the only time the password is shown; only its hash is stored"
  fi
  hint "the middleware is hot-reloaded; a running panel needs no restart"
}

dg_web_auth_clear() {
  if [ "${DEV_GATEWAY_WEB_EXPOSE:-local}" = "vpn" ]; then
    err "refusing to leave a routed panel without a credential"
    hint "dev-gateway web up --expose local first, then clear it"
    return 1
  fi
  dg_env_set DEV_GATEWAY_WEB_AUTH none
  dg_env_set DEV_GATEWAY_WEB_AUTH_USER ""
  dg_env_set DEV_GATEWAY_WEB_AUTH_HASH ""
  dg_web_auth_render || return 1
  ok "credential removed; the panel is reachable on loopback only"
}

dg_web_auth_apply() {
  dg_web_auth_render || return 1
  ok "rendered $(dg_web_auth_path) from .env"
}

dg_web_services() {
  if dg_is_true "${DEV_GATEWAY_WEB_DEV:-false}"; then
    printf '%s' "$DG_WEB_DEV_SERVICES"
  else
    printf '%s' "$DG_WEB_SERVICES"
  fi
}

dg_web_url() {
  local port="$DEV_GATEWAY_WEB_PORT"
  dg_is_true "${DEV_GATEWAY_WEB_DEV:-false}" && port="$DEV_GATEWAY_WEB_DEV_PORT"
  printf 'http://%s:%s' "$DEV_GATEWAY_WEB_BIND_ADDRESS" "$port"
}

dg_web_up() {
  local expose="" port="" read_only="" dev=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --expose) shift; expose="${1:-}" ;;
      --expose=*) expose="${1#--expose=}" ;;
      --port) shift; port="${1:-}" ;;
      --port=*) port="${1#--port=}" ;;
      --read-only) read_only=true ;;
      --writable) read_only=false ;;
      --dev) dev=1 ;;
      -*) die "unknown flag for 'web up': $1" ;;
      *) die "unexpected argument: $1" ;;
    esac
    shift
  done

  case "$expose" in
    ''|local|vpn) ;;
    public)
      err "the panel is never published on the internet"
      hint "BasicAuth in front of container lifecycle control is not a boundary"
      hint "worth trusting there; reach it over the VPN or an SSH tunnel"
      hint "see docs/web-ui.md"
      return 1 ;;
    *) die "unknown --expose value: $expose (local | vpn)" ;;
  esac

  # A routed panel can stop containers and, since ADR 0010, says what is being
  # worked on. Refused rather than warned, and the fix is one command.
  if [ "${expose:-${DEV_GATEWAY_WEB_EXPOSE:-local}}" = "vpn" ] && ! dg_web_auth_configured; then
    err "a routed panel needs a credential"
    hint "dev-gateway web auth set   generates one and shows it once"
    hint "see docs/adr/0012-panel-authentication-is-traefiks.md"
    return 1
  fi

  if [ -n "$port" ]; then
    case "$port" in
      ''|*[!0-9]*) die "--port must be a number" ;;
    esac
  fi

  dg_require_docker || return 1
  dg_require_compose || return 1

  # Persisted, so `dev-gateway up` brings the panel along from now on.
  dg_env_set DEV_GATEWAY_WEB true
  dg_web_prepare_database_secret
  [ -z "$expose" ] || dg_env_set DEV_GATEWAY_WEB_EXPOSE "$expose"
  [ -z "$port" ] || dg_env_set DEV_GATEWAY_WEB_PORT "$port"
  # Routed and writable is a choice, not a default: the read-only mode already
  # exists, refuses every write, and costs nothing to somebody who only looks.
  if [ -z "$read_only" ] && [ "$DEV_GATEWAY_WEB_EXPOSE" = "vpn" ] \
     && ! dg_is_true "${DEV_GATEWAY_WEB_READ_ONLY:-false}"; then
    info "a routed panel defaults to read-only; --writable opts out"
    read_only=true
  fi
  [ -z "$read_only" ] || dg_env_set DEV_GATEWAY_WEB_READ_ONLY "$read_only"
  # `web up` without --dev always means the built image, even if the previous
  # run left development mode on.
  if [ "$dev" = "1" ]; then
    dg_env_set DEV_GATEWAY_WEB_DEV true
  else
    dg_env_set DEV_GATEWAY_WEB_DEV false
    dg_web_drop_hmr
  fi
  export DEV_GATEWAY_WEB DEV_GATEWAY_WEB_DEV

  dg_resolve_profile "$DEV_GATEWAY_PROFILE" || return 1
  dg_network_ensure "$DEV_GATEWAY_NETWORK" \
    || die "could not create the shared network '$DEV_GATEWAY_NETWORK'"

  dg_web_prepare_mounts
  dg_web_prepare_bridge_image
  # Before Compose, not after: the router in compose.web-vpn.yaml names a
  # middleware, and Traefik rejects a router whose middleware does not resolve.
  dg_web_auth_render || return 1

  local services
  services=$(dg_web_services)

  info "starting the panel (profile: $DEV_GATEWAY_PROFILE, expose: $DEV_GATEWAY_WEB_EXPOSE)"
  # PostgreSQL is useful but not a condition for the panel to listen. Starting
  # it separately keeps Compose's --wait from turning degraded mode into a
  # fatal startup dependency.
  dg_compose "$DEV_GATEWAY_PROFILE" up -d db >/dev/null 2>&1 \
    || warn "the panel database did not start; the panel will run without persistence"
  # `--wait`, so "panel is up" means the panel answers, not that a container was
  # created. The image declares a healthcheck; without this the URL printed
  # below is dead for the first few seconds and every caller has to guess how
  # long to sleep.
  # shellcheck disable=SC2086  # deliberate word splitting over the service list
  dg_compose "$DEV_GATEWAY_PROFILE" up -d --build --wait --wait-timeout 180 $services || {
    err "the panel did not become healthy"
    hint "dev-gateway web logs"
    return 1
  }

  # The panel reads state/git and never collects it. One scan here means the
  # Git cards are populated the first time somebody opens the panel, rather
  # than empty with an instruction.
  if dg_have git; then
    # In a subshell: `dg_git_scan` calls `die` on an unwritable state
    # directory, and `die` exits the script. Best effort has to mean it.
    ( dg_git_scan ) >/dev/null 2>&1 || true
  fi

  ok "panel is up"
  printf '\n  %-14s %s\n' "url" "$(dg_bold "$(dg_web_url)")"
  if [ "$DEV_GATEWAY_WEB_EXPOSE" = "vpn" ]; then
    local scheme="http"
    dg_is_true "$TLS_ENABLED" && scheme="https"
    printf '  %-14s %s://%s.%s\n' "over the vpn" "$scheme" \
      "$DEV_GATEWAY_WEB_HOST" "$DEV_GATEWAY_DOMAIN"
  fi
  printf '\n'
  hint "dev-gateway web open  opens it in a browser"
  hint "dev-gateway web down  stops it; the gateway keeps running"
}

dg_web_down() {
  dg_require_docker || return 1
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" >/dev/null 2>&1 || true

  # Rendered with development mode on so the service list covers both modes:
  # whichever containers exist are the ones that get stopped.
  export DEV_GATEWAY_WEB=true DEV_GATEWAY_WEB_DEV=true

  info "stopping the panel"
  # `stop` then `rm`, never `down`: `down` would take the whole gateway with it.
  # shellcheck disable=SC2086
  dg_compose "$DEV_GATEWAY_PROFILE" stop db $DG_WEB_DEV_SERVICES >/dev/null 2>&1
  # shellcheck disable=SC2086
  dg_compose "$DEV_GATEWAY_PROFILE" rm -f db $DG_WEB_DEV_SERVICES >/dev/null 2>&1
  ok "panel stopped; Traefik and the projects were not touched"
}

dg_web_disable() {
  ( dg_web_down "$@" )
  dg_env_set DEV_GATEWAY_WEB false
  ok "the panel will no longer start with 'dev-gateway up'"
  hint "dev-gateway web up turns it back on"
}

dg_web_restart() {
  dg_require_docker || return 1
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" || return 1
  local services
  services=$(dg_web_services)
  export DEV_GATEWAY_WEB=true
  # shellcheck disable=SC2086
  dg_compose "$DEV_GATEWAY_PROFILE" restart $services
  ok "panel restarted"
}

dg_web_status() {
  dg_require_docker || return 1

  local as_json=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --json) as_json=1 ;;
      *) die "unknown argument: $1" ;;
    esac
    shift
  done

  local web_id proxy_id web_state web_health proxy_state
  web_id=$(dg_gateway_container web)
  proxy_id=$(dg_gateway_container web-socket-proxy)
  if [ -n "$web_id" ]; then
    web_state=$(dg_container_state "$web_id")
    web_health=$(dg_container_health "$web_id")
  else
    web_state="absent"; web_health="none"
  fi
  proxy_state=$([ -n "$proxy_id" ] && dg_container_state "$proxy_id" || printf 'absent')

  if [ "$as_json" = "1" ]; then
    cat <<JSON
{
  "enabled": $(dg_is_true "$DEV_GATEWAY_WEB" && echo true || echo false),
  "dev_mode": $(dg_is_true "$DEV_GATEWAY_WEB_DEV" && echo true || echo false),
  "read_only": $(dg_is_true "$DEV_GATEWAY_WEB_READ_ONLY" && echo true || echo false),
  "expose": "$DEV_GATEWAY_WEB_EXPOSE",
  "url": "$(dg_web_url)",
  "panel": {"state": "$web_state", "health": "$web_health"},
  "socket_proxy": {"state": "$proxy_state"}
}
JSON
    return 0
  fi

  printf '%s\n' "$(dg_bold 'Dev Gateway panel')"
  printf '  %-16s %s\n' "enabled" "$(dg_is_true "$DEV_GATEWAY_WEB" && printf 'yes' || printf 'no')"
  printf '  %-16s %s\n' "url" "$(dg_web_url)"
  printf '  %-16s %s\n' "expose" "$DEV_GATEWAY_WEB_EXPOSE"
  printf '  %-16s %s\n' "mode" "$(dg_is_true "$DEV_GATEWAY_WEB_DEV" && printf 'development (HMR)' || printf 'production')"
  printf '  %-16s %s\n' "read-only" "$(dg_is_true "$DEV_GATEWAY_WEB_READ_ONLY" && printf 'yes' || printf 'no')"
  printf '  %-16s %s (%s)\n' "panel" "$web_state" "$web_health"
  printf '  %-16s %s\n' "socket proxy" "$proxy_state"

  if [ "$web_state" != "running" ]; then
    hint "dev-gateway web up starts it"
  fi
}

dg_web_open() {
  local url
  url=$(dg_web_url)
  printf '%s\n' "$url"
  if dg_have open; then
    open "$url" >/dev/null 2>&1 || true
  elif dg_have xdg-open; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

dg_web_logs() {
  dg_require_docker || return 1
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" || return 1
  local target="${1:-web}"
  case "$target" in
    web|web-ui|web-socket-proxy) ;;
    *) die "unknown panel service: $target (web | web-ui | web-socket-proxy)" ;;
  esac
  export DEV_GATEWAY_WEB=true
  dg_compose "$DEV_GATEWAY_PROFILE" logs -f --tail 100 "$target"
}

dg_web_build() {
  dg_require_docker || return 1
  dg_require_compose || return 1
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" || return 1
  info "building the panel image"
  export DEV_GATEWAY_WEB=true
  dg_compose "$DEV_GATEWAY_PROFILE" build web
  ok "panel image built"
}

dg_web_dev() {
  info "starting the panel with hot reloading"
  dg_env_set DEV_GATEWAY_WEB_DEV true
  export DEV_GATEWAY_WEB_DEV=true
  dg_web_up --dev "$@"
  hint "the API runs beside Vite; edits under web/src reload on their own"
  hint "dev-gateway web up (without dev) goes back to the built image"
}
