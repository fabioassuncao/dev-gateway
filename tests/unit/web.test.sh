#!/usr/bin/env bash
# ============================================================================
# The web panel: the invariants that make it safe to run
# ============================================================================
# The panel is the one component that can start, stop and remove containers,
# so what it CANNOT do matters more than what it can. These assertions are the
# enforcement; docs/web-ui.md is the explanation.
# ============================================================================
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
cd "$PORTTA_ROOT" || exit 1

web_proxy() { sed -n '/^  web-socket-proxy:/,/^  web:/p' docker/compose/features/web.yaml; }

describe "the panel gets its own socket proxy, not Traefik's"

it "Traefik's proxy still denies every write"
assert_contains "$(cat docker/compose/compose.yaml)" 'POST: "0"'

it "the panel's proxy is a separate service"
assert_contains "$(cat docker/compose/features/web.yaml)" "web-socket-proxy:"

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
assert_contains "$(cat docker/compose/features/web.yaml)" "internal: true"

it "the panel is not routed by default"
assert_contains "$(cat docker/compose/features/web.yaml)" 'traefik.enable: "false"'

it "routing it is a separate, opt-in overlay"
assert_contains "$(cat docker/compose/features/web-vpn.yaml)" 'traefik.enable: "true"'

it "the panel binds loopback in the example configuration"
assert_contains "$(cat .env.example)" "PORTTA_WEB_BIND_ADDRESS=127.0.0.1"

it "and is off by default"
assert_contains "$(cat .env.example)" "PORTTA_WEB=false"

describe "the panel database is private and durable"

it "uses a pinned PostgreSQL image"
assert_contains "$(cat docker/compose/features/db.yaml)" "image: postgres:18.6-alpine"

it "publishes no host port"
assert_eq "" "$(grep -E '^\s+ports:' docker/compose/features/db.yaml || true)"

it "has its own internal network"
assert_contains "$(cat docker/compose/features/db.yaml)" "name: \${PORTTA_DB_NETWORK:-portta-data}"
assert_contains "$(cat docker/compose/features/db.yaml)" "internal: true"

it "never joins the shared HTTP network"
assert_eq "" "$(grep -n 'PORTTA_NETWORK' docker/compose/features/db.yaml || true)"

it "uses a named, gateway-owned volume"
assert_contains "$(cat docker/compose/features/db.yaml)" "name: \${PORTTA_DB_VOLUME:-portta-db}"
assert_contains "$(cat docker/compose/features/db.yaml)" 'portta.component: db-volume'

it "the overlay follows the panel"
assert_contains "$(PORTTA_WEB=true PORTTA_RUNTIME_DB_PASSWORD=test bash -c '. scripts/lib/common.sh; . scripts/lib/docker.sh; portta_defaults; portta_compose_files local')" "docker/compose/features/db.yaml"

it "the password is generated and declared secret"
assert_contains "$(cat scripts/bootstrap.sh)" "portta_env_set PORTTA_RUNTIME_DB_PASSWORD"
assert_contains "$(sed -n '/PORTTA_RUNTIME_DB_PASSWORD/,/},/p' apps/web/src/server/core/settings.ts)" "secret: true"

it "doctor refuses a published or shared database"
assert_contains "$(cat scripts/doctor.sh)" "db.exposure"
assert_contains "$(cat scripts/doctor.sh)" "db.network.shared"

describe "the panel database has private operational tooling"

db_clients="packages/cli/src/commands/clients.ts"

for command in status shell dump restore; do
  it "db $command is documented"
  assert_contains "$(./bin/portta db --help 2>&1)" "  $command"
done

it "the clients join only the private data network"
assert_contains "$(cat "$db_clients")" "context.config.databaseNetwork"

it "the password is inherited instead of placed on the command line"
assert_contains "$(cat "$db_clients")" "'-e', 'PGPASSWORD'"

it "the password never appears in client arguments"
assert_eq "" "$(grep -n -- '--password\|postgres://.*PORTTA_RUNTIME_DB_PASSWORD' "$db_clients" || true)"

it "dumps use PostgreSQL's restorable custom format"
assert_contains "$(cat "$db_clients")" "--format=custom"

