#!/usr/bin/env bash
# ============================================================================
# E2E: two databases on one host port, told apart by hostname
# ============================================================================
# The claim this suite exists to keep honest: two PostgreSQL instances, both
# listening on 5432 inside their own containers, neither publishing a host
# port, both reachable through the SAME host port, with the hostname deciding
# which one answers.
#
# One instance would prove nothing here. It would pass with the routing removed
# entirely, because there would be nothing to route wrongly. So every check
# uses two, with different data in each, and asserts which one answered.
#
# See docs/product/guides/tcp-routing.md for why PostgreSQL and Redis can do this and MySQL
# cannot.
# ============================================================================
set -uo pipefail

node "$(dirname "$0")/../lib/require-disposable.mjs" || exit 1

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/docker.sh"
. "$PORTTA_ROOT/scripts/lib/toolbox.sh"
portta_load_env; portta_defaults

GW="$PORTTA_ROOT/bin/portta"
export PORTTA_ASSUME_YES=true

portta_require_docker >/dev/null 2>&1 || { echo "Docker unavailable: E2E incomplete"; exit 1; }

# Ports well away from anything the host is likely to be using: this suite is
# about the mechanism, not about owning 5432 on somebody's machine.
PG_PORT=15432
REDIS_PORT=16379
A=tcproute-a
B=tcproute-b

# Exported for this process only. The gateway's own .env is never written, so
# nothing here outlives the suite.
export PORTTA_TCP=true
export PORTTA_TCP_POSTGRES_PORT="$PG_PORT"
export PORTTA_TCP_REDIS_PORT="$REDIS_PORT"

compose_env() {
  ( cd "$PORTTA_ROOT/docker/examples/demo-a" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.portta.yaml -f compose.portta-tcp.yaml "${@:2}" )
}

