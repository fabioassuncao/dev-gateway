#!/usr/bin/env bash
# Dev Gateway: Docker and Compose helpers.
#
# Everything the gateway creates carries `dev-gateway.managed=true`. Nothing in
# here may stop, remove or reconfigure a resource that lacks that label:
# consumer projects own their own containers, networks and volumes.

# ---------------------------------------------------------------------------
# Runtime checks
# ---------------------------------------------------------------------------

# Minimum versions enforced by `doctor`, which sources this file.
# shellcheck disable=SC2034  # consumed by scripts/doctor.sh
DG_MIN_DOCKER_MAJOR=24
# shellcheck disable=SC2034  # consumed by scripts/doctor.sh
DG_MIN_COMPOSE_MAJOR=2

dg_require_docker() {
  dg_have docker || {
    err "docker not found in PATH"
    hint "install OrbStack (recommended on macOS) or Docker Desktop / Docker Engine"
    return 1
  }
  docker info >/dev/null 2>&1 || {
    err "cannot talk to the Docker daemon"
    hint "start OrbStack / Docker Desktop, or check DOCKER_HOST"
    return 1
  }
  return 0
}

dg_docker_server_version() {
  docker version --format '{{.Server.Version}}' 2>/dev/null
}

dg_compose_version() {
  docker compose version --short 2>/dev/null
}

dg_require_compose() {
  docker compose version >/dev/null 2>&1 || {
    err "the Docker Compose plugin is not available"
    hint "Compose v2+ is required; 'docker-compose' (v1) is not supported"
    return 1
  }
  return 0
}

# dg_version_major <version-string>
dg_version_major() {
  printf '%s' "${1:-0}" | sed -e 's/^v//' -e 's/[^0-9.].*$//' | cut -d. -f1
}

# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

DG_PROFILES="local remote-private remote-public"

dg_profile_valid() {
  case " $DG_PROFILES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# dg_resolve_profile <profile>: apply the profile's effective settings.
#
# The domain used for generated hostnames depends on the profile, and Traefik
# bakes it into its default rule at startup, so it has to be settled here,
# before Compose is invoked.
dg_resolve_profile() {
  local profile="$1"
  dg_profile_valid "$profile" || {
    err "unknown profile: $profile"
    hint "valid profiles: $DG_PROFILES"
    return 1
  }

  DEV_GATEWAY_PROFILE="$profile"

  case "$profile" in
    local)
      : "${DEV_GATEWAY_DOMAIN:=localhost}"
      : "${DEV_GATEWAY_BIND_ADDRESS:=127.0.0.1}"
      ;;

    remote-private)
      if [ -n "${PRIVATE_DOMAIN:-}" ]; then
        DEV_GATEWAY_DOMAIN="$PRIVATE_DOMAIN"
      fi
      if dg_is_true "${TAILSCALE_ENABLED:-false}"; then
        # Traefik lives inside the Tailscale container's network namespace and
        # is reached over the tailnet. The published ports exist only so the
        # VPS itself can curl the gateway, hence loopback.
        DEV_GATEWAY_BIND_ADDRESS="127.0.0.1"
      elif [ "${DEV_GATEWAY_BIND_ADDRESS:-}" = "0.0.0.0" ]; then
        err "profile remote-private must not bind 0.0.0.0"
        hint "either enable TAILSCALE_ENABLED=true, or set DEV_GATEWAY_BIND_ADDRESS"
        hint "to the address of your VPN interface"
        return 1
      fi
      ;;

    remote-public)
      if [ -z "${PUBLIC_DOMAIN:-}" ]; then
        err "profile remote-public requires PUBLIC_DOMAIN"
        hint "set PUBLIC_DOMAIN in .env, e.g. PUBLIC_DOMAIN=dev.example.com"
        return 1
      fi
      DEV_GATEWAY_DOMAIN="$PUBLIC_DOMAIN"
      # Public means public: this is the one profile that binds every interface.
      DEV_GATEWAY_BIND_ADDRESS="0.0.0.0"
      ;;
  esac

  # The panel has no authentication, so it is never routed where Traefik
  # answers the internet.
  if dg_is_true "${DEV_GATEWAY_WEB:-false}" \
     && [ "${DEV_GATEWAY_WEB_EXPOSE:-local}" = "vpn" ] \
     && [ "$profile" = "remote-public" ]; then
    err "the panel must not be routed on the remote-public profile"
    hint "Traefik binds every interface there, so a router for the panel would be public"
    hint "set DEV_GATEWAY_WEB_EXPOSE=local and reach it over SSH or the tailnet"
    return 1
  fi

  # ACME cannot issue a certificate without a contact address.
  case "$profile" in
    remote-private|remote-public)
      if dg_is_true "${TLS_ENABLED:-false}" && [ "${TLS_MODE:-}" = "acme" ] \
         && [ -z "${ACME_EMAIL:-}" ]; then
        err "TLS_MODE=acme requires ACME_EMAIL"
        hint "set ACME_EMAIL in .env"
        return 1
      fi
      ;;
  esac

  export DEV_GATEWAY_PROFILE DEV_GATEWAY_DOMAIN DEV_GATEWAY_BIND_ADDRESS
  return 0
}

