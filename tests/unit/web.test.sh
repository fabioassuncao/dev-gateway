#!/usr/bin/env bash
# ============================================================================
# The web panel: the invariants that make it safe to run
# ============================================================================
# The panel is the one component that can start, stop and remove containers,
# so what it CANNOT do matters more than what it can. These assertions are the
# enforcement; docs/web-ui.md is the explanation.
# ============================================================================
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
cd "$DG_ROOT" || exit 1

web_proxy() { sed -n '/^  web-socket-proxy:/,/^  web:/p' compose.web.yaml; }

describe "the panel gets its own socket proxy, not Traefik's"

it "Traefik's proxy still denies every write"
assert_contains "$(cat compose.yaml)" 'POST: "0"'

it "the panel's proxy is a separate service"
assert_contains "$(cat compose.web.yaml)" "web-socket-proxy:"

it "and mounts the socket read-only"
assert_contains "$(web_proxy)" "/var/run/docker.sock:/var/run/docker.sock:ro"

it "publishing no host port of its own"
assert_eq "" "$(web_proxy | grep -E '^\s+ports:' || true)"

describe "the panel's proxy grants only the container lifecycle"

for allowed in CONTAINERS NETWORKS EVENTS INFO VERSION PING POST ALLOW_START ALLOW_STOP ALLOW_RESTARTS; do
  it "$allowed is granted"
  assert_contains "$(web_proxy)" "$allowed: \"1\""
done

for denied in IMAGES VOLUMES EXEC BUILD SYSTEM SECRETS CONFIGS SWARM NODES SERVICES TASKS PLUGINS SESSION AUTH COMMIT DISTRIBUTION GRPC ALLOW_PAUSE ALLOW_UNPAUSE; do
  it "$denied is denied"
  assert_contains "$(web_proxy)" "$denied: \"0\""
done

describe "the panel's control network is private"

it "the panel network is internal"
assert_contains "$(cat compose.web.yaml)" "internal: true"

it "the panel is not routed by default"
assert_contains "$(cat compose.web.yaml)" 'traefik.enable: "false"'

it "routing it is a separate, opt-in overlay"
assert_contains "$(cat compose.web-vpn.yaml)" 'traefik.enable: "true"'

it "the panel binds loopback in the example configuration"
assert_contains "$(cat .env.example)" "DEV_GATEWAY_WEB_BIND_ADDRESS=127.0.0.1"

it "and is off by default"
assert_contains "$(cat .env.example)" "DEV_GATEWAY_WEB=false"

describe "the API cannot reach a Docker endpoint it does not name"

allowlist="web/src/server/docker/allowlist.ts"

it "the allowlist file exists"
assert_success test -f "$allowlist"

for forbidden in "/exec" "/images" "/volumes" "/build" "/system" "/secrets" "prune" "archive"; do
  it "no allowlist rule mentions $forbidden"
  assert_eq "" "$(grep -n "pattern:.*$forbidden" "$allowlist" || true)"
done

it "container removal is the only DELETE"
assert_eq "1" "$(grep -c "method: 'DELETE'" "$allowlist" || true)"

it "creation is limited to one endpoint"
assert_eq "1" "$(grep -c "containers\\\\/create" "$allowlist" || true)"

describe "a removal takes the container and nothing else"

client="web/src/server/docker/client.ts"

it "volumes are never removed alongside a container"
assert_contains "$(cat "$client")" "v: '0'"

it "links are never removed either"
assert_contains "$(cat "$client")" "link: '0'"

it "and the client refuses a request that asks for them"
assert_contains "$(cat "$client")" "the panel never removes volumes or links alongside a container"

it "the created bridge mounts nothing from the host"
assert_contains "$(cat "$client")" "Binds: []"

it "and is never privileged"
assert_contains "$(cat "$client")" "Privileged: false"

describe "secrets stay on the host"

it "secret settings are declared as such"
assert_contains "$(cat web/src/server/core/settings.ts)" "secret: true"

it "the config view never returns a secret value"
assert_contains "$(cat web/src/server/core/configview.ts)" "value: secret ? null : stored"

describe "the CLI drives it"

it "web is a command"
assert_success sh -c './bin/dev-gateway web --help >/dev/null 2>&1'

it "publishing the panel publicly is refused outright"
assert_contains "$(./bin/dev-gateway web up --expose public 2>&1)" "never published on the internet"

it "an unknown expose value fails"
assert_failure ./bin/dev-gateway web up --expose nonsense

describe "the panel is routed only behind a credential"

it "the vpn overlay names a middleware"
assert_contains "$(cat compose.web-vpn.yaml)" "dev-gateway-web-auth@file"

for key in DEV_GATEWAY_WEB_AUTH DEV_GATEWAY_WEB_AUTH_USER DEV_GATEWAY_WEB_AUTH_HASH; do
  it "$key is in the example configuration"
  assert_contains "$(cat .env.example)" "$key="
done

it "authentication is off by default, because loopback needs none"
assert_contains "$(cat .env.example)" "DEV_GATEWAY_WEB_AUTH=none"

