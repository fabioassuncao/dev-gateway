#!/usr/bin/env bash
# Profile resolution and overlay selection. Docker is used only for `compose
# config`, which renders without contacting the daemon's network.
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
. "$DG_ROOT/scripts/lib/common.sh"
. "$DG_ROOT/scripts/lib/docker.sh"

# resolve <profile> <var> [env assignments...]: resolve in a subshell so each
# case starts from a clean environment.
resolve() {
  local profile="$1" want="$2"; shift 2
  ( for kv in "$@"; do export "${kv?}"; done
    dg_defaults
    dg_resolve_profile "$profile" >/dev/null 2>&1 || { printf 'REFUSED'; return 0; }
    eval "printf '%s' \"\${$want}\"" )
}

files_for() {
  local profile="$1"; shift
  ( for kv in "$@"; do export "${kv?}"; done
    dg_defaults
    dg_resolve_profile "$profile" >/dev/null 2>&1 || { printf 'REFUSED'; return 0; }
    dg_compose_files "$profile" | tr ' ' '\n' | grep -v '^-f$' | sed 's#.*/##' | tr '\n' ' ' )
}

describe "domains follow the profile"
it "local uses localhost"
assert_eq "localhost" "$(resolve local DEV_GATEWAY_DOMAIN)"
it "remote-private uses PRIVATE_DOMAIN"
assert_eq "vpn.example.test" "$(resolve remote-private DEV_GATEWAY_DOMAIN PRIVATE_DOMAIN=vpn.example.test)"
it "remote-public uses PUBLIC_DOMAIN"
assert_eq "dev.example.test" "$(resolve remote-public DEV_GATEWAY_DOMAIN PUBLIC_DOMAIN=dev.example.test)"
it "remote-public without PUBLIC_DOMAIN is refused"
assert_eq "REFUSED" "$(resolve remote-public DEV_GATEWAY_DOMAIN)"

describe "bind addresses: the security-relevant part"
it "local binds loopback"
assert_eq "127.0.0.1" "$(resolve local DEV_GATEWAY_BIND_ADDRESS)"
it "remote-private with Tailscale binds loopback, reachable only via the tailnet"
assert_eq "127.0.0.1" "$(resolve remote-private DEV_GATEWAY_BIND_ADDRESS TAILSCALE_ENABLED=true)"
it "remote-private keeps an explicit VPN address"
assert_eq "100.64.0.1" "$(resolve remote-private DEV_GATEWAY_BIND_ADDRESS DEV_GATEWAY_BIND_ADDRESS=100.64.0.1)"
it "remote-private REFUSES 0.0.0.0"
assert_eq "REFUSED" "$(resolve remote-private DEV_GATEWAY_BIND_ADDRESS DEV_GATEWAY_BIND_ADDRESS=0.0.0.0)"
it "remote-public binds every interface, deliberately"
assert_eq "0.0.0.0" "$(resolve remote-public DEV_GATEWAY_BIND_ADDRESS PUBLIC_DOMAIN=dev.example.test)"
it "remote-public overrides an explicit narrow bind"
assert_eq "0.0.0.0" "$(resolve remote-public DEV_GATEWAY_BIND_ADDRESS PUBLIC_DOMAIN=dev.example.test DEV_GATEWAY_BIND_ADDRESS=127.0.0.1)"

describe "ACME needs a contact address"
it "remote-public with acme but no email is refused"
assert_eq "REFUSED" "$(resolve remote-public DEV_GATEWAY_DOMAIN PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme)"
it "remote-public with acme and an email resolves"
assert_eq "d.test" "$(resolve remote-public DEV_GATEWAY_DOMAIN PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test)"

describe "exactly one attachment overlay is selected"
it "local attaches to the host"
assert_contains "$(files_for local)" "compose.attach-host.yaml"
it "remote-private with Tailscale uses the namespace attachment"
assert_contains "$(files_for remote-private TAILSCALE_ENABLED=true)" "compose.attach-tailscale.yaml"
it "remote-private without Tailscale falls back to the host attachment"
assert_contains "$(files_for remote-private DEV_GATEWAY_BIND_ADDRESS=100.64.0.1)" "compose.attach-host.yaml"
it "never both"
assert_not_contains "$(files_for remote-private TAILSCALE_ENABLED=true)" "compose.attach-host.yaml"

describe "profile overlays"
it "remote-public includes the public overlay"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test)" "compose.public.yaml"
it "local does not"
assert_not_contains "$(files_for local)" "compose.public.yaml"
it "local TLS pulls in the local-tls overlay"
assert_contains "$(files_for local TLS_ENABLED=true TLS_MODE=local)" "compose.local-tls.yaml"
it "the dashboard overlay follows the attachment"
assert_contains "$(files_for remote-private TAILSCALE_ENABLED=true DEV_GATEWAY_DASHBOARD=true)" "compose.dashboard-tailscale.yaml"

