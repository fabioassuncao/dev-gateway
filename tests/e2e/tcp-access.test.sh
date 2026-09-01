#!/usr/bin/env bash
# ============================================================================
# E2E: reaching four databases that all listen on 5432
# ============================================================================
# The step-04 acceptance test. Four environments run Postgres on 5432 and Redis
# on 6379 at the same time. None publishes a host port. Every one of them is
# reachable from the host, at the same time, on its own loopback port: and a
# real query proves each bridge reaches a genuinely different database.
# ============================================================================
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
. "$DG_ROOT/scripts/lib/common.sh"
. "$DG_ROOT/scripts/lib/docker.sh"
. "$DG_ROOT/scripts/lib/toolbox.sh"
. "$DG_ROOT/scripts/lib/discovery.sh"
dg_load_env; dg_defaults

GW="$DG_ROOT/bin/dev-gateway"
ENVS="demo-a demo-a-issue-1 demo-a-issue-2 demo-b"
export DG_ASSUME_YES=true

dg_require_docker >/dev/null 2>&1 || { echo "docker unavailable, skipping"; exit 0; }

up_env() {
  local dir="demo-a"; [ "$1" = "demo-b" ] && dir="demo-b"
  ( cd "$DG_ROOT/docker/examples/$dir" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.dev-gateway.yaml up -d --wait --wait-timeout 180 ) >/dev/null 2>&1
}
down_env() {
  local dir="demo-a"; [ "$1" = "demo-b" ] && dir="demo-b"
  ( cd "$DG_ROOT/docker/examples/$dir" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.dev-gateway.yaml down -v ) >/dev/null 2>&1
}

cleanup() {
  "$GW" access close --all >/dev/null 2>&1
  "$GW" service unpublish --project demo-a >/dev/null 2>&1
  "$GW" service unpublish --project demo-b >/dev/null 2>&1
  for ns in $ENVS; do down_env "$ns"; done
}
trap cleanup EXIT INT TERM

# port_of <project> <service>: the loopback port of an open bridge.
port_of() {
  "$GW" access list --json 2>/dev/null | python3 -c "
import json,sys
for b in json.load(sys.stdin)['bridges']:
    if b['project']=='$1' and b['service']=='$2':
        print(b['local_port']); break"
}

# pg <port> <sql>: a real query through the bridge, from a container using
# host networking, so the path is exactly the one a GUI client would take.
pg() {
  docker run --rm --network host -e PGPASSWORD=demo "$DG_TOOLBOX_IMAGE" \
    psql "postgresql://demo@127.0.0.1:$1/demo" -tAc "$2" 2>&1 | tr -d ' \n'
}

"$GW" up local >/dev/null 2>&1
dg_toolbox_ensure >/dev/null 2>&1

describe "four environments, all on the standard ports"
for ns in $ENVS; do
  it "$ns starts"; if up_env "$ns"; then _t_pass; else _t_fail "compose up failed"; fi
done
it "none publishes a host port"
assert_eq "" "$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E '^(demo-a|demo-b)' | grep -E '0\.0\.0\.0|127\.0\.0\.1' || true)"

describe "opening a bridge per database"
for ns in $ENVS; do
  it "$ns postgres"; assert_success "$GW" access open --project "$ns" --service postgres --quiet
  it "$ns redis";    assert_success "$GW" access open --project "$ns" --service redis --quiet
done

it "eight bridges are open"
assert_eq "8" "$("$GW" access list --json | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["bridges"]))')"

it "every bridge got a different local port"
ports=$("$GW" access list --json | python3 -c 'import json,sys; print(" ".join(sorted(b["local_port"] for b in json.load(sys.stdin)["bridges"])))')
assert_eq "8" "$(printf '%s' "$ports" | tr ' ' '\n' | sort -u | grep -c .)"

it "every bridge binds loopback only"
assert_eq "" "$(docker ps --format '{{.Names}} {{.Ports}}' | grep '^dg-access-' | grep -E '0\.0\.0\.0' || true)"