# dg_attachment <profile>: which overlay decides how Traefik meets the world.
dg_attachment() {
  case "$1" in
    local) printf 'host' ;;
    remote-private|remote-public)
      if dg_is_true "${TAILSCALE_ENABLED:-false}"; then printf 'tailscale'; else printf 'host'; fi
      ;;
  esac
}

# dg_compose_files <profile>: echo the -f arguments for a profile, in order.
dg_compose_files() {
  local profile="$1"
  local files="compose.yaml"
  local attachment
  attachment=$(dg_attachment "$profile")

  # Exactly one attach-* overlay, always.
  files="$files compose.attach-$attachment.yaml"

  case "$profile" in
    local)
      files="$files compose.local.yaml"
      # A locally-issued certificate flips the default entrypoint to :443.
      if dg_is_true "${TLS_ENABLED:-false}" && [ "${TLS_MODE:-local}" = "local" ]; then
        files="$files compose.local-tls.yaml"
      fi
      ;;
    remote-private) files="$files compose.remote.yaml" ;;
    remote-public) files="$files compose.remote.yaml compose.public.yaml" ;;
  esac

  if dg_is_true "${DEV_GATEWAY_DASHBOARD:-false}"; then
    # The dashboard port has to be published by whichever container owns the
    # network namespace.
    if [ "$attachment" = "tailscale" ]; then
      files="$files compose.dashboard-tailscale.yaml"
    else
      files="$files compose.dashboard.yaml"
    fi
  fi

  # The panel is opt-in and rides along with the gateway once enabled, so
  # `dev-gateway up` and `dev-gateway web` cannot drift apart.
  if dg_is_true "${DEV_GATEWAY_WEB:-false}"; then
    files="$files compose.web.yaml"
    if dg_is_true "${DEV_GATEWAY_WEB_DEV:-false}"; then
      files="$files compose.web-dev.yaml"
    fi
    if [ "${DEV_GATEWAY_WEB_EXPOSE:-local}" = "vpn" ]; then
      files="$files compose.web-vpn.yaml"
    fi
  fi

  local f out=""
  for f in $files; do
    [ -f "$DG_ROOT/$f" ] || {
      err "missing compose file: $f"
      hint "profile '$profile' is not available in this version of the gateway"
      return 1
    }
    out="$out -f $DG_ROOT/$f"
  done
  printf '%s' "${out# }"
}

# dg_compose <profile> <compose args...>
dg_compose() {
  local profile="$1"; shift
  local files
  files=$(dg_compose_files "$profile") || return 1
  # shellcheck disable=SC2086
  ( cd "$DG_ROOT" && docker compose $files "$@" )
}

# ---------------------------------------------------------------------------
# Networks
# ---------------------------------------------------------------------------

dg_network_exists() {
  docker network inspect "$1" >/dev/null 2>&1
}