it "restore is guarded by a confirmation"
assert_contains "$(cat "$db_clients")" "await confirm('restore the panel database?"

describe "the API cannot reach a Docker endpoint it does not name"

allowlist="apps/web/src/server/docker/allowlist.ts"

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

# `public` is a supported mode since ADR 0021, and it is the one the installer
# offers first. What is refused is reaching the panel from another machine with
# nothing in front of it.
it "publishing the panel publicly without a credential is refused"
assert_contains "$(./bin/portta web up --expose public 2>&1)" "needs a credential"

it "an unknown expose value fails"
assert_failure ./bin/portta web up --expose nonsense

describe "the panel is handed the settings it renders"

# The panel container gets an explicit list of variables, so a setting added to
# the gateway is invisible to the Settings page until it is added here too. The
# domain mode was, and the page showed the resolved hostname with `mode: local`
# beside it.
it "every managed setting the panel reads is passed to its container"
compose="$(cat docker/compose/features/web.yaml)"
for key in PORTTA_DOMAIN PORTTA_DOMAIN_MODE PORTTA_PUBLIC_IP PORTTA_AUTO_DOMAIN_PROVIDER; do
  assert_contains "$compose" "$key: \${$key"
done

# A field the Settings page validates and flags a restart for, whose value the
# container never sees, is worse than no field: GITHUB_APP_PRIVATE_KEY_FILE was
# a literal here, so doctor read the .env and the panel read app.pem, and the
# two could certify different files.
it "the GitHub App key path the panel reads is the one .env sets"
for key in GITHUB_APP_ENABLED GITHUB_APP_ID GITHUB_APP_PRIVATE_KEY_FILE GITHUB_APP_WEBHOOK_SECRET GITHUB_API_URL; do
  assert_contains "$compose" "$key: \${$key"
done

it "and the operator who sets nothing keeps today's path"
assert_contains "$compose" 'GITHUB_APP_PRIVATE_KEY_FILE: ${GITHUB_APP_PRIVATE_KEY_FILE:-/app/state/github/app.pem}'

# The mount is what makes the setting expressible at all: the directory is
# fixed because this is the only place the key comes from, and the filename is
# free because the whole directory is mounted, not one file in it.
it "the key still comes from one read-only directory, not one filename"
assert_contains "$compose" './state/github:/app/state/github:ro'

it "the panel refuses a path it could not open, naming that directory"
assert_contains "$(cat apps/web/src/server/core/settings.ts)" "the directory mounted into the panel"

it "and doctor refuses the same paths rather than checking the host for them"
assert_contains "$(cat scripts/doctor.sh)" "is outside /app/state/github/"

describe "every panel command resolves the file list with the panel enabled"

# The environment beats .env, so an inherited PORTTA_WEB=false drops the
# overlays that define these services. Compose then answers "no such service",
# which these callers ignore on purpose, and the command reports success while
# doing nothing: `web down` left the panel running.
it "the shared compose helper passes the override"
assert_contains "$(sed -n '/^async function webCompose/,/^}/p' packages/cli/src/commands/web.ts)" "overrides: PANEL_OVERRIDES"

it "and so does web down, with the dev pair included"
assert_contains "$(sed -n '/^export async function webDown/,/^}/p' packages/cli/src/commands/web.ts)" "PORTTA_WEB_DEV: 'true'"
assert_contains "$(sed -n '/^export async function webDown/,/^}/p' packages/cli/src/commands/web.ts)" "overrides:"

it "and web up uses what it just wrote"
assert_contains "$(sed -n '/^export async function webUp/,/^}/p' packages/cli/src/commands/web.ts)" "overrides: values"

describe "a public panel is published by Traefik, never by the container"

it "the public overlay gives the panel its own entrypoint"
assert_contains "$(cat docker/compose/features/panel-public.yaml)" "TRAEFIK_ENTRYPOINTS_PANEL_ADDRESS"

it "and attaches the panel router to that entrypoint only"
assert_contains "$(cat docker/compose/features/panel-public.yaml)" "traefik.http.routers.portta-panel.entrypoints: panel"

