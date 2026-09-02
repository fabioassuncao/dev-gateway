#!/usr/bin/env bash
# The Cloudflare Tunnel configuration Portta generates, checked against the
# program that consumes it.
#
# `renderTunnelConfig` has unit tests of its own, but they only prove it writes
# what we think it writes. This proves cloudflared *reads* it the way the whole
# design depends on: one wildcard rule matching every hostname Portta derives,
# and nothing else. If that assumption ever changes, this is what catches it.
#
# No network and no Cloudflare account: `ingress validate` and `ingress rule`
# are offline commands.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"

describe "the generated connector configuration, read by cloudflared itself"

CLOUDFLARED=$(portta_locate cloudflared 2>/dev/null || true)
CAN_MATCH=1
if [ -z "$CLOUDFLARED" ] || ! command -v node >/dev/null 2>&1 || [ ! -f "$PORTTA_ROOT/packages/core/dist/tunnel.js" ]; then
  CAN_MATCH=0
  it "cloudflared agrees with the generator"
  skip "cloudflared, node or the built core package is unavailable"
fi

if [ "$CAN_MATCH" = "1" ]; then

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

node --input-type=module -e '
  import { renderTunnelConfig } from "'"$PORTTA_ROOT"'/packages/core/dist/tunnel.js"
  import { writeFileSync } from "node:fs"
  writeFileSync(process.argv[1], renderTunnelConfig({
    id: "6ff42ae2-765d-4adf-8112-31c55c1551ef",
    zone: "portta.app",
    origin: "http://traefik:80",
    credentialsFile: "/etc/cloudflared/credentials.json",
    extraRoutes: [{ hostname: "panel.portta.app", service: "http://web:3000" }],
  }))
' "$WORK/config.yml" 2>/dev/null

it "is a configuration cloudflared accepts"
assert_contains "$("$CLOUDFLARED" tunnel --config "$WORK/config.yml" ingress validate 2>&1)" "OK"

# match <url>: the hostname of the rule cloudflared picks, or the service for
# the catch-all, which names no hostname.
match() {
  "$CLOUDFLARED" tunnel --config "$WORK/config.yml" ingress rule "$1" 2>&1 \
    | awk '$1 == "hostname:" || $1 == "service:" { print $2; exit }'
}

it "routes a plain project hostname through the single wildcard"
assert_eq "*.portta.app" "$(match https://web--storefront.portta.app)"

it "routes one carrying a context through the same rule, with no extra configuration"
assert_eq "*.portta.app" "$(match https://api--shop--pr-42.portta.app)"

it "routes the older hostname style through it too"
assert_eq "*.portta.app" "$(match https://storefront-web.portta.app)"

it "lets an explicit route win, because it is written first"
assert_eq "panel.portta.app" "$(match https://panel.portta.app)"

# `*.example.com` does not match `example.com`. Worth pinning: an operator who
# expects the apex to work would otherwise find a 404 with no explanation.
it "does not serve the apex from the wildcard"
assert_eq "http_status:404" "$(match https://portta.app)"

it "refuses a hostname from another zone rather than proxying it"
assert_eq "http_status:404" "$(match https://elsewhere.example.com)"

describe "the apex, when it is asked for"

node --input-type=module -e '
  import { renderTunnelConfig } from "'"$PORTTA_ROOT"'/packages/core/dist/tunnel.js"
  import { writeFileSync } from "node:fs"
  writeFileSync(process.argv[1], renderTunnelConfig({
    id: "6ff42ae2-765d-4adf-8112-31c55c1551ef",
    zone: "portta.app",
    origin: "http://traefik:80",
    credentialsFile: "/etc/cloudflared/credentials.json",
    includeApex: true,
  }))
' "$WORK/apex.yml" 2>/dev/null

apex_match() {
  "$CLOUDFLARED" tunnel --config "$WORK/apex.yml" ingress rule "$1" 2>&1 \
    | awk '$1 == "hostname:" || $1 == "service:" { print $2; exit }'
}

it "is still a valid configuration"
assert_contains "$("$CLOUDFLARED" tunnel --config "$WORK/apex.yml" ingress validate 2>&1)" "OK"

it "now reaches the gateway"
assert_eq "portta.app" "$(apex_match https://portta.app)"

it "and the wildcard still covers everything below it"
assert_eq "*.portta.app" "$(apex_match https://web--storefront.portta.app)"

fi   # CAN_MATCH

# `bin/portta` honours an inherited PORTTA_ROOT, which is what lets the
# installer point it at PORTTA_HOME. This suite exports one, so every
# invocation below must clear it or the command would write into the
# repository — the .env and the credentials of whoever is running the tests.
run_in_home() {
  local home="$1"; shift
  ( cd "$home" && env -u PORTTA_ROOT -u PORTTA_STATE_DIR ./bin/portta "$@" )
}