describe "the web panel is opt-in and never public"
it "off by default"
assert_not_contains "$(files_for local)" "compose.web.yaml"
it "enabled by DEV_GATEWAY_WEB"
assert_contains "$(files_for local DEV_GATEWAY_WEB=true)" "compose.web.yaml"
it "development mode adds the HMR overlay"
assert_contains "$(files_for local DEV_GATEWAY_WEB=true DEV_GATEWAY_WEB_DEV=true)" "compose.web-dev.yaml"
it "and does not add it otherwise"
assert_not_contains "$(files_for local DEV_GATEWAY_WEB=true)" "compose.web-dev.yaml"
it "the VPN overlay is opt-in"
assert_contains "$(files_for remote-private DEV_GATEWAY_WEB=true DEV_GATEWAY_WEB_EXPOSE=vpn TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test)" "compose.web-vpn.yaml"
it "routing the panel on remote-public is REFUSED"
assert_eq "REFUSED" "$(resolve remote-public DEV_GATEWAY_DOMAIN PUBLIC_DOMAIN=d.test DEV_GATEWAY_WEB=true DEV_GATEWAY_WEB_EXPOSE=vpn)"
it "the panel itself still runs there, just not routed"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test DEV_GATEWAY_WEB=true)" "compose.web.yaml"
it "and gets no Traefik router"
assert_not_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test DEV_GATEWAY_WEB=true)" "compose.web-vpn.yaml"

describe "TCP entrypoints are opt-in and never public"
it "off by default"
assert_not_contains "$(files_for local)" "compose.tcp.yaml"
it "enabled by DEV_GATEWAY_TCP"
assert_contains "$(files_for local DEV_GATEWAY_TCP=true)" "compose.tcp.yaml"
it "the Tailscale attachment publishes them from the Tailscale container"
assert_contains "$(files_for remote-private DEV_GATEWAY_TCP=true TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test)" "compose.tcp-tailscale.yaml"
it "and never both overlays at once"
assert_not_contains "$(files_for remote-private DEV_GATEWAY_TCP=true TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test)" "compose.tcp.yaml "
it "a database on the public profile is REFUSED"
assert_eq "REFUSED" "$(resolve remote-public DEV_GATEWAY_DOMAIN PUBLIC_DOMAIN=d.test DEV_GATEWAY_TCP=true)"
it "and the public profile still starts without them"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test)" "compose.public.yaml"

describe "every profile renders a valid compose configuration"
if ! docker compose version >/dev/null 2>&1; then
  it "compose validation"; skip "docker compose unavailable"
else
  validate() {
    local profile="$1"; shift
    ( for kv in "$@"; do export "${kv?}"; done
      dg_defaults
      dg_resolve_profile "$profile" >/dev/null 2>&1 || return 1
      dg_compose "$profile" config >/dev/null 2>&1 )
  }
  it "local";                       assert_success validate local
  it "local with TLS";              assert_success validate local TLS_ENABLED=true TLS_MODE=local
  it "local with the dashboard";    assert_success validate local DEV_GATEWAY_DASHBOARD=true
  it "remote-private + tailscale";  assert_success validate remote-private TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy
  it "remote-private, own VPN";     assert_success validate remote-private DEV_GATEWAY_BIND_ADDRESS=100.64.0.1 PRIVATE_DOMAIN=vpn.test
  it "remote-public";               assert_success validate remote-public PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test
  it "remote-public + tailscale";   assert_success validate remote-public PUBLIC_DOMAIN=d.test TAILSCALE_ENABLED=true TS_AUTHKEY=dummy TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test
  it "local with the web panel";    assert_success validate local DEV_GATEWAY_WEB=true
  it "local with the panel in dev"; assert_success validate local DEV_GATEWAY_WEB=true DEV_GATEWAY_WEB_DEV=true
  it "remote-private + panel/vpn";  assert_success validate remote-private TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy DEV_GATEWAY_WEB=true DEV_GATEWAY_WEB_EXPOSE=vpn
  it "local with tcp entrypoints";  assert_success validate local DEV_GATEWAY_TCP=true
  it "remote-private + tcp";        assert_success validate remote-private TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy DEV_GATEWAY_TCP=true
fi

describe "the private profile never publishes on a public interface"
if ! docker compose version >/dev/null 2>&1; then
  it "rendered binds"; skip "docker compose unavailable"
else
  rendered=$(
    export TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy DEV_GATEWAY_TCP=true
    dg_defaults; dg_resolve_profile remote-private >/dev/null 2>&1
    dg_compose remote-private config 2>/dev/null
  )
  it "no 0.0.0.0 anywhere in the rendered private profile"
  assert_not_contains "$rendered" "0.0.0.0"
  it "traefik shares the tailscale namespace"
  assert_contains "$rendered" "network_mode: service:tailscale"
  it "the socket proxy is still unpublished"
  assert_not_contains "$rendered" "2375:2375"
fi

t_summary
