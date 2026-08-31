#!/usr/bin/env bash
# ============================================================================
# Audit — invariants that must not regress
# ============================================================================
# These are the promises the gateway makes about what it will never do. Each
# was verified by hand once; this keeps them true.
# ============================================================================
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
cd "$DG_ROOT" || exit 1

# Tracked files, excluding the build brief.
tracked() { git ls-files "$@" 2>/dev/null | grep -v '^docs/prompts/'; }
code() { git ls-files 'bin/*' 'scripts/**' 'compose*.yaml' 'toolbox/*' '.github/**' 2>/dev/null; }

describe "the gateway stays decoupled from consumer projects"

it "no absolute home paths are baked in"
assert_eq "" "$(tracked | xargs grep -ln '/Users/\|/home/[a-z]' 2>/dev/null || true)"

it "no consumer project is named in the code"
# Names may appear in prose as examples; code must be vendor-neutral.
assert_eq "" "$(code | xargs grep -lni 'brasil.data.hub\|base-empresarial\|base-eleicoes\|base-escolar\|issue-flow' 2>/dev/null || true)"

it "nothing clones a consumer project"
assert_eq "" "$(code | xargs grep -ln 'git clone' 2>/dev/null | grep -v 'scripts/cmd/remote.sh' || true)"

it "no consumer directory is mounted into the gateway"
# Only three kinds of mount are legitimate here: the gateway's own ./config and
# ./state, the Docker socket (read-only, into the proxy alone), and /dev/net/tun
# for Tailscale's kernel networking. Anything else would be reaching into
# somebody's project.
# A bind mount is `src:dst`; a tmpfs entry has no colon, so require one.
assert_eq "" "$(grep -hE '^\s+- [./][^ ]*:' compose*.yaml \
  | grep -vE '\./(config|state)/' \
  | grep -vE '/var/run/docker\.sock:/var/run/docker\.sock:ro' \
  | grep -vE '/dev/net/tun:/dev/net/tun' || true)"

describe "the gateway never destroys what it does not own"

it "no prune, ever"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' 'tests/**' '.github/**' | xargs grep -n 'docker system prune\|docker volume prune\|docker network prune\|docker image prune' 2>/dev/null || true)"

it "nothing removes a volume"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' | xargs grep -n 'docker volume rm' 2>/dev/null || true)"

it "nothing removes a network"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' | xargs grep -n 'docker network rm' 2>/dev/null || true)"

it "every file that removes a container also checks ownership"
offenders=""
for f in $(tracked 'bin/*' 'scripts/**' | xargs grep -ln 'docker rm ' 2>/dev/null || true); do
  grep -q 'dg_container_is_managed' "$f" || offenders="$offenders $f"
done
assert_eq "" "$offenders"

it "compose down never takes volumes or orphans with it"
assert_eq "" "$(grep -n 'dg_compose .* down' bin/dev-gateway scripts/cmd/*.sh 2>/dev/null | grep -E '\-v|--volumes|--remove-orphans' || true)"

describe "secrets never reach the process list or the repository"

it "no bearer token on a command line"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' | xargs grep -n 'Authorization: Bearer' 2>/dev/null | grep -v 'printf' || true)"

it "no password interpolated into a docker -e flag"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' | xargs grep -nE '\-e (PGPASSWORD|MYSQL_PWD|POSTGRES_PASSWORD)=' 2>/dev/null || true)"

it "no auth key or private key is tracked"
assert_eq "" "$(tracked | xargs grep -lE 'tskey-(auth|client)-[A-Za-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY-----' 2>/dev/null || true)"

it "no .env is tracked"
assert_eq "" "$(tracked | grep -E '(^|/)\.env$' || true)"

it "no TLS material is tracked"
assert_eq "" "$(tracked | grep -E '\.(key|crt|pem|p12|srl)$' || true)"

it "inspect reports secrets as set/unset, never by value"
assert_contains "$(grep -A2 'TS_AUTHKEY' bin/dev-gateway | head -3)" "<set>"

describe "nothing is exposed by default"

it "the local profile binds loopback"
assert_contains "$(cat .env.example)" "DEV_GATEWAY_BIND_ADDRESS=127.0.0.1"

it "public access is off in the example configuration"
assert_contains "$(cat .env.example)" "PUBLIC_ENABLED=false"

it "the dashboard is off in the example configuration"
assert_contains "$(cat .env.example)" "DEV_GATEWAY_DASHBOARD=false"

it "traefik does not expose containers by default"
assert_contains "$(cat compose.yaml)" 'TRAEFIK_PROVIDERS_DOCKER_EXPOSEDBYDEFAULT: "false"'

it "the socket proxy publishes no host port"
assert_eq "" "$(sed -n '/socket-proxy:/,/^  [a-z]/p' compose.yaml | grep -E '^\s+ports:' || true)"

it "the socket proxy mounts the socket read-only"
assert_contains "$(cat compose.yaml)" "/var/run/docker.sock:/var/run/docker.sock:ro"

it "the socket proxy denies writes"
assert_contains "$(cat compose.yaml)" 'POST: "0"'

it "the control network is internal"
assert_contains "$(cat compose.yaml)" "internal: true"

it "the docker socket is never mounted into traefik"
assert_eq "" "$(sed -n '/^  traefik:/,$p' compose.yaml | grep 'docker.sock' || true)"

describe "SSH keeps host verification on"

it "StrictHostKeyChecking is never disabled"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' | xargs grep -n 'StrictHostKeyChecking=no' 2>/dev/null || true)"

it "the default policy still refuses a changed host key"
assert_contains "$(cat scripts/cmd/remote.sh)" "accept-new"

describe "supply chain"

it "every image pins an explicit version"
assert_eq "" "$(grep -rhnE '^\s*(image|FROM):?\s' compose*.yaml examples/*/compose*.yaml toolbox/Dockerfile 2>/dev/null \
  | grep -vE ':[A-Za-z0-9][A-Za-z0-9._-]*\s*$' || true)"

it "no floating latest tag"
assert_eq "" "$(grep -rn ':latest' compose*.yaml examples/*/compose*.yaml toolbox/Dockerfile 2>/dev/null || true)"

it "the versions table in ADR 0004 lists every pinned image"
adr="docs/adr/0004-pinned-versions.md"
missing=""
for img in $(grep -rhoE 'image: [a-z0-9./_-]+' compose*.yaml examples/*/compose*.yaml scripts/lib/discovery.sh 2>/dev/null \
             | awk '{print $2}' | sort -u); do
  grep -q "$(basename "$img")" "$adr" || missing="$missing $img"
done
assert_eq "" "$missing"

t_summary
