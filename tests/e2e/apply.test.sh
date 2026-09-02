#!/usr/bin/env bash
# ============================================================================
# E2E: applying settings without a terminal
# ============================================================================
# The panel writes .env and can only start containers, so a saved setting used
# to need `portta up` typed on the host. The applier closes that gap: a stopped,
# single-purpose container the panel may start.
#
# What has to be true for it to be safe, and to work at all:
#   - it does not exist unless PORTTA_APPLY=true;
#   - it recreates the gateway, so a static Traefik setting actually changes;
#   - it survives the `up --remove-orphans` it runs, or its exit code is lost;
#   - it never touches a consumer project.
#
# See docs/adr/0026-applying-settings-from-the-panel.md.
# ============================================================================
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/docker.sh"
portta_load_env; portta_defaults

. "$PORTTA_ROOT/scripts/lib/apply.sh"

GW="$PORTTA_ROOT/bin/portta"
ORIGINAL_LOG_LEVEL="$PORTTA_LOG_LEVEL"

# A host in panel development mode, or building the panel image, refuses to
# prepare an applier at all -- correctly, and that is asserted in
# tests/unit/apply.test.sh. There is nothing to exercise here on such a host,
# and failing would say the feature is broken when it is behaving.
REFUSAL=$(portta_apply_refusal)
if [ -n "$REFUSAL" ]; then
  describe "applying settings without a terminal"
  it "the applier"; skip "this host refuses one: $REFUSAL"
  t_summary
  exit $?
fi

cleanup() {
  portta_env_set PORTTA_LOG_LEVEL "$ORIGINAL_LOG_LEVEL" >/dev/null 2>&1
  portta_env_set PORTTA_APPLY false >/dev/null 2>&1
  PORTTA_APPLY=false "$GW" up local >/dev/null 2>&1
  ( cd "$PORTTA_ROOT/docker/examples/demo-a" && docker compose \
      -f compose.yaml -f compose.portta.yaml down -v ) >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

traefik_log_level() {
  docker inspect portta-traefik-1 --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep '^TRAEFIK_LOG_LEVEL=' | cut -d= -f2
}

describe "the applier does not exist unless it is asked for"

portta_env_set PORTTA_APPLY false >/dev/null
"$GW" up local >/dev/null 2>&1

it "off by default"
assert_eq "" "$(portta_gateway_container apply)"

describe "turning it on prepares it, stopped"

portta_env_set PORTTA_APPLY true >/dev/null
"$GW" up local >/dev/null 2>&1
APPLIER=$(portta_gateway_container apply)

it "the container exists"
assert_ne "" "$APPLIER"

it "and has never been started"
assert_eq "created" "$(portta_container_state "$APPLIER")"

it "it is not part of the gateway's Compose project"
# The reason it is not: `up --remove-orphans` decides what to delete from the
# project label, so a Compose applier would remove itself mid-run.
assert_eq "" "$(docker inspect "$APPLIER" \
  --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null)"

it "the repository is mounted at the path the host knows it by"
# Compose hands the daemon absolute host paths for the overlays' relative binds
# (./config, ./state). A different path in here makes Docker create empty
# directories in their place, and Traefik starts with no dynamic configuration.
assert_contains "$(docker inspect "$APPLIER" --format '{{range .HostConfig.Binds}}{{println .}}{{end}}')" \
  "$PORTTA_ROOT:$PORTTA_ROOT"

it "and its working directory is that same path"
assert_eq "$PORTTA_ROOT" "$(docker inspect "$APPLIER" --format '{{.Config.WorkingDir}}')"

describe "it recreates the gateway, rather than restarting it"

# A restart would keep the environment the container was created with, which is
# exactly why the panel could not do this itself. Traefik's log level is a
# static setting: if it changed, the container was recreated.
( cd "$PORTTA_ROOT/docker/examples/demo-a" && docker compose \
    -f compose.yaml -f compose.portta.yaml up -d --wait --wait-timeout 180 ) >/dev/null 2>&1
DEMO_BEFORE=$(docker inspect demo-a-web-1 --format '{{.Id}}' 2>/dev/null)
TRAEFIK_BEFORE=$(docker inspect portta-traefik-1 --format '{{.Id}}' 2>/dev/null)

portta_env_set PORTTA_LOG_LEVEL DEBUG >/dev/null
docker start -a "$APPLIER" >/dev/null 2>&1
APPLY_EXIT=$(docker inspect "$APPLIER" --format '{{.State.ExitCode}}')

it "the apply succeeds"
assert_eq "0" "$APPLY_EXIT"

it "Traefik now runs with the saved value"
assert_eq "DEBUG" "$(traefik_log_level)"

it "because its container was replaced"
assert_ne "$TRAEFIK_BEFORE" "$(docker inspect portta-traefik-1 --format '{{.Id}}' 2>/dev/null)"

it "the applier survived the up it ran, so its exit code can be read"
assert_eq "$APPLIER" "$(portta_gateway_container apply)"
assert_eq "exited" "$(portta_container_state "$APPLIER")"

it "and a consumer container was not touched"
# ADR 0001. This is the assertion that matters most.
assert_eq "$DEMO_BEFORE" "$(docker inspect demo-a-web-1 --format '{{.Id}}' 2>/dev/null)"

describe "it is reusable, and reconciled by up"

portta_env_set PORTTA_LOG_LEVEL "$ORIGINAL_LOG_LEVEL" >/dev/null
docker start -a "$APPLIER" >/dev/null 2>&1

it "a second apply works on the same container"
assert_eq "0" "$(docker inspect "$APPLIER" --format '{{.State.ExitCode}}')"
assert_eq "$ORIGINAL_LOG_LEVEL" "$(traefik_log_level)"

it "a plain up leaves it alone"
"$GW" up local >/dev/null 2>&1
assert_eq "$APPLIER" "$(portta_gateway_container apply)"

it "turning it off removes it"
portta_env_set PORTTA_APPLY false >/dev/null
"$GW" up local >/dev/null 2>&1
assert_eq "" "$(portta_gateway_container apply)"

t_summary
