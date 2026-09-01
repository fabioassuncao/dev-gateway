#!/usr/bin/env bash
# Profile resolution and overlay selection. Docker is used only for `compose
# config`, which renders without contacting the daemon's network.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/docker.sh"

# resolve <profile> <var> [env assignments...]: resolve in a subshell so each
# case starts from a clean environment.
resolve() {
  local profile="$1" want="$2"; shift 2
  ( for kv in "$@"; do export "${kv?}"; done
    portta_defaults
    portta_resolve_profile "$profile" >/dev/null 2>&1 || { printf 'REFUSED'; return 0; }
    eval "printf '%s' \"\${$want}\"" )
}

files_for() {
  local profile="$1"; shift
  ( for kv in "$@"; do export "${kv?}"; done
    portta_defaults
    portta_resolve_profile "$profile" >/dev/null 2>&1 || { printf 'REFUSED'; return 0; }
    # Repo-relative, so the assertions name the same paths the docs do.
    portta_compose_files "$profile" | tr ' ' '\n' | grep -v '^-f$' | sed "s#^$PORTTA_ROOT/##" | tr '\n' ' ' )
}

# A routed panel is refused without one, so every case that routes it carries
# the credential. See docs/adr/0012-panel-authentication-is-traefiks.md.
PORTTA_RUNTIME_CREDENTIAL="PORTTA_WEB_AUTH=basic PORTTA_WEB_AUTH_USER=dev PORTTA_WEB_AUTH_HASH=\$apr1\$abcdefgh\$ckT15POyCRlen.h6XtGAZ1"

describe "domains follow the profile"
it "local uses localhost"
assert_eq "localhost" "$(resolve local PORTTA_DOMAIN)"
it "remote-private uses PRIVATE_DOMAIN"
assert_eq "vpn.example.test" "$(resolve remote-private PORTTA_DOMAIN PRIVATE_DOMAIN=vpn.example.test)"
it "remote-public uses PUBLIC_DOMAIN"
assert_eq "dev.example.test" "$(resolve remote-public PORTTA_DOMAIN PUBLIC_DOMAIN=dev.example.test)"
it "remote-public without PUBLIC_DOMAIN is refused"
assert_eq "REFUSED" "$(resolve remote-public PORTTA_DOMAIN)"

describe "bind addresses: the security-relevant part"
it "local binds loopback"
assert_eq "127.0.0.1" "$(resolve local PORTTA_BIND_ADDRESS)"
it "remote-private with Tailscale binds loopback, reachable only via the tailnet"
assert_eq "127.0.0.1" "$(resolve remote-private PORTTA_BIND_ADDRESS TAILSCALE_ENABLED=true)"
it "remote-private keeps an explicit VPN address"
assert_eq "100.64.0.1" "$(resolve remote-private PORTTA_BIND_ADDRESS PORTTA_BIND_ADDRESS=100.64.0.1)"
it "remote-private REFUSES 0.0.0.0"
assert_eq "REFUSED" "$(resolve remote-private PORTTA_BIND_ADDRESS PORTTA_BIND_ADDRESS=0.0.0.0)"
it "remote-public binds every interface, deliberately"
assert_eq "0.0.0.0" "$(resolve remote-public PORTTA_BIND_ADDRESS PUBLIC_DOMAIN=dev.example.test)"
it "remote-public overrides an explicit narrow bind"
assert_eq "0.0.0.0" "$(resolve remote-public PORTTA_BIND_ADDRESS PUBLIC_DOMAIN=dev.example.test PORTTA_BIND_ADDRESS=127.0.0.1)"

describe "ACME needs a contact address"
it "remote-public with acme but no email is refused"
assert_eq "REFUSED" "$(resolve remote-public PORTTA_DOMAIN PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme)"
it "remote-public with acme and an email resolves"
assert_eq "d.test" "$(resolve remote-public PORTTA_DOMAIN PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test)"

describe "exactly one attachment overlay is selected"
it "local attaches to the host"
assert_contains "$(files_for local)" "docker/compose/attach/host.yaml"
it "remote-private with Tailscale uses the namespace attachment"
assert_contains "$(files_for remote-private TAILSCALE_ENABLED=true)" "docker/compose/attach/tailscale.yaml"
it "remote-private without Tailscale falls back to the host attachment"
assert_contains "$(files_for remote-private PORTTA_BIND_ADDRESS=100.64.0.1)" "docker/compose/attach/host.yaml"
it "never both"
assert_not_contains "$(files_for remote-private TAILSCALE_ENABLED=true)" "docker/compose/attach/host.yaml"

describe "profile overlays"
it "remote-public includes the public overlay"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test)" "docker/compose/profiles/public.yaml"
it "local does not"
assert_not_contains "$(files_for local)" "docker/compose/profiles/public.yaml"
it "local TLS pulls in the local-tls overlay"
assert_contains "$(files_for local TLS_ENABLED=true TLS_MODE=local)" "docker/compose/profiles/local-tls.yaml"
it "the dashboard overlay follows the attachment"
assert_contains "$(files_for remote-private TAILSCALE_ENABLED=true PORTTA_DASHBOARD=true)" "docker/compose/features/dashboard-tailscale.yaml"

