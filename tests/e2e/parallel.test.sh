#!/usr/bin/env bash
# ============================================================================
# E2E — several environments at once, on the same internal ports
# ============================================================================
# The gateway's central claim, tested end to end:
#
#   demo-a, demo-b, demo-a-issue-1 and demo-a-issue-2 all run
#   web:3000, api:8000, postgres:5432 and redis:6379 simultaneously,
#   with no host port published by any of them.
#
# Requires Docker and a running gateway. Creates only its own fixtures and
# removes only what it created.
# ============================================================================
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
. "$DG_ROOT/scripts/lib/common.sh"
. "$DG_ROOT/scripts/lib/docker.sh"
dg_load_env; dg_defaults

ENVS="demo-a demo-a-issue-1 demo-a-issue-2"
GW="$DG_ROOT/bin/dev-gateway"

up_env() { # up_env <namespace> <example-dir>
  ( cd "$DG_ROOT/examples/$2" \
    && COMPOSE_PROJECT_NAME="$1" docker compose \
         -f compose.yaml -f compose.dev-gateway.yaml up -d --wait --wait-timeout 120 ) >/dev/null 2>&1
}

down_env() {
  ( cd "$DG_ROOT/examples/$2" \
    && COMPOSE_PROJECT_NAME="$1" docker compose \
         -f compose.yaml -f compose.dev-gateway.yaml down -v ) >/dev/null 2>&1
}

# http_code <url> — resolves the hostname to the gateway's bind address
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

cleanup() {
  for ns in $ENVS; do down_env "$ns" demo-a; done
  down_env demo-b demo-b
}

dg_require_docker >/dev/null 2>&1 || { echo "docker unavailable — skipping"; exit 0; }

describe "setting up four independent environments"
trap cleanup EXIT INT TERM
"$GW" up local >/dev/null 2>&1
for ns in $ENVS; do
  it "brings up $ns"; if up_env "$ns" demo-a; then _t_pass; else _t_fail "compose up failed for $ns"; fi
done
it "brings up demo-b"; if up_env demo-b demo-b; then _t_pass; else _t_fail "compose up failed for demo-b"; fi

# Traefik discovers through the Docker event stream; give it a moment.
sleep 5

describe "every web and api is routed under its own hostname"
for ns in $ENVS demo-b; do
  it "$ns web answers"; assert_eq "200" "$(http_code "http://${ns}-web.localhost/")"
  it "$ns api answers"; assert_eq "200" "$(http_code "http://${ns}-api.localhost/")"
done

describe "*.localhost resolves to loopback (RFC 6761)"
it "the resolver maps a localhost subdomain to loopback"
if resolved=$(getent hosts demo-a-web.localhost 2>/dev/null || ping -c1 -W1 demo-a-web.localhost 2>/dev/null); then
  assert_contains "$resolved" "127.0.0.1"
else
  skip "this resolver does not implement RFC 6761 for localhost subdomains"
fi

describe "no environment publishes a host port"
published=$(docker ps --format '{{.Names}} {{.Ports}}' \
  | grep -E "^(demo-a|demo-b)" | grep -E '0\.0\.0\.0|127\.0\.0\.1' || true)
it "web, api, postgres and redis are all unpublished"; assert_eq "" "$published"

describe "internal ports were not renamed to dodge collisions"
for ns in $ENVS demo-b; do
  it "$ns postgres still listens on 5432"
  assert_contains "$(docker exec "${ns}-postgres-1" psql -U demo -d demo -tAc "show port" 2>&1)" "5432"
  it "$ns redis still answers on 6379"
  assert_contains "$(docker exec "${ns}-redis-1" redis-cli -p 6379 ping 2>&1)" "PONG"
done

describe "each environment owns its own state"
it "one private network per namespace"
assert_eq "4" "$(docker network ls --format '{{.Name}}' | grep -cE '^(demo-a|demo-a-issue-1|demo-a-issue-2|demo-b)_default$')"
it "one postgres volume per namespace"
assert_eq "4" "$(docker volume ls --format '{{.Name}}' | grep -cE '^(demo-a|demo-a-issue-1|demo-a-issue-2|demo-b)_pgdata$')"

describe "databases stay unreachable across projects"
it "demo-b cannot reach demo-a's postgres"
assert_failure docker run --rm --network demo-b_default alpine:3.24.1 \
  nc -z -w2 demo-a-postgres-1 5432
it "demo-b can reach its own postgres"
assert_success docker run --rm --network demo-b_default alpine:3.24.1 \
  nc -z -w2 postgres 5432

describe "no datastore joined the shared HTTP network"
shared=$(docker network inspect "$DEV_GATEWAY_NETWORK" \
  --format '{{ range .Containers }}{{ .Name }} {{ end }}' 2>/dev/null)
it "no postgres on the gateway network"; assert_not_contains "$shared" "postgres"
it "no redis on the gateway network";    assert_not_contains "$shared" "redis"

describe "nothing is routed without opting in"
# A container on the shared network with no traefik.enable=true must stay
# invisible: exposedByDefault=false is the difference between a gateway and an
# accident.
docker run -d --rm --name dg-optin-probe --network "$DEV_GATEWAY_NETWORK" \
  --label com.docker.compose.project=optin-probe \
  --label com.docker.compose.service=web \
  traefik/whoami:v1.12.0 --port 3000 >/dev/null 2>&1
sleep 3
it "a container without traefik.enable is not routed"
assert_ne "200" "$(http_code "http://optin-probe-web.$DEV_GATEWAY_DOMAIN/")"
it "and urls does not list it"
assert_not_contains "$("$GW" urls 2>/dev/null)" "optin-probe"
docker stop dg-optin-probe >/dev/null 2>&1

describe "the gateway reports what it is serving"
urls=$("$GW" urls 2>/dev/null)
for ns in $ENVS demo-b; do
  it "urls lists ${ns}-web"; assert_contains "$urls" "${ns}-web.localhost"
done
it "urls emits valid JSON"; assert_success sh -c "\"$GW\" urls --json | python3 -m json.tool >/dev/null"

describe "doctor is happy with four parallel environments"
it "doctor passes"; assert_success "$GW" doctor

t_summary
