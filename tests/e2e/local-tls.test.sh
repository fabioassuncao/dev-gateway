#!/usr/bin/env bash
# ============================================================================
# E2E — optional local HTTPS
# ============================================================================
# Issues a local CA and wildcard certificate, serves a demo over HTTPS, checks
# the chain validates against that CA, then puts the gateway back on plain HTTP.
#
# Trusting the CA in the OS trust store is a privileged host action the gateway
# never performs, so this suite verifies the chain explicitly instead.
# ============================================================================
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
. "$DG_ROOT/scripts/lib/common.sh"
. "$DG_ROOT/scripts/lib/docker.sh"
. "$DG_ROOT/scripts/lib/toolbox.sh"
dg_load_env; dg_defaults

GW="$DG_ROOT/bin/dev-gateway"
CA="$DG_ROOT/config/tls/dev-gateway-ca.crt"

dg_require_docker >/dev/null 2>&1 || { echo "docker unavailable — skipping"; exit 0; }
dg_have openssl || { echo "openssl unavailable — skipping"; exit 0; }

# Remember how TLS was configured so the suite leaves the host as it found it.
ORIG_TLS="${TLS_ENABLED:-false}"
HAD_CA=0; [ -f "$CA" ] && HAD_CA=1

cleanup() {
  ( cd "$DG_ROOT/examples/demo-a" && docker compose \
      -f compose.yaml -f compose.dev-gateway.yaml down -v ) >/dev/null 2>&1
  dg_env_set TLS_ENABLED "$ORIG_TLS" >/dev/null 2>&1
  if [ "$HAD_CA" = "0" ]; then
    rm -f "$DG_ROOT/config/tls/dev-gateway-ca."* "$DG_ROOT/config/tls/wildcard."* \
          "$DG_ROOT/config/traefik/dynamic/local-tls.yaml"
  fi
  TLS_ENABLED="$ORIG_TLS" TLS_MODE=local "$GW" up local >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

describe "issuing a local certificate"
it "tls init succeeds"; assert_success "$GW" tls init
it "the CA certificate exists"; assert_success test -f "$CA"
it "the wildcard certificate exists"; assert_success test -f "$DG_ROOT/config/tls/wildcard.crt"
it "the CA private key is owner-only"
assert_eq "-rw-------" "$(ls -l "$DG_ROOT/config/tls/dev-gateway-ca.key" | cut -c1-10)"
it "no key material is tracked by git"
assert_eq "" "$(cd "$DG_ROOT" && git ls-files config/tls | grep -v gitkeep || true)"

it "the certificate covers the wildcard"
assert_contains "$(openssl x509 -noout -text -in "$DG_ROOT/config/tls/wildcard.crt" 2>/dev/null)" "DNS:*.localhost"

describe "serving over HTTPS"
# dg_load_env exported the pre-init value, and the shell environment wins over
# .env for any child process. Drop it so the CLI reads what `tls init` wrote.
unset TLS_ENABLED TLS_MODE
"$GW" up local >/dev/null 2>&1
( cd "$DG_ROOT/examples/demo-a" && docker compose \
    -f compose.yaml -f compose.dev-gateway.yaml up -d --wait --wait-timeout 120 ) >/dev/null 2>&1
sleep 5

it "the chain validates against the generated CA"
assert_contains "$(echo | openssl s_client -connect "127.0.0.1:${DEV_GATEWAY_HTTPS_PORT}" \
  -servername demo-a-web.localhost -CAfile "$CA" 2>/dev/null)" "Verify return code: 0 (ok)"

it "the presented certificate is ours"
assert_contains "$(echo | openssl s_client -connect "127.0.0.1:${DEV_GATEWAY_HTTPS_PORT}" \
  -servername demo-a-web.localhost 2>/dev/null | openssl x509 -noout -issuer 2>/dev/null)" "Dev Gateway local CA"

it "the application is actually served over TLS"
assert_contains "$(curl -sk --max-time 10 \
  --resolve "demo-a-web.localhost:${DEV_GATEWAY_HTTPS_PORT}:127.0.0.1" \
  https://demo-a-web.localhost/ 2>/dev/null)" "demo-a-web"

it "plain HTTP redirects to HTTPS"
assert_eq "302" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  --resolve "demo-a-web.localhost:${DEV_GATEWAY_HTTP_PORT}:127.0.0.1" \
  http://demo-a-web.localhost/)"

it "the redirect points at the HTTPS URL"
assert_eq "https://demo-a-web.localhost/" "$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 10 \
  --resolve "demo-a-web.localhost:${DEV_GATEWAY_HTTP_PORT}:127.0.0.1" \
  http://demo-a-web.localhost/)"

describe "doctor understands the TLS configuration"
it "doctor still passes"; assert_success "$GW" doctor

t_summary