describe "the web panel is opt-in and never public"
it "off by default"
assert_not_contains "$(files_for local)" "docker/compose/features/web.yaml"
it "enabled by PORTTA_WEB"
assert_contains "$(files_for local PORTTA_WEB=true)" "docker/compose/features/web.yaml"
it "development mode adds the HMR overlay"
assert_contains "$(files_for local PORTTA_WEB=true PORTTA_WEB_DEV=true)" "docker/compose/features/web-dev.yaml"
it "and does not add it otherwise"
assert_not_contains "$(files_for local PORTTA_WEB=true)" "docker/compose/features/web-dev.yaml"
it "the VPN overlay is opt-in"
assert_contains "$(files_for remote-private PORTTA_WEB=true PORTTA_WEB_EXPOSE=vpn TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test $PORTTA_RUNTIME_CREDENTIAL)" "docker/compose/features/web-vpn.yaml"
it "routing the panel on remote-public is REFUSED"
assert_eq "REFUSED" "$(resolve remote-public PORTTA_DOMAIN PUBLIC_DOMAIN=d.test PORTTA_WEB=true PORTTA_WEB_EXPOSE=vpn)"
it "the panel itself still runs there, just not routed"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test PORTTA_WEB=true)" "docker/compose/features/web.yaml"
it "and gets no Traefik router"
assert_not_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test PORTTA_WEB=true)" "docker/compose/features/web-vpn.yaml"

describe "TCP entrypoints are opt-in and never public"
it "off by default"
assert_not_contains "$(files_for local)" "docker/compose/features/tcp.yaml"
it "enabled by PORTTA_TCP"
assert_contains "$(files_for local PORTTA_TCP=true)" "docker/compose/features/tcp.yaml"
it "the Tailscale attachment publishes them from the Tailscale container"
assert_contains "$(files_for remote-private PORTTA_TCP=true TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test)" "docker/compose/features/tcp-tailscale.yaml"
it "and never both overlays at once"
assert_not_contains "$(files_for remote-private PORTTA_TCP=true TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test)" "docker/compose/features/tcp.yaml"
it "a database on the public profile is REFUSED"
assert_eq "REFUSED" "$(resolve remote-public PORTTA_DOMAIN PUBLIC_DOMAIN=d.test PORTTA_TCP=true)"
it "and the public profile still starts without them"
assert_contains "$(files_for remote-public PUBLIC_DOMAIN=d.test)" "docker/compose/profiles/public.yaml"

describe "every profile renders a valid compose configuration"
if ! docker compose version >/dev/null 2>&1; then
  it "compose validation"; skip "docker compose unavailable"
else
  validate() {
    local profile="$1"; shift
    ( for kv in "$@"; do export "${kv?}"; done
      portta_defaults
      portta_resolve_profile "$profile" >/dev/null 2>&1 || return 1
      portta_compose "$profile" config >/dev/null 2>&1 )
  }
  it "local";                       assert_success validate local
  it "local with TLS";              assert_success validate local TLS_ENABLED=true TLS_MODE=local
  it "local with the dashboard";    assert_success validate local PORTTA_DASHBOARD=true
  it "remote-private + tailscale";  assert_success validate remote-private TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy
  it "remote-private, own VPN";     assert_success validate remote-private PORTTA_BIND_ADDRESS=100.64.0.1 PRIVATE_DOMAIN=vpn.test
  it "remote-public";               assert_success validate remote-public PUBLIC_DOMAIN=d.test TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test
  it "remote-public + tailscale";   assert_success validate remote-public PUBLIC_DOMAIN=d.test TAILSCALE_ENABLED=true TS_AUTHKEY=dummy TLS_ENABLED=true TLS_MODE=acme ACME_EMAIL=a@d.test
  it "local with the web panel";    assert_success validate local PORTTA_WEB=true
  it "local with the panel in dev"; assert_success validate local PORTTA_WEB=true PORTTA_WEB_DEV=true
  # shellcheck disable=SC2086  # the credential is three separate assignments
  it "remote-private + panel/vpn";  assert_success validate remote-private TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy PORTTA_WEB=true PORTTA_WEB_EXPOSE=vpn $PORTTA_RUNTIME_CREDENTIAL
  it "local with tcp entrypoints";  assert_success validate local PORTTA_TCP=true
  it "remote-private + tcp";        assert_success validate remote-private TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy PORTTA_TCP=true
fi

describe "panel access selects exactly one front door"

# See docs/adr/0021-panel-access-modes.md. The invariant worth testing is that
# `web-bind.yaml` (a host port on the panel container) and `panel-public.yaml`
# (a Traefik entrypoint with BasicAuth) are never both applied, because they
# would claim the same host port and one of them would bypass the credential.
for mode in local tailscale vpn; do
  it "$mode publishes the panel container, not a Traefik entrypoint"
  # shellcheck disable=SC2086
  selected=$(files_for local PORTTA_WEB=true "PORTTA_WEB_EXPOSE=$mode" $PORTTA_RUNTIME_CREDENTIAL)
  assert_contains "$selected" "docker/compose/features/web-bind.yaml"
  assert_not_contains "$selected" "docker/compose/features/panel-public.yaml"
