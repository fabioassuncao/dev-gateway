#!/usr/bin/env bash
# ============================================================================
# E2E: the web panel against a real Docker host
# ============================================================================
# The panel's own suites cover its logic against a fake Docker API. This one
# checks the part only a real host can prove: that it comes up through the CLI,
# classifies a real project correctly, tells gateway containers from external
# ones, creates a bridge the CLI then manages, and never publishes its socket
# proxy.
# ============================================================================
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
. "$DG_ROOT/scripts/lib/common.sh"
. "$DG_ROOT/scripts/lib/docker.sh"
dg_load_env; dg_defaults

GW="$DG_ROOT/bin/dev-gateway"
export DG_ASSUME_YES=true

dg_require_docker >/dev/null 2>&1 || { echo "docker unavailable, skipping"; exit 0; }

BASE="http://127.0.0.1:${DEV_GATEWAY_WEB_PORT:-8081}"
WEB_WAS_ENABLED="$DEV_GATEWAY_WEB"
STRAY="dg-web-e2e-stray"

cleanup() {
  [ -z "$DB_CONTAINER" ] || docker start "$DB_CONTAINER" >/dev/null 2>&1
  [ -z "$DB_CONTAINER" ] || docker exec "$DB_CONTAINER" psql -U devgateway -d devgateway \
    -c "DELETE FROM integrations WHERE kind = 'web-e2e-persistence';" >/dev/null 2>&1
  curl -s -X DELETE "$BASE/api/access/$BRIDGE_ID" >/dev/null 2>&1
  "$GW" access close --all >/dev/null 2>&1
  docker rm -f "$STRAY" >/dev/null 2>&1
  ( cd "$DG_ROOT/docker/examples/demo-a" && docker compose \
      -f compose.yaml -f compose.dev-gateway.yaml down -v ) >/dev/null 2>&1
  dg_is_true "$WEB_WAS_ENABLED" || "$GW" web disable >/dev/null 2>&1
}
BRIDGE_ID=""
DB_CONTAINER=""
trap cleanup EXIT INT TERM

# get <path>: the panel's JSON, or nothing.
get() { curl -fsS -m 10 "$BASE$1" 2>/dev/null; }

# jq_py <expression>: read stdin as JSON and print one value, with no jq
# dependency (the host only needs Docker, Git and a shell).
jq_py() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

describe "the panel starts through the CLI"

( cd "$DG_ROOT/docker/examples/demo-a" && docker compose \
    -f compose.yaml -f compose.dev-gateway.yaml up -d --wait --wait-timeout 180 ) >/dev/null 2>&1

# A container that belongs to nobody: exactly what the Docker page exists for.
docker run -d --name "$STRAY" --label dg.e2e=true alpine:3.24.1 sleep 600 >/dev/null 2>&1

"$GW" web up >/dev/null 2>&1

it "answers as soon as 'web up' returns"
# Regression: `web up` used to report success the moment Compose created the
# container, so the URL it printed was dead for the first few seconds and every
# caller had to guess how long to sleep. It now waits for the healthcheck.
assert_success get /api/health

it "reports the gateway version it is running beside"
assert_eq "$(dg_version)" "$(get /api/health | jq_py "d['gatewayVersion']")"

describe "its PostgreSQL is private, migratable and optional at runtime"

DB_CONTAINER=$(dg_gateway_container db)

it "the database starts healthy"
assert_eq "healthy" "$(dg_container_health "$DB_CONTAINER")"

it "it publishes no host port"
assert_eq "" "$(docker inspect "$DB_CONTAINER" \
  --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)"

it "its only network is the internal data network"
assert_eq "$DEV_GATEWAY_DB_NETWORK" "$(docker inspect "$DB_CONTAINER" \
  --format '{{ range $name, $_ := .NetworkSettings.Networks }}{{ println $name }}{{ end }}' 2>/dev/null \
  | tr -d '[:space:]')"

it "the data network has no external route"
assert_eq "true" "$(docker network inspect "$DEV_GATEWAY_DB_NETWORK" --format '{{ .Internal }}')"

it "the initial migration is recorded"
assert_eq "0001_initial.sql" "$(docker exec "$DB_CONTAINER" psql -U devgateway -d devgateway \
  -At -c 'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')"

docker stop "$DB_CONTAINER" >/dev/null
sleep 2

it "health remains available while PostgreSQL is down"
assert_success get /api/health

it "Docker-backed project discovery remains available too"
assert_contains "$(get /api/projects)" '"projects"'

it "the degraded database is an explicit warning"
db_status=""
for _ in $(seq 1 10); do
  db_status=$(get /api/status)
  case "$db_status" in *'"id":"database","status":"warn"'*) break ;; esac
  sleep 1
done
assert_contains "$db_status" '"id":"database","status":"warn"'

docker start "$DB_CONTAINER" >/dev/null
for _ in $(seq 1 30); do
  [ "$(dg_container_health "$DB_CONTAINER")" = "healthy" ] && break
  sleep 1
done

docker exec "$DB_CONTAINER" psql -U devgateway -d devgateway -v ON_ERROR_STOP=1 \
  -c "DELETE FROM integrations WHERE kind = 'web-e2e-persistence';
      INSERT INTO integrations (kind, config) VALUES ('web-e2e-persistence', '{}');" >/dev/null

describe "it describes the host the way the CLI does"

status=$(get /api/status)

it "sees the gateway as up"
assert_eq "True" "$(printf '%s' "$status" | jq_py "d['gateway']['up']")"

