#!/usr/bin/env bash
# ============================================================================
# Portta: bootstrap
# ============================================================================
# Prepares a host to run the gateway. Idempotent by design: run it as often as
# you like. It never deletes user data and never touches consumer projects.
#
# It deliberately does NOT start the gateway; `portta up` does that, so
# that preparing a host and putting it into service stay separate decisions.
# ============================================================================

set -euo pipefail

PORTTA_SCRIPT_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$PORTTA_SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/docker.sh
. "$PORTTA_SCRIPT_DIR/lib/docker.sh"

portta_load_env
portta_defaults

SKIP_PULL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-pull) SKIP_PULL=1 ;;
    -y|--yes) PORTTA_ASSUME_YES=true ;;
    -h|--help)
      cat >&2 <<'PORTTA_HELP'
portta bootstrap: prepare this host to run the gateway

  --skip-pull   Do not pre-pull component images
  -y, --yes     Assume yes for confirmation prompts

Idempotent. Creates the shared Docker network and the gateway state
directories, validates the runtime and configuration, then runs doctor.
PORTTA_HELP
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done
export PORTTA_ASSUME_YES

step "1/8  Docker runtime"
portta_require_docker || exit 1
docker_version=$(portta_docker_server_version)
docker_major=$(portta_version_major "$docker_version")
if [ "${docker_major:-0}" -lt "$PORTTA_MIN_DOCKER_MAJOR" ] 2>/dev/null; then
  warn "Docker $docker_version is older than the supported minimum ($PORTTA_MIN_DOCKER_MAJOR)"
  hint "the gateway may work, but it is untested below Docker $PORTTA_MIN_DOCKER_MAJOR"
else
  ok "Docker $docker_version"
fi

step "2/8  Docker Compose"
portta_require_compose || exit 1
compose_version=$(portta_compose_version)
compose_major=$(portta_version_major "$compose_version")
if [ "${compose_major:-0}" -lt "$PORTTA_MIN_COMPOSE_MAJOR" ] 2>/dev/null; then
  die "Docker Compose v$PORTTA_MIN_COMPOSE_MAJOR or newer is required (found $compose_version)"
fi
ok "Docker Compose $compose_version"

step "3/8  Configuration"
if [ -f "$PORTTA_ROOT/.env" ]; then
  ok ".env found"
  # `cp .env.example .env` inherits the umask, so the documented quick start
  # leaves a world-readable file that will grow secrets. Tightening the
  # permissions of the gateway's own configuration file is never destructive,
  # so do it and say so rather than only warning.
  env_mode=$(ls -l "$PORTTA_ROOT/.env" | cut -c1-10)
  case "$env_mode" in
    -rw-------) ;;
    *)
      chmod 600 "$PORTTA_ROOT/.env" \
        && ok "tightened .env permissions from $env_mode to -rw------- (it may hold secrets)"
      ;;
  esac
else
  warn "no .env file; the gateway will run on built-in defaults"
  if portta_confirm "Create .env from .env.example now?"; then
    cp "$PORTTA_ROOT/.env.example" "$PORTTA_ROOT/.env"
    # .env may grow secrets (auth keys, API tokens); keep it owner-only.
    chmod 600 "$PORTTA_ROOT/.env"
    ok "created .env (edit it before enabling remote or public profiles)"
    portta_load_env
    portta_defaults
  else
    hint "cp .env.example .env"
  fi
fi

# Re-resolve after a possible .env creation.
if [ -f "$PORTTA_ROOT/.env" ] && [ -z "${PORTTA_RUNTIME_DB_PASSWORD:-}" ]; then
  portta_env_set PORTTA_RUNTIME_DB_PASSWORD "$(portta_random_hex 32)"
  ok "generated the panel database credential in .env"
fi

portta_resolve_profile "$PORTTA_PROFILE" || exit 1
info "profile: $PORTTA_PROFILE, domain: $PORTTA_DOMAIN"

step "4/8  State directories"
# Bind mounts under ./state keep gateway state inspectable and backupable, and
# make it obvious that no consumer volume is ever involved.
for d in traefik/acme tailscale access; do
  mkdir -p "$PORTTA_STATE_DIR/$d"
done
# ACME material must never be world readable.
chmod 700 "$PORTTA_STATE_DIR/traefik/acme" 2>/dev/null || true
if [ -f "$PORTTA_STATE_DIR/traefik/acme/acme.json" ]; then
  chmod 600 "$PORTTA_STATE_DIR/traefik/acme/acme.json" 2>/dev/null || true
fi
ok "state directories ready under ./state"

step "5/8  Shared network"
if portta_network_exists "$PORTTA_NETWORK"; then
  ok "network '$PORTTA_NETWORK' already exists; reused as is"
  if ! portta_network_is_managed "$PORTTA_NETWORK"; then
    warn "network '$PORTTA_NETWORK' was not created by the gateway"
    hint "that is fine; the gateway will never remove a network it does not own"
  fi
else
  portta_network_ensure "$PORTTA_NETWORK" \
    || die "failed to create the shared network '$PORTTA_NETWORK'"
  ok "created shared network '$PORTTA_NETWORK'"
fi

step "6/8  Compose configuration"
if portta_compose "$PORTTA_PROFILE" config --quiet; then
  ok "compose configuration is valid for profile '$PORTTA_PROFILE'"
else
  die "compose configuration is invalid; fix it before continuing"
fi

step "7/8  Component images"
if [ "$SKIP_PULL" = "1" ]; then
  info "skipping image pull (--skip-pull)"
else
  info "pulling pinned images (versions are fixed on purpose; see docs/adr/0004-pinned-versions.md)"
  portta_compose "$PORTTA_PROFILE" pull --quiet \
    || warn "could not pull every image; 'portta up' will retry"
fi

step "8/8  Diagnostics"
set +e
"$PORTTA_ROOT/scripts/doctor.sh"
doctor_status=$?
set -e

step "Next steps"
cat >&2 <<PORTTA_NEXT
  portta up ${PORTTA_PROFILE}     start the gateway
  portta status              see what is running
  portta urls                list the hostnames being served

  To adapt a project, from that project's own directory:
    portta analyze /path/to/project
  See docs/adopting-projects.md. Projects are never moved into this repository.
PORTTA_NEXT

exit "$doctor_status"