it "behind the same ForwardAuth middleware the vpn mode uses"
assert_contains "$(cat docker/compose/features/panel-public.yaml)" "portta-forward-auth@file"

it "the panel container publishes no host port of its own there"
assert_eq "" "$(sed -n '/^  web:/,$p' docker/compose/features/panel-public.yaml | grep -E '^\s+ports:' || true)"

it "so exactly one overlay owns the panel port"
assert_contains "$(cat packages/core/src/config.ts)" "panel-public.yaml"
assert_contains "$(cat packages/core/src/config.ts)" "web-bind.yaml"
assert_contains "$(cat scripts/lib/docker.sh)" "features/panel-public.yaml"
assert_contains "$(cat scripts/lib/docker.sh)" "features/web-bind.yaml"

it "and publishing the panel publishes no application entrypoint"
# The router is scoped to `panel`; nothing here touches web or websecure.
assert_eq "" "$(grep -E 'entrypoints: (web|websecure)' docker/compose/features/panel-public.yaml || true)"

describe "the panel is routed only behind a credential"

it "the vpn overlay names a middleware"
assert_contains "$(cat docker/compose/features/web-vpn.yaml)" "portta-forward-auth@file"

for key in PORTTA_WEB_AUTH PORTTA_WEB_AUTH_USER PORTTA_WEB_AUTH_HASH; do
  it "$key is in the example configuration"
  assert_contains "$(cat .env.example)" "$key="
done

it "authentication is off by default, because loopback needs none"
assert_contains "$(cat .env.example)" "PORTTA_WEB_AUTH=none"

it "the disposable auth migrator gets explicit write mounts without weakening the service"
auth_prepare="$(cat scripts/lib/auth.sh)"
auth_services="$(sed -n '/^  portta-auth:/,/^  socket-proxy:/p' docker/compose/compose.yaml)"
assert_contains "$auth_prepare" 'portta-auth-migrate'
assert_contains "$auth_prepare" '--user "$(id -u):$(id -g)"'
assert_contains "$auth_services" './state/auth:/app/state/auth:ro'
assert_contains "$auth_services" './state/auth:/app/state/auth:rw'
assert_contains "$auth_services" './config/traefik/dynamic:/app/state/traefik-dynamic:rw'
assert_contains "$auth_services" 'profiles: [migration]'
assert_contains "$auth_services" 'network_mode: none'

it "the hash is declared a secret, so the API never returns it"
assert_contains "$(sed -n '/PORTTA_WEB_AUTH_HASH/,/},/p' apps/web/src/server/core/settings.ts)" "secret: true"

it "routing the panel without a credential is refused by the profile resolver"
assert_contains "$(cat scripts/lib/docker.sh)" "the panel is reachable beyond this host with no credential in front of it"

it "and by web up"
out=$(PORTTA_WEB_AUTH=none ./bin/portta web up --expose vpn 2>&1 || true)
assert_contains "$out" "needs a credential"

it "doctor fails a routed panel without one"
assert_contains "$(cat scripts/doctor.sh)" "with nothing in front of it"

it "doctor checks every ForwardAuth prerequisite"
doctor_source="$(cat scripts/doctor.sh)"
for id in auth.secret auth.store auth.service; do
  assert_contains "$doctor_source" "$id"
done
assert_contains "$doctor_source" "PORTTA_AUTH_SECRET is unset"
assert_contains "$doctor_source" "credentials must be owner-only"
assert_contains "$doctor_source" "authentication service"

# `portta bootstrap` ends by running doctor, on a host where nothing has been
# started yet. Both auth checks failed on that, so bootstrap exited 1 and every
# CI job that boots the gateway died before `up`. A component that does not
# exist yet is a warning, which is the rule traefik.state already followed; a
# component in a bad state stays a failure.
it "doctor separates an unstarted auth component from a broken one"
assert_contains "$doctor_source" 'check warn auth.store "authentication store" "not created yet"'
assert_contains "$doctor_source" 'check warn auth.service "authentication service" "container not created"'
assert_contains "$doctor_source" 'check fail auth.store "authentication store" "missing while the service is running"'
assert_contains "$doctor_source" 'check warn traefik.state "traefik" "container not created"'

