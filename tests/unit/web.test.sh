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

describe "the panel database is private and durable"

it "uses a pinned PostgreSQL image"
assert_contains "$(cat compose.db.yaml)" "image: postgres:18.6-alpine"

it "publishes no host port"
assert_eq "" "$(grep -E '^\s+ports:' compose.db.yaml || true)"

it "has its own internal network"
assert_contains "$(cat compose.db.yaml)" "name: \${DEV_GATEWAY_DB_NETWORK:-dev-gateway-data}"
assert_contains "$(cat compose.db.yaml)" "internal: true"

it "never joins the shared HTTP network"
assert_eq "" "$(grep -n 'DEV_GATEWAY_NETWORK' compose.db.yaml || true)"

it "uses a named, gateway-owned volume"
assert_contains "$(cat compose.db.yaml)" "name: \${DEV_GATEWAY_DB_VOLUME:-dev-gateway-db}"
assert_contains "$(cat compose.db.yaml)" 'dev-gateway.component: db-volume'

it "the overlay follows the panel"
assert_contains "$(DEV_GATEWAY_WEB=true DG_WEB_DB_PASSWORD=test bash -c '. scripts/lib/common.sh; . scripts/lib/docker.sh; dg_defaults; dg_compose_files local')" "compose.db.yaml"

it "the password is generated and declared secret"
assert_contains "$(cat scripts/bootstrap.sh)" "dg_env_set DG_WEB_DB_PASSWORD"
assert_contains "$(sed -n '/DG_WEB_DB_PASSWORD/,/},/p' apps/web/src/server/core/settings.ts)" "secret: true"

it "doctor refuses a published or shared database"
assert_contains "$(cat scripts/doctor.sh)" "db.exposure"
assert_contains "$(cat scripts/doctor.sh)" "db.network.shared"

describe "the panel database has private operational tooling"

db_clients="packages/cli/src/commands/clients.ts"

for command in status shell dump restore; do
  it "db $command is documented"
  assert_contains "$(./bin/dev-gateway db --help 2>&1)" "  $command"
done

it "the clients join only the private data network"
assert_contains "$(cat "$db_clients")" "context.config.databaseNetwork"

it "the password is inherited instead of placed on the command line"
assert_contains "$(cat "$db_clients")" "'-e', 'PGPASSWORD'"

it "the password never appears in client arguments"
assert_eq "" "$(grep -n -- '--password\|postgres://.*DG_WEB_DB_PASSWORD' "$db_clients" || true)"

it "dumps use PostgreSQL's restorable custom format"
assert_contains "$(cat "$db_clients")" "--format=custom"

it "restore is guarded by a confirmation"
assert_contains "$(cat "$db_clients")" "await confirm('restore the panel database?"

describe "the API cannot reach a Docker endpoint it does not name"

allowlist="apps/web/src/server/docker/allowlist.ts"

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

client="apps/web/src/server/docker/client.ts"

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
assert_contains "$(cat apps/web/src/server/core/settings.ts)" "secret: true"

it "the config view never returns a secret value"
assert_contains "$(cat apps/web/src/server/core/configview.ts)" "value: secret ? null : stored"

describe "the CLI drives it"

it "web is a command"
assert_success sh -c './bin/dev-gateway web --help >/dev/null 2>&1'

it "publishing the panel publicly is refused outright"
assert_contains "$(./bin/dev-gateway web up --expose public 2>&1)" "local or vpn"

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
assert_contains "$(sed -n '/DEV_GATEWAY_WEB_AUTH_HASH/,/},/p' apps/web/src/server/core/settings.ts)" "secret: true"

it "routing the panel without a credential is refused by the profile resolver"
assert_contains "$(cat scripts/lib/docker.sh)" "the routed panel has no credential in front of it"

it "and by web up"
out=$(DEV_GATEWAY_WEB_AUTH=none ./bin/dev-gateway web up --expose vpn 2>&1 || true)
assert_contains "$out" "a routed panel needs a credential"

it "doctor fails a routed panel without one"
assert_contains "$(cat scripts/doctor.sh)" "with nothing in front of it"

it "the password never reaches a command line, where ps would show it"
assert_contains "$(cat packages/cli/src/commands/web.ts)" "['passwd', '-apr1', '-stdin']"
assert_eq "" "$(grep -nE "\['passwd',[^]]*password" packages/cli/src/commands/web.ts || true)"

describe "the panel writes three filenames into Traefik's dynamic directory"

dynamic="apps/web/src/server/core/dynamic.ts"

it "the writer exists"
assert_success test -f "$dynamic"

it "the allowlist names exactly three files"
assert_eq "3" "$(grep -cE "^  (panel|shares|aliases): 'dev-gateway-[a-z]+\.yaml'," "$dynamic")"

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

traefik="apps/web/src/server/core/traefik.ts"

it "the client exists"
assert_success test -f "$traefik"

it "it reaches Traefik over the shared network, not the control one"
assert_eq "" "$(grep -n 'control' apps/web/src/server/config.ts | grep -i traefik || true)"

it "and resolves the host from the attachment, because Traefik has no name of its own inside tailscale"
assert_contains "$(cat apps/web/src/server/config.ts)" "http://\${attached}:8080"

for method in POST PUT PATCH DELETE; do
  it "no $method is ever sent to the Traefik API"
  assert_eq "" "$(grep -n "method: '$method'" "$traefik" || true)"
done

it "the dashboard is linked to, never embedded"
assert_eq "" "$(grep -rn 'iframe' apps/web/src/ui/ || true)"

it "the verdict has its own timeout, so a dead Traefik cannot hang a request"
assert_contains "$(cat "$traefik")" "AbortSignal.timeout"

it "and its own cache, never the snapshot's"
assert_contains "$(cat "$traefik")" "createVerdictCache"

describe "the CLI and the panel render the same middleware contract"

it "both surfaces import the core renderer"
assert_contains "$(cat packages/cli/src/commands/web.ts)" "renderSharedPanelAuth"
assert_contains "$(cat apps/web/src/server/core/dynamic.ts)" "renderSharedPanelAuth"
it "the middleware has one canonical definition"
assert_eq "1" "$(grep -R --include='*.ts' -l "PANEL_AUTH_MIDDLEWARE = 'dev-gateway-web-auth'" packages apps | wc -l | tr -d ' ')"

describe "the panel is containerised, and the host needs no Node"

it "the image builds the UI and the server"
assert_contains "$(cat apps/web/Dockerfile)" "npm run build"

it "the runtime stage carries no source"
assert_contains "$(cat apps/web/Dockerfile)" "COPY --from=build /app/apps/web/dist ./apps/web/dist"

it "and no Docker CLI"
assert_eq "" "$(grep -n 'docker-cli\|docker.sock' apps/web/Dockerfile || true)"

t_summary
