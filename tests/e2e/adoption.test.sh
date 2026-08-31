#!/usr/bin/env bash
# ============================================================================
# E2E — adopting an unknown project
# ============================================================================
# The acceptance test for the whole adoption story: build a project the gateway
# has never seen, one that looks like the awkward real thing — a built image, a
# worker sharing that image, a database, and host ports that collide with
# what is already running — then adapt it using only `analyze` and `init`.
#
# It proves three things:
#   1. the analyzer sees the real problems;
#   2. the generated overlay works unmodified;
#   3. the same project runs twice in parallel afterwards.
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

dg_require_docker >/dev/null 2>&1 || { echo "docker unavailable — skipping"; exit 0; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/dg-adopt.XXXXXX")
PROJ="$WORK/legacy-shop"

cleanup() {
  for ns in legacy-shop legacy-shop-issue7; do
    ( cd "$PROJ" 2>/dev/null && COMPOSE_PROJECT_NAME="$ns" docker compose \
        -f compose.yaml -f compose.dev-gateway.yaml down -v ) >/dev/null 2>&1
    ( cd "$PROJ" 2>/dev/null && COMPOSE_PROJECT_NAME="$ns" docker compose \
        -f compose.yaml down -v ) >/dev/null 2>&1
  done
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

http_code() {
  local url="$1" host
  host=$(printf '%s' "$url" | sed -e 's#^https\{0,1\}://##' -e 's#[:/].*$##')
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "${host}:${DEV_GATEWAY_HTTP_PORT}:${DEV_GATEWAY_BIND_ADDRESS}" "$url"
}

# ---------------------------------------------------------------------------
# A project the gateway has never seen
# ---------------------------------------------------------------------------
mkdir -p "$PROJ"
cat > "$PROJ/Dockerfile" <<'DOCKER'
FROM traefik/whoami:v1.12.0
DOCKER

cat > "$PROJ/compose.yaml" <<'YAML'
# Deliberately awkward: a built image (so the analyzer cannot classify by image
# name), a worker sharing it, a fixed container name, and host ports on 80 and
# 5432 that a second copy could never bind.
services:
  storefront:
    build: .
    command: ["--port", "3000", "--name", "legacy-storefront"]
    container_name: legacy-shop-storefront
    ports:
      - "80:3000"

  worker:
    build: .
    command: ["--port", "3000", "--name", "legacy-worker"]

  db:
    image: postgres:18.6-alpine
    environment:
      POSTGRES_USER: shop
      POSTGRES_PASSWORD: shop
      POSTGRES_DB: shop
    ports:
      - "5432:5432"
    volumes:
      - dbdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shop -d shop"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  dbdata:
YAML

"$GW" up local >/dev/null 2>&1

describe "the analyzer sees the real problems"
report=$("$GW" analyze "$PROJ" 2>&1)
it "reports the published host ports";     assert_contains "$report" "Published host ports"
it "flags port 80, already held";          assert_contains "$report" "already held"
it "flags the fixed container name";       assert_contains "$report" "Fixed container names"
it "flags the published database";         assert_contains "$report" "Datastores published on the host"
it "flags the implicit namespace";         assert_contains "$report" "Namespace is implicit"
it "classifies the built storefront as HTTP even with no image name"
assert_contains "$report" "storefront"
it "does not propose routing the worker"
assert_not_contains "$(printf '%s' "$report" | sed -n '/Adoption plan/,$p')" "worker "
it "does not propose routing the database"
assert_not_contains "$(printf '%s' "$report" | sed -n '/Adoption plan/,$p')" "db "

it "emits valid JSON"
assert_success sh -c "\"$GW\" analyze '$PROJ' --json | python3 -m json.tool >/dev/null"

json=$("$GW" analyze "$PROJ" --json 2>/dev/null)
it "JSON marks the project as not yet adopted"
assert_eq "false" "$(printf '%s' "$json" | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["findings"]["already_adopted"]).lower())')"
it "JSON lists the fixed container name"
assert_eq "storefront" "$(printf '%s' "$json" | python3 -c 'import json,sys; print(",".join(json.load(sys.stdin)["findings"]["fixed_container_names"]))')"

describe "analyze changed nothing"
it "no overlay was created"; assert_failure test -f "$PROJ/compose.dev-gateway.yaml"
it "compose.yaml is untouched"
assert_contains "$(cat "$PROJ/compose.yaml")" "container_name: legacy-shop-storefront"

describe "init generates a working overlay"
it "dry-run writes nothing"
"$GW" init "$PROJ" --dry-run >/dev/null 2>&1
assert_failure test -f "$PROJ/compose.dev-gateway.yaml"

it "init writes the overlay"
assert_success "$GW" init "$PROJ" --service storefront:3000
it "the overlay exists"; assert_success test -f "$PROJ/compose.dev-gateway.yaml"
it "it uses list-form labels"
assert_contains "$(cat "$PROJ/compose.dev-gateway.yaml")" '- "traefik.enable=true"'
it "it namespaces the Traefik service"
assert_contains "$(cat "$PROJ/compose.dev-gateway.yaml")" 'services.${COMPOSE_PROJECT_NAME'
it "it does not attach the database"
assert_not_contains "$(cat "$PROJ/compose.dev-gateway.yaml")" $'\n  db:'
it "compose.yaml is still untouched"
assert_contains "$(cat "$PROJ/compose.yaml")" "container_name: legacy-shop-storefront"

describe "the adopted project runs"
# The fixed container name and the host ports are the project's to fix; the
# gateway only reported them. Do here what a developer would do next.
sed -i.bak -e '/container_name:/d' -e '/^      - "80:3000"$/d' -e '/^      - "5432:5432"$/d' \
  -e '/^    ports:$/d' "$PROJ/compose.yaml"
rm -f "$PROJ/compose.yaml.bak"

( cd "$PROJ" && docker compose -f compose.yaml -f compose.dev-gateway.yaml \
    up -d --wait --wait-timeout 180 ) >/dev/null 2>&1
sleep 5

it "the storefront is routed"
assert_eq "200" "$(http_code "http://legacy-shop-storefront.$DEV_GATEWAY_DOMAIN/")"
it "it is the right application"
assert_contains "$(curl -s --max-time 10 \
  --resolve "legacy-shop-storefront.$DEV_GATEWAY_DOMAIN:${DEV_GATEWAY_HTTP_PORT}:${DEV_GATEWAY_BIND_ADDRESS}" \
  "http://legacy-shop-storefront.$DEV_GATEWAY_DOMAIN/")" "legacy-storefront"
it "the worker is not routed"
assert_ne "200" "$(http_code "http://legacy-shop-worker.$DEV_GATEWAY_DOMAIN/")"
it "the database is not routed"
assert_ne "200" "$(http_code "http://legacy-shop-db.$DEV_GATEWAY_DOMAIN/")"
it "nothing is published on the host"
assert_eq "" "$(docker ps --format '{{.Names}} {{.Ports}}' | grep '^legacy-shop' | grep -E '0\.0\.0\.0|127\.0\.0\.1' || true)"

describe "and it runs twice, in parallel"
( cd "$PROJ" && COMPOSE_PROJECT_NAME=legacy-shop-issue7 docker compose \
    -f compose.yaml -f compose.dev-gateway.yaml up -d --wait --wait-timeout 180 ) >/dev/null 2>&1
sleep 5

it "the second environment is routed"
assert_eq "200" "$(http_code "http://legacy-shop-issue7-storefront.$DEV_GATEWAY_DOMAIN/")"
it "the first is still routed"
assert_eq "200" "$(http_code "http://legacy-shop-storefront.$DEV_GATEWAY_DOMAIN/")"
it "they have separate databases"
assert_eq "2" "$(docker volume ls --format '{{.Name}}' | grep -cE '^legacy-shop(-issue7)?_dbdata$')"
it "and separate private networks"
assert_eq "2" "$(docker network ls --format '{{.Name}}' | grep -cE '^legacy-shop(-issue7)?_default$')"

describe "doctor stays clean throughout"
it "no collisions were introduced"; assert_success "$GW" doctor

t_summary