done

it "public publishes a Traefik entrypoint, not the panel container"
# shellcheck disable=SC2086
selected=$(files_for local PORTTA_WEB=true PORTTA_WEB_EXPOSE=public $PORTTA_RUNTIME_CREDENTIAL)
assert_contains "$selected" "docker/compose/features/panel-public.yaml"
assert_not_contains "$selected" "docker/compose/features/web-bind.yaml"

it "public without a credential is refused"
assert_eq "REFUSED" "$(files_for local PORTTA_WEB=true PORTTA_WEB_EXPOSE=public)"

it "public is refused where Traefik has no namespace of its own"
# shellcheck disable=SC2086
assert_eq "REFUSED" "$(files_for remote-private PRIVATE_DOMAIN=vpn.test TAILSCALE_ENABLED=true TS_AUTHKEY=dummy PORTTA_WEB=true PORTTA_WEB_EXPOSE=public $PORTTA_RUNTIME_CREDENTIAL)"

it "a normal install never selects the build overlay"
assert_not_contains "$(files_for local PORTTA_WEB=true)" "docker/compose/features/web-build.yaml"

it "and a developer can opt back into it"
assert_contains "$(files_for local PORTTA_WEB=true PORTTA_WEB_BUILD=true)" "docker/compose/features/web-build.yaml"

describe "the shell and the TypeScript CLI select the same overlays"

# ADR 0015: the core commands must run without Node, so the selection logic has
# two implementations. This is what keeps them honest.
if ! command -v node >/dev/null 2>&1 || [ ! -f "$PORTTA_ROOT/packages/core/dist/config.js" ]; then
  it "parity"; skip "node or the built core package is unavailable"
else
  ts_files_for() {
    ( for kv in "$@"; do export "${kv?}"; done
      node --input-type=module -e '
        import { loadGatewayConfig, composeFiles } from "'"$PORTTA_ROOT"'/packages/core/dist/config.js"
        try { process.stdout.write(composeFiles(loadGatewayConfig(process.env)).join(" ") + " ") }
        catch { process.stdout.write("REFUSED") }
      ' 2>/dev/null )
  }
  for case_env in \
    "PORTTA_PROFILE=local" \
    "PORTTA_PROFILE=local PORTTA_TCP=true" \
    "PORTTA_PROFILE=local PORTTA_DASHBOARD=true" \
    "PORTTA_PROFILE=local TLS_ENABLED=true TLS_MODE=local" \
    "PORTTA_PROFILE=local PORTTA_WEB=true" \
    "PORTTA_PROFILE=local PORTTA_WEB=true PORTTA_WEB_BUILD=true" \
    "PORTTA_PROFILE=remote-private PRIVATE_DOMAIN=vpn.test TAILSCALE_ENABLED=true" \
    "PORTTA_PROFILE=remote-public PUBLIC_DOMAIN=d.test"
  do
    it "same files for: $case_env"
    # shellcheck disable=SC2086
    profile=$(printf '%s' "$case_env" | sed -n 's/.*PORTTA_PROFILE=\([a-z-]*\).*/\1/p')
    # shellcheck disable=SC2086
    assert_eq "$(files_for "$profile" $case_env)" "$(ts_files_for $case_env)"
  done

  # The panel modes are the new axis, and the one most likely to drift.
  for mode in local tailscale public vpn; do
    it "same files for panel access: $mode"
    # shellcheck disable=SC2086
    assert_eq \
      "$(files_for local PORTTA_PROFILE=local PORTTA_WEB=true "PORTTA_WEB_EXPOSE=$mode" $PORTTA_RUNTIME_CREDENTIAL)" \
      "$(ts_files_for PORTTA_PROFILE=local PORTTA_WEB=true "PORTTA_WEB_EXPOSE=$mode" $PORTTA_RUNTIME_CREDENTIAL)"
  done
fi

describe "the private profile never publishes on a public interface"
if ! docker compose version >/dev/null 2>&1; then
  it "rendered binds"; skip "docker compose unavailable"
else
  rendered=$(
    export TAILSCALE_ENABLED=true PRIVATE_DOMAIN=vpn.test TS_AUTHKEY=dummy PORTTA_TCP=true
    portta_defaults; portta_resolve_profile remote-private >/dev/null 2>&1
    portta_compose remote-private config 2>/dev/null
  )
  it "no 0.0.0.0 anywhere in the rendered private profile"
  assert_not_contains "$rendered" "0.0.0.0"
  it "traefik shares the tailscale namespace"
  assert_contains "$rendered" "network_mode: service:tailscale"
  it "the socket proxy is still unpublished"
  assert_not_contains "$rendered" "2375:2375"
fi

t_summary
