#!/usr/bin/env bash
# ============================================================================
# E2E: lifecycle independence
# ============================================================================
# The gateway is shared infrastructure, so its lifecycle must not be entangled
# with any project's. Restarting or stopping it leaves applications running;
# starting it again rediscovers them.
# ============================================================================
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
. "$DG_ROOT/scripts/lib/common.sh"
. "$DG_ROOT/scripts/lib/docker.sh"
dg_load_env; dg_defaults

GW="$DG_ROOT/bin/dev-gateway"

up_demo() {
  ( cd "$DG_ROOT/docker/examples/$1" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.dev-gateway.yaml up -d --wait --wait-timeout 120 ) >/dev/null 2>&1
}
down_demo() {
  ( cd "$DG_ROOT/docker/examples/$1" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.dev-gateway.yaml down -v ) >/dev/null 2>&1
}
# http_code <url>: resolves the hostname to the gateway's bind address
# explicitly. Routing and name resolution are separate concerns: `doctor`
# checks that *.localhost resolves, and these suites check that Traefik routes,
# so they keep working on hosts and CI runners whose resolver does not
# implement RFC 6761 for localhost subdomains.
http_code() {
  local url="$1" host
  host=$(printf '%s' "$url" | sed -e 's#^https\{0,1\}://##' -e 's#[:/].*$##')
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "${host}:${DEV_GATEWAY_HTTP_PORT}:${DEV_GATEWAY_BIND_ADDRESS}" "$url"
}

# wait_for_route <url> <expected>: Traefik rediscovers asynchronously.
wait_for_route() {
  local i=0
  while [ "$i" -lt 30 ]; do
    [ "$(http_code "$1")" = "$2" ] && return 0
    i=$((i + 1)); sleep 1
  done
  return 1
}

# wait_for_health <container>: a freshly started container reports
# `starting` until its healthcheck has had a chance to run at least once.
wait_for_health() {
  local i=0
  while [ "$i" -lt 40 ]; do
    [ "$(dg_container_health "$1")" = "healthy" ] && return 0
    i=$((i + 1)); sleep 1
  done
  return 1
}

cleanup() { down_demo demo-a; down_demo demo-b; "$GW" up local >/dev/null 2>&1; }

dg_require_docker >/dev/null 2>&1 || { echo "docker unavailable, skipping"; exit 0; }

trap cleanup EXIT INT TERM
"$GW" up local >/dev/null 2>&1
up_demo demo-a
up_demo demo-b
sleep 4

describe "baseline"
it "demo-a is routed"; assert_eq "200" "$(http_code http://demo-a-web.localhost/)"

describe "restarting the gateway"
"$GW" restart >/dev/null 2>&1
it "the application container was not restarted"
assert_eq "running" "$(dg_container_state demo-a-web-1)"
it "routes come back on their own"; assert_success wait_for_route http://demo-a-web.localhost/ 200

describe "stopping the gateway"
"$GW" down >/dev/null 2>&1
it "applications keep running"; assert_eq "running" "$(dg_container_state demo-a-web-1)"
it "the private network survives"; assert_success dg_network_exists demo-a_default
it "the shared network is NOT removed"; assert_success dg_network_exists "$DEV_GATEWAY_NETWORK"
it "consumer volumes survive"
assert_success sh -c "docker volume ls --format '{{.Name}}' | grep -q '^demo-a_pgdata$'"

describe "starting the gateway again"
"$GW" up local >/dev/null 2>&1
it "existing applications are rediscovered"; assert_success wait_for_route http://demo-a-web.localhost/ 200
it "so is the second project"; assert_success wait_for_route http://demo-b-web.localhost/ 200

describe "stopping one project does not disturb the other"
down_demo demo-a
it "demo-b is still served"; assert_eq "200" "$(http_code http://demo-b-web.localhost/)"
it "the gateway is still healthy"; assert_success wait_for_health "$(dg_gateway_container traefik)"
it "demo-a's route is gone"; assert_ne "200" "$(http_code http://demo-a-web.localhost/)"

t_summary