it "agrees with the CLI about the profile"
assert_eq "$DEV_GATEWAY_PROFILE" "$(printf '%s' "$status" | jq_py "d['gateway']['profile']")"

it "counts the same routes as dev-gateway urls"
assert_eq "$("$GW" urls --json 2>/dev/null | jq_py "len(d['routes'])")" \
  "$(printf '%s' "$status" | jq_py "d['counts']['routes']")"

it "lists demo-a as an integrated project"
assert_contains "$(get /api/projects | jq_py "[p['name'] for p in d['projects']]")" "demo-a"

it "groups the project's database under it, though it never joined the gateway"
assert_contains \
  "$(get /api/projects/demo-a | jq_py "[s['service'] for s in d['services']]")" "postgres"

it "shows the URL Traefik actually serves"
assert_contains "$(get /api/projects/demo-a | jq_py "[u['host'] for u in d['urls']]")" \
  "demo-a-web.$DEV_GATEWAY_DOMAIN"

describe "it tells the gateway's containers from everybody else's"

containers=$(get /api/docker/containers)
owner_of() {
  printf '%s' "$containers" | python3 -c "
import json,sys
for c in json.load(sys.stdin)['containers']:
    if c['name'] == '$1': print(c['ownership']); break"
}

it "the gateway's own containers are marked as its own"
assert_eq "gateway" "$(owner_of dev-gateway-traefik-1)"

it "the panel itself is gateway-owned too"
assert_eq "gateway" "$(owner_of dev-gateway-web-1)"

it "an adopted project's service is integrated"
assert_eq "integrated" "$(owner_of demo-a-web-1)"

it "a container started by hand is standalone"
assert_eq "standalone" "$(owner_of "$STRAY")"

describe "it refuses what it must refuse"

it "will not stop a gateway component"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST \
  "$BASE/api/docker/containers/dev-gateway-traefik-1/stop")
assert_eq "403" "$code"

it "and the component is still running"
assert_eq "running" "$(dg_container_state dev-gateway-traefik-1)"

it "will not remove a container without an explicit confirmation"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X DELETE \
  -H 'content-type: application/json' -d '{}' \
  "$BASE/api/docker/containers/$STRAY")
assert_eq "400" "$code"

it "and the container is still there"
assert_eq "running" "$(dg_container_state "$STRAY")"

it "refuses a write from another origin"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST \
  -H 'Origin: https://evil.example' \
  "$BASE/api/docker/containers/$STRAY/restart")
assert_eq "403" "$code"

it "never returns an endpoint it does not have"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$BASE/api/containers/prune")
assert_eq "404" "$code"

describe "a bridge opened in the panel is a bridge the CLI manages"

BRIDGE_ID=$(curl -fsS -m 30 -X POST -H 'content-type: application/json' \
  -d '{"project":"demo-a","service":"postgres"}' "$BASE/api/access" 2>/dev/null \
  | jq_py "d['bridge']['id']" 2>/dev/null)

it "the panel opened one"
assert_not_contains "x$BRIDGE_ID" "xNone"

it "dev-gateway access list sees it"
assert_contains "$("$GW" access list --json 2>/dev/null)" "\"id\": \"$BRIDGE_ID\""

it "it binds loopback, like every other bridge"
assert_not_contains "$(docker ps --format '{{.Names}} {{.Ports}}' | grep '^dg-access-')" "0.0.0.0"

it "closing it in the panel removes the container"
curl -fsS -m 10 -X DELETE "$BASE/api/access/$BRIDGE_ID" >/dev/null 2>&1
sleep 1
assert_eq "" "$(docker ps -q --filter "label=dev-gateway.access.id=$BRIDGE_ID")"
BRIDGE_ID=""

it "and the database it bridged to is untouched"
assert_eq "running" "$(dg_container_state demo-a-postgres-1)"

describe "the panel's socket proxy is unreachable"

it "it publishes no host port"
assert_eq "" "$(docker inspect dev-gateway-web-socket-proxy-1 \
  --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)"

it "its network is internal"
assert_eq "true" "$(docker network inspect "${DEV_GATEWAY_WEB_NETWORK:-dev-gateway-web}" \
  --format '{{ .Internal }}' 2>/dev/null)"

it "and doctor agrees"
assert_success "$GW" doctor

describe "stopping the panel leaves everything else alone"

"$GW" web down >/dev/null 2>&1
sleep 1

it "the panel is gone"
assert_eq "" "$(docker ps -q --filter 'label=dev-gateway.component=web')"

it "Traefik is still running"
assert_eq "running" "$(dg_container_state dev-gateway-traefik-1)"

it "so is the project"
assert_eq "running" "$(dg_container_state demo-a-web-1)"

describe "the named volume survives a complete panel down/up"

"$GW" web up >/dev/null 2>&1
DB_CONTAINER=$(dg_gateway_container db)

it "the persisted marker comes back"
assert_eq "1" "$(docker exec "$DB_CONTAINER" psql -U devgateway -d devgateway -At \
  -c "SELECT count(*) FROM integrations WHERE kind = 'web-e2e-persistence'")"

it "the migration is still recorded exactly once"
assert_eq "1" "$(docker exec "$DB_CONTAINER" psql -U devgateway -d devgateway -At \
  -c "SELECT count(*) FROM schema_migrations WHERE version = '0001_initial.sql'")"

docker exec "$DB_CONTAINER" psql -U devgateway -d devgateway \
  -c "DELETE FROM integrations WHERE kind = 'web-e2e-persistence';" >/dev/null

t_summary