it "the hash is declared a secret, so the API never returns it"
assert_contains "$(sed -n '/DEV_GATEWAY_WEB_AUTH_HASH/,/},/p' web/src/server/core/settings.ts)" "secret: true"

it "routing the panel without a credential is refused by the profile resolver"
assert_contains "$(cat scripts/lib/docker.sh)" "the routed panel has no credential in front of it"

it "and by web up"
out=$(DEV_GATEWAY_WEB_AUTH=none ./bin/dev-gateway web up --expose vpn 2>&1 || true)
assert_contains "$out" "a routed panel needs a credential"

it "doctor fails a routed panel without one"
assert_contains "$(cat scripts/doctor.sh)" "with nothing in front of it"

it "the password never reaches a command line, where ps would show it"
assert_eq "" "$(grep -n 'passwd -apr1' scripts/cmd/web.sh | grep -v -- '-stdin' || true)"

describe "the panel writes two filenames into Traefik's dynamic directory"

dynamic="web/src/server/core/dynamic.ts"

it "the writer exists"
assert_success test -f "$dynamic"

it "the allowlist names exactly two files"
assert_eq "2" "$(grep -cE "^  (panel|shares): 'dev-gateway-[a-z]+\.yaml'," "$dynamic")"

for owned in "middlewares.yaml" "tcp.yaml" "local-tls.yaml" "auth.yaml" "acme.json"; do
  it "$owned stays the user's"
  assert_eq "" "$(grep -n "GENERATED_FILES.*$owned" "$dynamic" || true)"
done

it "the generated files are git-ignored: they carry a password hash"
assert_contains "$(cat .gitignore)" "config/traefik/dynamic/dev-gateway-panel.yaml"

it "the panel mounts the dynamic directory and nothing wider"
assert_contains "$(cat compose.web.yaml)" "./config/traefik/dynamic:/app/state/traefik-dynamic"

it "no project directory is mounted into the panel"
assert_eq "" "$(sed -n '/^    volumes:/,/^    networks:/p' compose.web.yaml | grep -E '^\s+- \./(examples|\.\.)' || true)"

describe "the panel reads Traefik, and only reads it"

traefik="web/src/server/core/traefik.ts"

it "the client exists"
assert_success test -f "$traefik"

it "it reaches Traefik over the shared network, not the control one"
assert_eq "" "$(grep -n 'control' web/src/server/config.ts | grep -i traefik || true)"

it "and resolves the host from the attachment, because Traefik has no name of its own inside tailscale"
assert_contains "$(cat web/src/server/config.ts)" "http://\${attached}:8080"

for method in POST PUT PATCH DELETE; do
  it "no $method is ever sent to the Traefik API"
  assert_eq "" "$(grep -n "method: '$method'" "$traefik" || true)"
done

it "the dashboard is linked to, never embedded"
assert_eq "" "$(grep -rn 'iframe' web/src/ui/ || true)"

it "the verdict has its own timeout, so a dead Traefik cannot hang a request"
assert_contains "$(cat "$traefik")" "AbortSignal.timeout"

it "and its own cache, never the snapshot's"
assert_contains "$(cat "$traefik")" "createVerdictCache"

describe "the CLI and the panel render the same middleware, byte for byte"

it "a drift between the two would lock the user out"
if ! command -v node >/dev/null 2>&1; then
  skip "node not installed"
else
  tmp=$(mktemp -d)
  (
    DEV_GATEWAY_WEB_AUTH=basic \
    DEV_GATEWAY_WEB_AUTH_USER=dev \
    DEV_GATEWAY_WEB_AUTH_HASH='$apr1$abcdefgh$ckT15POyCRlen.h6XtGAZ1' \
    DG_ROOT="$DG_ROOT" bash -c '
      . scripts/lib/common.sh; . scripts/lib/docker.sh
      . scripts/lib/toolbox.sh; . scripts/cmd/web.sh
      dg_web_auth_render && cat "$(dg_web_auth_path)"'
  ) > "$tmp/cli.yaml" 2>/dev/null
  ( cd web && node --experimental-strip-types -e "
      import('./src/server/core/dynamic.ts').then((m) =>
        process.stdout.write(m.renderPanelAuth({ user: 'dev', hash: '\$apr1\$abcdefgh\$ckT15POyCRlen.h6XtGAZ1' })))
    " ) > "$tmp/panel.yaml" 2>/dev/null
  assert_eq "$(cat "$tmp/panel.yaml")" "$(cat "$tmp/cli.yaml")"
  rm -rf "$tmp"
fi

describe "the panel is containerised, and the host needs no Node"

it "the image builds the UI and the server"
assert_contains "$(cat web/Dockerfile)" "npm run build"

it "the runtime stage carries no source"
assert_contains "$(cat web/Dockerfile)" "COPY --from=build /app/dist ./dist"

it "and no Docker CLI"
assert_eq "" "$(grep -n 'docker-cli\|docker.sock' web/Dockerfile || true)"

t_summary
