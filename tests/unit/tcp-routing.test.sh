#!/usr/bin/env bash
# ============================================================================
# Databases by hostname: the invariants
# ============================================================================
# The end-to-end suite proves the mechanism works. This one keeps the promises
# about what it will not do, and keeps the protocol registry honest: nothing is
# claimed routable that was not verified with two live instances.
# ============================================================================
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
cd "$PORTTA_ROOT" || exit 1
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/docker.sh"
. "$PORTTA_ROOT/scripts/lib/discovery.sh"
portta_defaults

describe "the protocol registry states only what was verified"

it "PostgreSQL routes on STARTTLS then SNI"
assert_eq "starttls-sni" "$(portta_routing_for_kind postgres)"

it "Redis routes on SNI, TLS from the first byte"
assert_eq "tls-sni" "$(portta_routing_for_kind redis)"

it "MySQL cannot: the server speaks first"
assert_eq "unsupported" "$(portta_routing_for_kind mysql)"

for kind in mongodb memcached search amqp clickhouse smtp tcp; do
  it "$kind is not claimed to work, because nobody tested it"
  assert_eq "unevaluated" "$(portta_routing_for_kind "$kind")"
done

it "only the verified protocols get an entrypoint"
assert_eq "postgres redis" "$(printf '%s %s' "$(portta_tcp_entrypoint_for_kind postgres)" "$(portta_tcp_entrypoint_for_kind redis)")"

it "and an unsupported one gets none"
assert_eq "" "$(portta_tcp_entrypoint_for_kind mysql)"

describe "hostnames are flat, so one wildcard certificate covers them"

it "the shape matches the HTTP convention"
assert_eq "storefront-postgres.localhost" \
  "$(PORTTA_DOMAIN=localhost portta_tcp_hostname storefront postgres)"

it "a project name with spaces or capitals is slugged the same way Traefik does"
assert_eq "base-empresarial-postgres.localhost" \
  "$(PORTTA_DOMAIN=localhost portta_tcp_hostname 'Base Empresarial' postgres)"

it "the domain follows the profile"
assert_eq "storefront-postgres.vpn.example.com" \
  "$(PORTTA_DOMAIN=vpn.example.com portta_tcp_hostname storefront postgres)"

it "never two levels: a wildcard certificate covers exactly one label"
assert_not_contains "$(PORTTA_DOMAIN=localhost portta_tcp_hostname storefront postgres)" "postgres.storefront"

describe "nothing is published without being asked for"

it "the entrypoints are off in the example configuration"
assert_contains "$(cat .env.example)" "PORTTA_TCP=false"

it "Traefik still routes nothing by default"
assert_contains "$(cat docker/compose/compose.yaml)" 'TRAEFIK_PROVIDERS_DOCKER_EXPOSEDBYDEFAULT: "false"'

it "the entrypoints follow the gateway's bind address"
assert_contains "$(cat docker/compose/features/tcp.yaml)" '${PORTTA_BIND_ADDRESS:-127.0.0.1}:${PORTTA_TCP_POSTGRES_PORT:-5432}'

it "the Tailscale attachment publishes them from the Tailscale container"
assert_contains "$(sed -n '/^  tailscale:/,/^  traefik:/p' docker/compose/features/tcp-tailscale.yaml)" "PORTTA_TCP_POSTGRES_PORT"

it "and Traefik declares no ports of its own there"
assert_eq "" "$(sed -n '/^  traefik:/,$p' docker/compose/features/tcp-tailscale.yaml | grep -E '^\s+ports:' || true)"

describe "a routed datastore joins the access network, never the HTTP one"

it "the shipped template says so"
assert_contains "$(cat templates/overlays/09-tcp-routing.yaml)" "portta-access"

it "and nowhere claims the shared network"
assert_eq "" "$(grep -E '^\s+- portta$' templates/overlays/09-tcp-routing.yaml || true)"

it "the example follows the same rule"
assert_eq "" "$(grep -E '^\s+- portta$' docker/examples/demo-a/compose.portta-tcp.yaml || true)"

it "MySQL is absent from the template rather than half-supported"
assert_eq "" "$(sed -n '/^services:/,/^networks:/p' templates/overlays/09-tcp-routing.yaml | grep -E '^  (mysql|mariadb):' || true)"

describe "TLS is not optional, and the ALPN trap is handled"

it "the PostgreSQL TLS option advertises the protocol libpq offers"
assert_contains "$(cat config/traefik/dynamic/tcp.yaml)" "postgresql"

it "the template references it"
assert_contains "$(cat templates/overlays/09-tcp-routing.yaml)" "tls.options=postgres@file"

it "every router in the template asks for TLS"
assert_eq "2" "$(grep -c 'routers.*\.tls=true' templates/overlays/09-tcp-routing.yaml || true)"

describe "label reading does not depend on a function Docker does not have"

# `docker inspect --format` runs Go templates with Docker's own function map,
# which has none of Traefik's sprig additions. A template using hasPrefix fails
# to parse and prints nothing, so the extraction silently returns empty.
# The TypeScript client command has said so since migration; portta_discover_http
# used it anyway, and quietly ignored every explicit Host() label until TCP
# routing made the failure visible.
it "no shipped script uses hasPrefix in a Docker template"
assert_eq "" "$(grep -rn 'hasPrefix' bin/ scripts/ 2>/dev/null | grep -vE ':[[:space:]]*#' || true)"

t_summary