# dg_network_ensure <name>: idempotent. Creates the shared network if absent,
# labelled so `doctor` and the cleanup paths can prove we own it. An existing
# network is reused untouched, even if it predates the gateway.
dg_network_ensure() {
  local name="$1"
  if dg_network_exists "$name"; then
    return 0
  fi
  docker network create \
    --label dev-gateway.managed=true \
    --label dev-gateway.component=shared-network \
    "$name" >/dev/null || return 1
  return 0
}

dg_network_is_managed() {
  [ "$(docker network inspect "$1" --format '{{ index .Labels "dev-gateway.managed" }}' 2>/dev/null)" = "true" ]
}

# dg_network_endpoints <name>: number of containers currently attached.
dg_network_endpoints() {
  docker network inspect "$1" --format '{{ len .Containers }}' 2>/dev/null || printf '0'
}

# ---------------------------------------------------------------------------
# Ownership
# ---------------------------------------------------------------------------

# dg_container_is_managed <container>: true only for gateway-created
# containers. Every destructive code path must gate on this.
dg_container_is_managed() {
  [ "$(docker inspect "$1" --format '{{ index .Config.Labels "dev-gateway.managed" }}' 2>/dev/null)" = "true" ]
}

dg_container_state() {
  docker inspect "$1" --format '{{ .State.Status }}' 2>/dev/null || printf 'absent'
}

# dg_container_health <container>: "healthy", "unhealthy", "starting", or
# "none" when the image declares no healthcheck.
dg_container_health() {
  docker inspect "$1" --format '{{ if .State.Health }}{{ .State.Health.Status }}{{ else }}none{{ end }}' 2>/dev/null || printf 'absent'
}

# dg_gateway_container <component>: resolve a gateway container id by label.
dg_gateway_container() {
  docker ps -aq \
    --filter "label=dev-gateway.managed=true" \
    --filter "label=dev-gateway.component=$1" \
    2>/dev/null | head -1
}

# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

# dg_discover_http [project]: every container that opted into the gateway.
#
# Reads Docker labels directly rather than Traefik's API: discovery then works
# with the dashboard disabled and even while Traefik is down, and it needs no
# extra port open anywhere.
#
# Output, one line per container, tab separated:
#   project  service  container  hostname  port  state
dg_discover_http() {
  local want_project="${1:-}"
  local id project service name rule host port state

  for id in $(docker ps -q --filter "label=traefik.enable=true" 2>/dev/null); do
    project=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null)
    service=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.service" }}' 2>/dev/null)
    name=$(docker inspect "$id" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')
    state=$(dg_container_state "$id")

    # An explicit Host(`...`) rule label wins over the derived hostname, the
    # same way it does inside Traefik.
    rule=$(docker inspect "$id" --format \
      '{{ range $k, $v := .Config.Labels }}{{ if and (hasPrefix $k "traefik.http.routers.") (hasSuffix $k ".rule") }}{{ $v }}{{ "\n" }}{{ end }}{{ end }}' \
      2>/dev/null | head -1)

    host=""
    if [ -n "$rule" ]; then
      host=$(printf '%s' "$rule" | sed -n 's/.*Host(`\([^`]*\)`).*/\1/p')
    fi
    if [ -z "$host" ]; then
      if [ -n "$project" ]; then
        host="$(dg_slug "$project")-$(dg_slug "$service").${DEV_GATEWAY_DOMAIN}"
      else
        host="$(dg_slug "$name").${DEV_GATEWAY_DOMAIN}"
      fi
    fi

    port=$(docker inspect "$id" --format \
      '{{ range $k, $v := .Config.Labels }}{{ if and (hasPrefix $k "traefik.http.services.") (hasSuffix $k ".loadbalancer.server.port") }}{{ $v }}{{ end }}{{ end }}' \
      2>/dev/null)
    [ -n "$port" ] || port="auto"

    [ -z "$want_project" ] || [ "$want_project" = "$project" ] || continue

    printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
      "${project:-<none>}" "${service:-<none>}" "$name" "$host" "$port" "$state"
  done
}

# dg_compose_projects: distinct Compose project names currently running.
dg_compose_projects() {
  docker ps -q 2>/dev/null | while read -r id; do
    docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null
  done | grep -v '^$' | sort -u
}
