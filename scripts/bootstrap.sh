#!/usr/bin/env bash
# ============================================================================
# Dev Gateway: bootstrap
# ============================================================================
# Prepares a host to run the gateway. Idempotent by design: run it as often as
# you like. It never deletes user data and never touches consumer projects.
#
# It deliberately does NOT start the gateway; `dev-gateway up` does that, so
# that preparing a host and putting it into service stay separate decisions.
# ============================================================================

set -euo pipefail

DG_SCRIPT_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$DG_SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/docker.sh
. "$DG_SCRIPT_DIR/lib/docker.sh"

dg_load_env
dg_defaults

SKIP_PULL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-pull) SKIP_PULL=1 ;;
    -y|--yes) DG_ASSUME_YES=true ;;
    -h|--help)
      cat >&2 <<'DG_HELP'
dev-gateway bootstrap: prepare this host to run the gateway

  --skip-pull   Do not pre-pull component images
  -y, --yes     Assume yes for confirmation prompts

Idempotent. Creates the shared Docker network and the gateway state
directories, validates the runtime and configuration, then runs doctor.
DG_HELP
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done
export DG_ASSUME_YES

step "1/8  Docker runtime"
dg_require_docker || exit 1
docker_version=$(dg_docker_server_version)
docker_major=$(dg_version_major "$docker_version")
if [ "${docker_major:-0}" -lt "$DG_MIN_DOCKER_MAJOR" ] 2>/dev/null; then
  warn "Docker $docker_version is older than the supported minimum ($DG_MIN_DOCKER_MAJOR)"
  hint "the gateway may work, but it is untested below Docker $DG_MIN_DOCKER_MAJOR"
else
  ok "Docker $docker_version"
fi

step "2/8  Docker Compose"
dg_require_compose || exit 1
compose_version=$(dg_compose_version)
compose_major=$(dg_version_major "$compose_version")
if [ "${compose_major:-0}" -lt "$DG_MIN_COMPOSE_MAJOR" ] 2>/dev/null; then
  die "Docker Compose v$DG_MIN_COMPOSE_MAJOR or newer is required (found $compose_version)"
fi
ok "Docker Compose $compose_version"

step "3/8  Configuration"
if [ -f "$DG_ROOT/.env" ]; then
  ok ".env found"
  # `cp .env.example .env` inherits the umask, so the documented quick start
  # leaves a world-readable file that will grow secrets. Tightening the
  # permissions of the gateway's own configuration file is never destructive,
  # so do it and say so rather than only warning.
  env_mode=$(ls -l "$DG_ROOT/.env" | cut -c1-10)
  case "$env_mode" in
    -rw-------) ;;
    *)
      chmod 600 "$DG_ROOT/.env" \
        && ok "tightened .env permissions from $env_mode to -rw------- (it may hold secrets)"
      ;;
  esac
else
  warn "no .env file; the gateway will run on built-in defaults"
  if dg_confirm "Create .env from .env.example now?"; then
    cp "$DG_ROOT/.env.example" "$DG_ROOT/.env"
    # .env may grow secrets (auth keys, API tokens); keep it owner-only.
    chmod 600 "$DG_ROOT/.env"
    ok "created .env (edit it before enabling remote or public profiles)"
    dg_load_env
    dg_defaults
  else
    hint "cp .env.example .env"
  fi
fi

# Re-resolve after a possible .env creation.
dg_resolve_profile "$DEV_GATEWAY_PROFILE" || exit 1
info "profile: $DEV_GATEWAY_PROFILE, domain: $DEV_GATEWAY_DOMAIN"

step "4/8  State directories"
# Bind mounts under ./state keep gateway state inspectable and backupable, and
# make it obvious that no consumer volume is ever involved.
for d in traefik/acme tailscale access; do
  mkdir -p "$DG_STATE_DIR/$d"
done
# ACME material must never be world readable.
chmod 700 "$DG_STATE_DIR/traefik/acme" 2>/dev/null || true
if [ -f "$DG_STATE_DIR/traefik/acme/acme.json" ]; then
  chmod 600 "$DG_STATE_DIR/traefik/acme/acme.json" 2>/dev/null || true
fi
ok "state directories ready under ./state"

step "5/8  Shared network"
if dg_network_exists "$DEV_GATEWAY_NETWORK"; then
  ok "network '$DEV_GATEWAY_NETWORK' already exists; reused as is"
  if ! dg_network_is_managed "$DEV_GATEWAY_NETWORK"; then
    warn "network '$DEV_GATEWAY_NETWORK' was not created by the gateway"
    hint "that is fine; the gateway will never remove a network it does not own"
  fi
else
  dg_network_ensure "$DEV_GATEWAY_NETWORK" \
    || die "failed to create the shared network '$DEV_GATEWAY_NETWORK'"
  ok "created shared network '$DEV_GATEWAY_NETWORK'"
fi

step "6/8  Compose configuration"
if dg_compose "$DEV_GATEWAY_PROFILE" config --quiet; then
  ok "compose configuration is valid for profile '$DEV_GATEWAY_PROFILE'"
else
  die "compose configuration is invalid; fix it before continuing"
fi

step "7/8  Component images"
if [ "$SKIP_PULL" = "1" ]; then
  info "skipping image pull (--skip-pull)"
else
  info "pulling pinned images (versions are fixed on purpose; see docs/adr/0004-pinned-versions.md)"
  dg_compose "$DEV_GATEWAY_PROFILE" pull --quiet \
    || warn "could not pull every image; 'dev-gateway up' will retry"
fi

step "8/8  Diagnostics"
set +e
"$DG_ROOT/scripts/doctor.sh"
doctor_status=$?
set -e

step "Next steps"
cat >&2 <<DG_NEXT
  dev-gateway up ${DEV_GATEWAY_PROFILE}     start the gateway
  dev-gateway status              see what is running
  dev-gateway urls                list the hostnames being served

  To adapt a project, from that project's own directory:
    dev-gateway analyze /path/to/project
  See docs/adopting-projects.md. Projects are never moved into this repository.
DG_NEXT

exit "$doctor_status"