cleanup() {
  docker rm -f portta-rule-probe >/dev/null 2>&1
  compose_env "$A" down -v >/dev/null 2>&1
  compose_env "$B" down -v >/dev/null 2>&1
  # Put the gateway back the way it was found: TCP off unless .env says
  # otherwise, which is what the unexported environment gives us.
  ( unset PORTTA_TCP PORTTA_TCP_POSTGRES_PORT PORTTA_TCP_REDIS_PORT
    "$GW" up "$PORTTA_PROFILE" ) >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

# psql_at <hostname> <sslmode> [extra query args]: run a query through the
# gateway and print the single value, or the error.
psql_at() {
  docker run --rm --network host "$PORTTA_TOOLBOX_IMAGE" \
    psql "postgresql://demo:demo@$1:$PG_PORT/demo?sslmode=$2" -tAc "select name from whoami" 2>&1 | head -1
}

redis_at() {
  docker run --rm --network host "$PORTTA_TOOLBOX_IMAGE" \
    redis-cli -h 127.0.0.1 -p "$REDIS_PORT" --tls --sni "$1" --insecure get whoami 2>&1 | head -1
}

# answered_by <output> <marker>: did that database answer? A substring check
# would be wrong here, because psql prints the hostname inside its error text
# and the hostname contains the project name.
answered_by() { [ "$1" = "$2" ]; }
refused() { [ "$1" != "$2" ]; }

psql_require() { psql_at "$1" require; }

# wait_for <probe> <hostname> <expected>: Traefik learns about a container from
# Docker events, which is fast but not instant. Each protocol gets its own
# router, and they do not necessarily go live together, so waiting on the
# PostgreSQL one says nothing about Redis.
#
# Until a router matches, Traefik answers the connection over HTTP rather than
# closing it, so the failure looks like a protocol error rather than a timeout.
wait_for() {
  local probe="$1" host="$2" want="$3" attempt
  for attempt in $(seq 1 30); do
    : "$attempt"
    [ "$("$probe" "$host")" = "$want" ] && return 0
    sleep 1
  done
  return 1
}

describe "the gateway publishes one port per protocol"

"$GW" up "$PORTTA_PROFILE" >/dev/null 2>&1
traefik_ports=$(docker ps --format '{{.Names}} {{.Ports}}' | grep 'portta-traefik' || true)

it "PostgreSQL has an entrypoint"
assert_contains "$traefik_ports" ":$PG_PORT->5432"

it "Redis has one too"
assert_contains "$traefik_ports" ":$REDIS_PORT->6379"

describe "two projects, same internal ports, no published ports"

compose_env "$A" up -d --wait --wait-timeout 180 >/dev/null 2>&1
compose_env "$B" up -d --wait --wait-timeout 180 >/dev/null 2>&1
docker exec "$A-postgres-1" psql -U demo -d demo -qc \
  "create table whoami(name text); insert into whoami values ('$A');" >/dev/null 2>&1
docker exec "$B-postgres-1" psql -U demo -d demo -qc \
  "create table whoami(name text); insert into whoami values ('$B');" >/dev/null 2>&1
docker exec "$A-redis-1" redis-cli set whoami "$A" >/dev/null 2>&1
docker exec "$B-redis-1" redis-cli set whoami "$B" >/dev/null 2>&1

it "neither database publishes a host port"
assert_eq "" "$(docker ps --format '{{.Names}} {{.Ports}}' \
  | grep -E "^($A|$B)-(postgres|redis)-1 " | grep -E '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:' || true)"

container_ports() {
  docker inspect "$1" --format '{{ range $p, $v := .Config.ExposedPorts }}{{ $p }} {{ end }}' 2>/dev/null \
    | tr ' ' '\n' | sed -n 's#^\([0-9]\{1,5\}\)/tcp$#\1#p' | sort -n -u
}

it "both still listen on the standard port inside their own container"
assert_eq "5432
5432" "$(container_ports "$A-postgres-1"; container_ports "$B-postgres-1")"

it "neither joined the shared HTTP network"
assert_eq "" "$(docker inspect "$A-postgres-1" "$B-postgres-1" \
  --format '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}' \
  | tr ' ' '\n' | grep -x "$PORTTA_NETWORK" || true)"

describe "the hostname decides which database answers"

it "the first project's data comes back on its own hostname"
assert_success wait_for psql_require "$A-postgres.$PORTTA_DOMAIN" "$A"

it "and the second's on its own, through the very same port"
assert_success wait_for psql_require "$B-postgres.$PORTTA_DOMAIN" "$B"

it "they really are different databases, queried back to back"
assert_eq "$A|$B" "$(psql_at "$A-postgres.$PORTTA_DOMAIN" require)|$(psql_at "$B-postgres.$PORTTA_DOMAIN" require)"

# The Redis routers are separate from the PostgreSQL ones, so they need their
# own wait. Without it this asserts against whichever router happened to be
# live first, and fails on a loaded machine.
wait_for redis_at "$A-redis.$PORTTA_DOMAIN" "$A" || true
wait_for redis_at "$B-redis.$PORTTA_DOMAIN" "$B" || true

it "Redis does the same on its own single port"
assert_eq "$A|$B" "$(redis_at "$A-redis.$PORTTA_DOMAIN")|$(redis_at "$B-redis.$PORTTA_DOMAIN")"

describe "without TLS there is no hostname to route on"

it "sslmode=disable is refused rather than sent somewhere arbitrary"
assert_success refused "$(psql_at "$A-postgres.$PORTTA_DOMAIN" disable)" "$A"

it "and connecting by IP is too, because SNI is never sent for one"
assert_success refused "$(psql_at "127.0.0.1" require)" "$A"

it "an unknown hostname reaches nothing"
assert_success refused "$(psql_at "nobody-postgres.$PORTTA_DOMAIN" require)" "$A"

it "and gets Traefik's HTTP 404, because an unmatched TCP entrypoint falls back to HTTP"
assert_contains "$(redis_at "nobody-redis.$PORTTA_DOMAIN")" "Protocol error"

describe "routes follow the containers"

it "a restarted database is reachable again"
docker restart "$A-postgres-1" >/dev/null 2>&1
assert_success wait_for psql_require "$A-postgres.$PORTTA_DOMAIN" "$A"

it "stopping one leaves the other alone"
docker stop "$A-postgres-1" >/dev/null 2>&1
sleep 2
assert_eq "$B" "$(psql_at "$B-postgres.$PORTTA_DOMAIN" require)"

it "and the stopped one stops answering"
assert_success refused "$(psql_at "$A-postgres.$PORTTA_DOMAIN" require)" "$A"

it "starting it again brings its route back"
docker start "$A-postgres-1" >/dev/null 2>&1
assert_success wait_for psql_require "$A-postgres.$PORTTA_DOMAIN" "$A"

it "recreating it from scratch works too"
compose_env "$A" up -d --force-recreate --wait --wait-timeout 180 postgres >/dev/null 2>&1
docker exec "$A-postgres-1" psql -U demo -d demo -qc \
  "create table if not exists whoami(name text); delete from whoami; insert into whoami values ('$A');" >/dev/null 2>&1
assert_success wait_for psql_require "$A-postgres.$PORTTA_DOMAIN" "$A"

describe "restarting the gateway does not lose the routes"

"$GW" restart >/dev/null 2>&1

it "the first database answers again after Traefik restarts"
assert_success wait_for psql_require "$A-postgres.$PORTTA_DOMAIN" "$A"

it "and so does the second"
assert_success wait_for psql_require "$B-postgres.$PORTTA_DOMAIN" "$B"

describe "the label reader this feature leans on"
# Docker's inspect templates have no `hasPrefix`, so a template using it parses
# to nothing and the extraction silently returns empty. Both of these read
# labels through the shell instead, and both were wrong before TCP routing made
# it visible.

it "urls lists the HTTP services"
urls=$("$GW" urls 2>/dev/null)
assert_contains "$urls" "$A-web.$PORTTA_DOMAIN"

it "and does not list a database, which is not reached with a browser"
assert_not_contains "$urls" "$A-postgres.$PORTTA_DOMAIN"

it "an explicit Host() label wins over the derived hostname"
docker run -d --rm --name portta-rule-probe --network "$PORTTA_NETWORK" \
  --label traefik.enable=true \
  --label 'traefik.http.routers.probe.rule=Host(`explicit-name.test`)' \
  --label traefik.http.services.probe.loadbalancer.server.port=9999 \
  --label com.docker.compose.project=ruleprobe \
  --label com.docker.compose.service=web \
  traefik/whoami:v1.12.0 >/dev/null 2>&1
sleep 2
assert_contains "$("$GW" urls 2>/dev/null)" "explicit-name.test"

it "and the backend port label is read too"
assert_contains "$("$GW" urls --json 2>/dev/null)" '"port": "9999"'
docker rm -f portta-rule-probe >/dev/null 2>&1

describe "the CLI and the registry agree with what just happened"

# The registry is one table, in packages/core/src/discovery.ts. Reading it here
# rather than restating it is the point: the hostname two live databases just
# answered on has to be the hostname the product derives.
core() {
  node --input-type=module -e "
    import * as core from '$PORTTA_ROOT/packages/core/src/index.ts'
    process.stdout.write(String($1))
  " 2>/dev/null
}

it "the hostname the CLI derives is the one that worked"
assert_eq "$A-postgres.$PORTTA_DOMAIN" "$(core "core.tcpHostname('$A', 'postgres', '$PORTTA_DOMAIN')")"

it "PostgreSQL is registered as routable"
assert_eq "starttls-sni" "$(core "core.tcpRouting('postgres')")"

it "MySQL is registered as not routable, and nothing pretends otherwise"
assert_eq "unsupported" "$(core "core.tcpRouting('mysql')")"

it "a protocol nobody verified is not claimed to work"
assert_eq "unevaluated" "$(core "core.tcpRouting('mongodb')")"

t_summary
