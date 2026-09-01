#!/usr/bin/env bash
# Dev Gateway: containerised tooling.
#
# The gateway promises a host needs only Docker, Git and a shell. Anything else
# it needs (curl, jq, dig, openssl, socat, psql, redis-cli, ssh) lives in one
# small image built from toolbox/Dockerfile.

DG_TOOLBOX_IMAGE="dev-gateway/toolbox:0.1.0"

dg_toolbox_exists() {
  docker image inspect "$DG_TOOLBOX_IMAGE" >/dev/null 2>&1
}

# dg_toolbox_ensure [--quiet]: build the image if it is not present.
dg_toolbox_ensure() {
  dg_toolbox_exists && return 0
  [ "${1:-}" = "--quiet" ] || info "building the toolbox image (first use only)"
  docker build -q -t "$DG_TOOLBOX_IMAGE" "$DG_ROOT/toolbox" >/dev/null || {
    err "could not build the toolbox image"
    hint "docker build -t $DG_TOOLBOX_IMAGE toolbox/"
    return 1
  }
  return 0
}

# dg_toolbox <command...>: run a command in the toolbox, no network attached.
# Ephemeral by construction: --rm, no volumes, no privileges.
dg_toolbox() {
  dg_toolbox_ensure --quiet || return 1
  docker run --rm --network none "$DG_TOOLBOX_IMAGE" "$@"
}

# dg_toolbox_net <network> <command...>: same, joined to one Docker network.
# Used to reach a project's private services without publishing a port.
dg_toolbox_net() {
  local net="$1"; shift
  dg_toolbox_ensure --quiet || return 1
  docker run --rm --network "$net" "$DG_TOOLBOX_IMAGE" "$@"
}

# dg_toolbox_online <command...>: with outbound network access, for DNS
# lookups and API calls.
dg_toolbox_online() {
  dg_toolbox_ensure --quiet || return 1
  docker run --rm "$DG_TOOLBOX_IMAGE" "$@"
}

# dg_curl / dg_jq / dg_dig: prefer the host binary when it exists (faster and
# avoids a container per call), otherwise fall back to the toolbox.
dg_curl() {
  if dg_have curl; then curl "$@"; else dg_toolbox_online curl "$@"; fi
}

dg_jq() {
  if dg_have jq; then jq "$@"; else
    # stdin has to reach the container, so this variant keeps it open.
    dg_toolbox_ensure --quiet || return 1
    docker run --rm -i --network none "$DG_TOOLBOX_IMAGE" jq "$@"
  fi
}

dg_dig() {
  if dg_have dig; then dig "$@"; else dg_toolbox_online dig "$@"; fi
}

# dg_toolbox_stdin <command...>: same as dg_toolbox, with stdin kept open.
# Used to hash a password without ever putting it on a command line, where
# `ps` would show it to every user on the host.
dg_toolbox_stdin() {
  dg_toolbox_ensure --quiet || return 1
  docker run --rm -i --network none "$DG_TOOLBOX_IMAGE" "$@"
}
