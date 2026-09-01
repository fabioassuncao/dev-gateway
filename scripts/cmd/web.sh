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
    -h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway web: the administration panel

  web up [--expose local|vpn] [--port N] [--read-only]
                         Enable and start the panel
  web down               Stop it. The gateway itself keeps running
  web disable            Stop it and take it out of `dev-gateway up`
  web restart            Restart the panel containers
  web status             Where it is listening, and whether it is healthy
  web open               Print (and open) the panel URL
  web logs [service]     Follow the panel logs
  web build              Build the panel image
  web dev                Run it with hot reloading, Vite in front of the API

The panel binds 127.0.0.1 by default and is never routed through the public
entrypoints. `--expose vpn` adds a Traefik router so it is reachable from the
tailnet, and is refused on the remote-public profile.

See docs/web-ui.md.
DG_HELP
      ;;
    *) err "unknown web subcommand: $sub"; hint "dev-gateway web --help"; return 1 ;;
  esac
}

# The panel bind-mounts these two files; Docker would silently create
# directories in their place if they were missing.
dg_web_prepare_mounts() {
  [ -f "$DG_ROOT/.env" ] || {
    info "creating .env (the panel edits it from Settings)"
    : > "$DG_ROOT/.env"
    chmod 600 "$DG_ROOT/.env"
  }
  [ -f "$DG_ROOT/VERSION" ] || printf '0.0.0\n' > "$DG_ROOT/VERSION"
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
      hint "it has no authentication; reach it over the VPN or an SSH tunnel"
      hint "see docs/web-ui.md"
      return 1 ;;
    *) die "unknown --expose value: $expose (local | vpn)" ;;
  esac

  if [ -n "$port" ]; then
    case "$port" in
      ''|*[!0-9]*) die "--port must be a number" ;;
    esac
  fi

  dg_require_docker || return 1
  dg_require_compose || return 1

  # Persisted, so `dev-gateway up` brings the panel along from now on.
  dg_env_set DEV_GATEWAY_WEB true
  [ -z "$expose" ] || dg_env_set DEV_GATEWAY_WEB_EXPOSE "$expose"
  [ -z "$port" ] || dg_env_set DEV_GATEWAY_WEB_PORT "$port"
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

  local services
  services=$(dg_web_services)

  info "starting the panel (profile: $DEV_GATEWAY_PROFILE, expose: $DEV_GATEWAY_WEB_EXPOSE)"
  # shellcheck disable=SC2086  # deliberate word splitting over the service list
  dg_compose "$DEV_GATEWAY_PROFILE" up -d --build $services || return 1

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
  dg_compose "$DEV_GATEWAY_PROFILE" stop $DG_WEB_DEV_SERVICES >/dev/null 2>&1
  # shellcheck disable=SC2086
  dg_compose "$DEV_GATEWAY_PROFILE" rm -f $DG_WEB_DEV_SERVICES >/dev/null 2>&1
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