describe "portta tunnel setup, writing what the connector reads"

SETUP_HOME=$(mktemp -d)
cp -R "$PORTTA_ROOT/bin" "$PORTTA_ROOT/scripts" "$PORTTA_ROOT/docker" "$SETUP_HOME/" 2>/dev/null
mkdir -p "$SETUP_HOME/packages/core"
[ -d "$PORTTA_ROOT/packages/core/dist" ] && cp -R "$PORTTA_ROOT/packages/core/dist" "$SETUP_HOME/packages/core/"
cp "$PORTTA_ROOT/.env.example" "$SETUP_HOME/.env"

# A well-formed token with no account behind it: enough to exercise every path
# that reads one, and useless to anybody who finds it.
python3 - "$SETUP_HOME/token.txt" <<'PYTOKEN'
import base64, json, sys
token = base64.b64encode(json.dumps({
    "a": "0" * 32,
    "t": "6ff42ae2-765d-4adf-8112-31c55c1551ef",
    "s": base64.b64encode(b"x" * 32).decode(),
}).encode()).decode()
open(sys.argv[1], "w").write(token)
PYTOKEN

run_in_home "$SETUP_HOME" tunnel setup --zone portta.app --token-file ./token.txt >/dev/null 2>&1

it "writes into the isolated home, never into the repository"
assert_success test ! -e "$PORTTA_ROOT/state/cloudflared/credentials.json"

it "writes the credentials file"
assert_success test -f "$SETUP_HOME/state/cloudflared/credentials.json"

# A credential readable by every user on the host is not a credential.
it "keeps the credential to its owner"
assert_eq "600" "$(portta_file_mode "$SETUP_HOME/state/cloudflared/credentials.json")"

it "keeps the directory to its owner too"
assert_eq "700" "$(portta_file_mode "$SETUP_HOME/state/cloudflared")"

it "derives the credentials cloudflared expects from the token"
assert_contains "$(cat "$SETUP_HOME/state/cloudflared/credentials.json")" '"TunnelID":"6ff42ae2-765d-4adf-8112-31c55c1551ef"'

# The token is a credential. It belongs in one file with one owner, never in
# the configuration file the panel can read and the operator edits.
it "never writes the token into .env"
assert_not_contains "$(cat "$SETUP_HOME/.env")" "$(cat "$SETUP_HOME/token.txt")"

it "never writes the token into the connector config"
assert_not_contains "$(cat "$SETUP_HOME/state/cloudflared/config.yml")" "$(cat "$SETUP_HOME/token.txt")"

it "records the zone and the tunnel id, which are not secrets"
assert_contains "$(cat "$SETUP_HOME/.env")" "CLOUDFLARE_TUNNEL_ZONE=portta.app"
assert_contains "$(cat "$SETUP_HOME/.env")" "CLOUDFLARE_TUNNEL_ID=6ff42ae2-765d-4adf-8112-31c55c1551ef"

it "refuses a token given as an argument, where ps would show it"
OUT=$(run_in_home "$SETUP_HOME" tunnel setup --zone portta.app --token "$(cat "$SETUP_HOME/token.txt")" 2>&1)
assert_contains "$OUT" "visible in"

# ADR 0015: the core commands must work on a host with nothing but Docker and
# a shell, so the token has a decoder that needs no Node.
describe "the same setup without Node"

NONODE_HOME=$(mktemp -d)
cp -R "$PORTTA_ROOT/bin" "$PORTTA_ROOT/scripts" "$PORTTA_ROOT/docker" "$NONODE_HOME/" 2>/dev/null
cp "$PORTTA_ROOT/.env.example" "$NONODE_HOME/.env"
cp "$SETUP_HOME/token.txt" "$NONODE_HOME/token.txt"
# No packages/core/dist here, so the shell fallback is the only path available.
run_in_home "$NONODE_HOME" tunnel setup --zone example.test --token-file ./token.txt >/dev/null 2>&1

it "still writes a credentials file"
assert_success test -f "$NONODE_HOME/state/cloudflared/credentials.json"

it "decodes the token to the same three fields"
assert_contains "$(cat "$NONODE_HOME/state/cloudflared/credentials.json")" '"TunnelID":"6ff42ae2-765d-4adf-8112-31c55c1551ef"'

it "keeps it 0600 on that path too"
assert_eq "600" "$(portta_file_mode "$NONODE_HOME/state/cloudflared/credentials.json")"

if [ -n "$CLOUDFLARED" ]; then
  it "writes a config the real cloudflared accepts, on the no-Node path too"
  assert_contains "$("$CLOUDFLARED" tunnel --config "$NONODE_HOME/state/cloudflared/config.yml" ingress validate 2>&1)" "OK"
fi

rm -rf "$SETUP_HOME" "$NONODE_HOME"

t_summary