it "the password never reaches a command line, where ps would show it"
assert_contains "$(cat packages/cli/src/commands/web.ts)" "hashPassword(password)"
assert_eq "" "$(grep -nE "runProcess\([^]]*password" packages/cli/src/commands/web.ts || true)"

describe "the panel writes four filenames into Traefik's dynamic directory"

dynamic="apps/web/src/server/core/dynamic.ts"

it "the allowlist names exactly four files"
assert_eq "4" "$(grep -cE "^  (panel|shares|aliases|auth): 'portta-[a-z]+\.yaml'," "$dynamic")"

for owned in "middlewares.yaml" "tcp.yaml" "local-tls.yaml" "auth.yaml" "acme.json"; do
  it "$owned stays the user's"
  assert_eq "" "$(grep -n "GENERATED_FILES.*$owned" "$dynamic" || true)"
done

it "the generated files are git-ignored because they are runtime state"
assert_contains "$(cat .gitignore)" "config/traefik/dynamic/portta-panel.yaml"

it "the panel mounts the dynamic directory and nothing wider"
assert_contains "$(cat docker/compose/features/web.yaml)" "./config/traefik/dynamic:/app/state/traefik-dynamic"

it "no project directory is mounted into the panel"
assert_eq "" "$(sed -n '/^    volumes:/,/^    networks:/p' docker/compose/features/web.yaml | grep -E '^\s+- \./(docker/examples|examples|\.\.)' || true)"

describe "the panel reads Traefik, and only reads it"

traefik="apps/web/src/server/core/traefik.ts"

it "it reaches Traefik over the shared network, not the control one"
assert_eq "" "$(grep -n 'control' apps/web/src/server/config.ts | grep -i traefik || true)"

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
assert_eq "1" "$(grep -R --include='*.ts' -l "PANEL_AUTH_MIDDLEWARE = 'portta-web-auth'" packages apps | wc -l | tr -d ' ')"

describe "the panel is containerised, and the host needs no Node"

it "the image builds the UI and the server"
assert_contains "$(cat apps/web/Dockerfile)" "npm run build"

it "the runtime stage carries no source"
assert_contains "$(cat apps/web/Dockerfile)" "COPY --from=build /app/apps/web/dist ./apps/web/dist"

it "and no Docker CLI"
assert_eq "" "$(grep -n 'docker-cli\|docker.sock' apps/web/Dockerfile || true)"

# The shared package is a workspace symlink, so every stage that resolves
# portta-core needs its files. Each assertion below stands for a way the
# panel has actually failed to start or to build.

it "the build stage copies the config the shared package builds through"
assert_contains "$(cat apps/web/Dockerfile)" "packages/core/tsconfig.build.json"

it "and the auth package's matching build config"
assert_contains "$(cat apps/web/Dockerfile)" "apps/auth/tsconfig.build.json"

it "the dev stage carries the shared package's source, which it never builds"
assert_contains "$(sed -n '/AS dev/,/AS runtime/p' apps/web/Dockerfile)" "COPY packages/core/src ./packages/core/src"

it "the dev stage starts through the package script, which owns the export condition"
assert_contains "$(sed -n '/AS dev/,/AS runtime/p' apps/web/Dockerfile)" 'CMD ["npm", "run", "dev"]'

it "the dev script resolves the development export condition"
assert_contains "$(cat apps/web/package.json)" "--conditions=development"

describe "the panel in development mode"

it "runs the package script rather than restating its flags"
assert_contains "$(cat docker/compose/features/web-dev.yaml)" 'command: ["npm", "run", "dev"]'

it "mounts the shared package so editing it reloads the panel"
assert_contains "$(cat docker/compose/features/web-dev.yaml)" "./packages/core/src:/app/packages/core/src"

it "publishes the UI on its own port, which is where the panel answers"
assert_contains "$(cat docker/compose/features/web-dev.yaml)" "PORTTA_WEB_DEV_PORT:-5173"

it "the checkout migrator builds the auth image before running"
assert_contains "$(sed -n '/export function authMigrationRunArguments/,/^}/p' packages/cli/src/commands/lifecycle.ts)" "'--build'"

t_summary