describe "each bridge reaches a different database"
for ns in $ENVS; do
  p=$(port_of "$ns" postgres)
  it "$ns accepts a real query on 127.0.0.1:$p"
  assert_contains "$(pg "$p" "select 'ok'")" "ok"
  # Stamp each database with its own name, then read it back, so a
  # misdirected bridge cannot pass by accident.
  pg "$p" "create table if not exists whoami(id text); delete from whoami; insert into whoami values('$ns')" >/dev/null
done
for ns in $ENVS; do
  p=$(port_of "$ns" postgres)
  it "$ns's bridge still reaches $ns's own database"
  assert_eq "$ns" "$(pg "$p" 'select id from whoami')"
done

describe "the same for Redis"
for ns in $ENVS; do
  p=$(port_of "$ns" redis)
  docker run --rm --network host "$DG_TOOLBOX_IMAGE" redis-cli -h 127.0.0.1 -p "$p" set owner "$ns" >/dev/null 2>&1
done
for ns in $ENVS; do
  p=$(port_of "$ns" redis)
  it "$ns's Redis bridge reaches $ns's own instance"
  assert_contains "$(docker run --rm --network host "$DG_TOOLBOX_IMAGE" redis-cli -h 127.0.0.1 -p "$p" get owner 2>&1)" "$ns"
done

describe "closing one bridge does not disturb the others"
"$GW" access close --project demo-a >/dev/null 2>&1
it "demo-a's bridges are gone"
assert_eq "0" "$("$GW" access list --json | python3 -c 'import json,sys; print(sum(1 for b in json.load(sys.stdin)["bridges"] if b["project"]=="demo-a"))')"
it "demo-b's bridge still works"
assert_eq "demo-b" "$(pg "$(port_of demo-b postgres)" 'select id from whoami')"
it "and demo-a's database is still running"
assert_eq "running" "$(dg_container_state demo-a-postgres-1)"

describe "clients that publish nothing at all"
it "db psql runs inside the project's network"
assert_contains "$("$GW" db psql --project demo-b -- -tAc 'select id from whoami' 2>&1)" "demo-b"
it "redis cli too"
assert_contains "$("$GW" redis cli --project demo-b -- get owner 2>&1)" "demo-b"
it "no client container is left behind"
assert_eq "" "$(docker ps -aq --filter "ancestor=$DG_TOOLBOX_IMAGE" 2>/dev/null || true)"

describe "garbage collection only touches what the gateway owns"
down_env demo-a-issue-1
sleep 1
it "gc removes the bridge whose target is gone"
assert_success "$GW" access gc
it "it is really gone"
assert_eq "0" "$("$GW" access list --json | python3 -c 'import json,sys; print(sum(1 for b in json.load(sys.stdin)["bridges"] if b["project"]=="demo-a-issue-1"))')"
it "other projects were untouched"
assert_eq "running" "$(dg_container_state demo-b-postgres-1)"
it "and so were their bridges"
assert_ne "0" "$("$GW" access list --json | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["bridges"]))')"

describe "persistent private publishing"
it "publishes demo-b's postgres"
assert_success "$GW" service publish --private --project demo-b --service postgres
it "the forwarder joins the project network and the access network"
assert_eq "demo-b_default dev-gateway-access" \
  "$(docker inspect dg-forward-demo-b-postgres --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ $//')"
it "it is NOT on the shared HTTP network"
assert_not_contains "$(docker inspect dg-forward-demo-b-postgres --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')" "$DEV_GATEWAY_NETWORK "
it "it is reachable by alias on the standard port"
assert_contains "$(docker run --rm --network "$DEV_GATEWAY_ACCESS_NETWORK" -e PGPASSWORD=demo "$DG_TOOLBOX_IMAGE" \
  psql "postgresql://demo@demo-b-postgres:5432/demo" -tAc 'select id from whoami' 2>&1)" "demo-b"
it "but project networks are still not merged"
assert_failure docker run --rm --network "$DEV_GATEWAY_ACCESS_NETWORK" "$DG_TOOLBOX_IMAGE" \
  nc -z -w2 postgres 5432
it "publishing a database publicly is refused"
assert_failure "$GW" service publish --public --project demo-b --service postgres

describe "doctor agrees"
it "doctor passes with bridges and forwarders open"; assert_success "$GW" doctor

t_summary
