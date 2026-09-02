#!/usr/bin/env bash
# ============================================================================
# Audit: invariants that must not regress
# ============================================================================
# These are the promises the gateway makes about what it will never do. Each
# was verified by hand once; this keeps them true.
# ============================================================================
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
cd "$PORTTA_ROOT" || exit 1

# Tracked files, excluding the build brief and this file.
#
# This file is excluded because it contains every forbidden pattern as a search
# string (`docker system prune`, an absolute home path, `tskey-`) and would
# otherwise match itself. That is a real limitation: the audit cannot audit its
# own text, so keep the patterns here and the enforcement here only.
SELF="tests/unit/audit.test.sh"
tracked() { git ls-files "$@" 2>/dev/null | grep -v '^docs/prompts/' | grep -vx "$SELF"; }
code() { git ls-files 'bin/*' 'scripts/**' 'docker/**' '.github/**' 2>/dev/null | grep -vx "$SELF"; }

describe "the gateway stays decoupled from consumer projects"

it "no absolute home paths are baked in"
assert_eq "" "$(tracked | xargs grep -ln '/Users/\|/home/[a-z]' 2>/dev/null || true)"

it "no consumer project is named in the code"
# Names may appear in prose as examples; code must be vendor-neutral.
assert_eq "" "$(code | xargs grep -lni 'brasil.data.hub\|base-empresarial\|base-eleicoes\|base-escolar\|issue-flow' 2>/dev/null || true)"

it "nothing clones a consumer project"
assert_eq "" "$(code | xargs grep -ln 'git clone' 2>/dev/null | grep -v 'scripts/cmd/remote.sh' || true)"

it "no consumer directory is mounted into the gateway"
# Only these mounts are legitimate here, and all of them are gateway-owned:
#   ./config, ./state          the gateway's own directories
#   ./.env, ./VERSION          the configuration the panel's Settings page edits
#   ./apps/web/                the panel's own source, in development mode
#   ./packages/core/           the workspace the panel imports, in development mode
#   /var/run/docker.sock       read-only, into a socket proxy and nothing else
#   /dev/net/tun               Tailscale's kernel networking
# Anything else would be reaching into somebody's project.
# A bind mount is `src:dst`; a tmpfs entry has no colon, so require one.
assert_eq "" "$(grep -hE '^\s+- [./][^ ]*:' docker/compose/compose.yaml docker/compose/*/*.yaml \
  | grep -vE '\./(config|state|apps|packages)/' \
  | grep -vE '\./(\.env|VERSION):' \
  | grep -vE '/var/run/docker\.sock:/var/run/docker\.sock:ro' \
  | grep -vE '/dev/net/tun:/dev/net/tun' || true)"

describe "the applier is bounded by construction"

# One container on this host may drive Compose, and this is the whole of what
# keeps it from becoming a general remote-execution channel.
# See docs/adr/0026-applying-settings-from-the-panel.md.

it "only the applier mounts the docker socket writable, and only it"
# Everywhere else the socket is `:ro`, into a socket proxy. The compose audit
# above cannot see this one, because the applier is not a compose service.
assert_eq "scripts/lib/apply.sh" "$(code | xargs grep -ln 'docker\.sock:/var/run/docker\.sock[^:]*$' 2>/dev/null || true)"

it "the applier is not a compose service"
# A compose applier would be an orphan the moment PORTTA_APPLY went false, and
# would remove itself in the middle of the `up` it was running.
assert_eq "" "$(grep -rn 'portta-apply\|component: apply' docker/compose/ 2>/dev/null || true)"

it "the applier carries no compose project label"
# Set, not merely named: both files explain in prose why the label is absent.
assert_eq "" "$(grep -nE '(--label|label=)[^ ]*com\.docker\.compose' scripts/lib/apply.sh packages/core/src/apply.ts 2>/dev/null || true)"

it "the applier command is fixed, never composed from input"
assert_contains "$(cat scripts/lib/apply.sh)" 'bash "$PORTTA_ROOT/bin/portta" up --wait'
assert_eq "" "$(grep -n 'PORTTA_APPLY_COMMAND\|APPLY_ARGS\|APPLY_PROFILE' scripts/lib/apply.sh || true)"

it "the applier bakes in no profile, so a profile change applies to itself"
assert_eq "" "$(grep -nE 'up.*(local|remote-private|remote-public)' scripts/lib/apply.sh || true)"

it "the applier mounts the root at its host path, and nothing else"
assert_contains "$(cat scripts/lib/apply.sh)" '"$PORTTA_ROOT:$PORTTA_ROOT"'
assert_eq "2" "$(grep -c -- '--volume' scripts/lib/apply.sh)"

it "the applier has no network and is never disposable"
assert_contains "$(cat scripts/lib/apply.sh)" '--network none'
assert_eq "" "$(grep -n -- '--rm' scripts/lib/apply.sh || true)"

it "removing the applier checks ownership first"
assert_contains "$(cat scripts/lib/apply.sh)" 'portta_container_is_managed'

it "the panel cannot enable the applier"
# Turning it on is a host decision: the key is deliberately absent from the
# catalogue of everything the Settings page may write.
assert_eq "" "$(grep -n \"PORTTA_APPLY\" apps/web/src/server/core/settings.ts || true)"

it "the panel gains no new Docker permission for it"
# start, inspect and logs were already allowed; that is the whole point. Four
# POST rules and one create, exactly as before this feature existed.
assert_eq "4" "$(grep -c "method: 'POST'" apps/web/src/server/docker/allowlist.ts)"
assert_eq "1" "$(grep -c 'containers..create' apps/web/src/server/docker/allowlist.ts)"

describe "every job that runs the panel end to end builds what it imports"

# The Playwright web server runs the *built* panel, which imports portta-core
# through its `dist`. A job that runs that suite without building the package
# dies with ERR_MODULE_NOT_FOUND before a single test starts. Two jobs carried
# the build and a third did not, and nobody could tell: the step was never
# reached while the suite hung.
it "no e2e job runs the panel suite without building portta-core"
assert_eq "" "$(python3 - <<'PORTTA_PY'
import yaml
spec = yaml.safe_load(open(".github/workflows/ci.yaml"))
bad = []
for name, job in spec["jobs"].items():
    runs = " ".join(step.get("run", "") for step in job.get("steps", []))
    if "test:e2e" in runs and "build --workspace=portta-core" not in runs:
        bad.append(name)
print(" ".join(bad))
PORTTA_PY
)"

describe "file modes are read portably"

# `stat -f` means "file system status" to GNU stat: it exits 0 and prints
# something else entirely, so a BSD-first fallback returns nonsense on Linux
# rather than failing over. Every permission assertion built that way passed
# against garbage. portta_file_mode in scripts/lib/common.sh is the one
# implementation, and it tries GNU first.
it "nothing reads a mode with BSD stat first"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' 'tests/**' | xargs grep -ln "stat -f" 2>/dev/null \
  | grep -v 'scripts/lib/common.sh' | grep -v 'tests/unit/audit.test.sh' || true)"

describe "tests do not reach into procfs"

# `/proc` looks like a conveniently unwritable directory and is not: on Linux a
# recursive mkdir inside it never returns, and the spin is synchronous, so no
# test timeout can interrupt it. One such path hung the entire panel suite on
# every Linux CI run for hours while passing on macOS, where /proc does not
# exist. Use a path whose parent is a regular file instead: ENOTDIR, instantly,
# for every user including root.
# Assembled from pieces so this file does not match its own rule, the same way
# the prune audit below avoids naming its literals.
PROCFS_PATH="/pro""c/"
it "no test uses a procfs path to simulate a failure"
assert_eq "" "$(grep -rn -- "$PROCFS_PATH" apps/web/tests packages/*/src 2>/dev/null || true)"

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
  grep -q 'portta_container_is_managed' "$f" || offenders="$offenders $f"
done
assert_eq "" "$offenders"

it "compose down never takes volumes or orphans with it"
assert_eq "" "$(grep -n 'portta_compose .* down' bin/portta scripts/cmd/*.sh 2>/dev/null | grep -E '\-v|--volumes|--remove-orphans' || true)"

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
assert_contains "$(grep -A2 'TS_AUTHKEY' bin/portta | head -3)" "<set>"

describe "nothing is exposed by default"

it "the local profile binds loopback"
assert_contains "$(cat .env.example)" "PORTTA_BIND_ADDRESS=127.0.0.1"

it "public access is off in the example configuration"
assert_contains "$(cat .env.example)" "PUBLIC_ENABLED=false"

it "the dashboard is off in the example configuration"
assert_contains "$(cat .env.example)" "PORTTA_DASHBOARD=false"

it "traefik does not expose containers by default"
assert_contains "$(cat docker/compose/compose.yaml)" 'TRAEFIK_PROVIDERS_DOCKER_EXPOSEDBYDEFAULT: "false"'

it "the socket proxy publishes no host port"
assert_eq "" "$(sed -n '/socket-proxy:/,/^  [a-z]/p' docker/compose/compose.yaml | grep -E '^\s+ports:' || true)"

it "the socket proxy mounts the socket read-only"
assert_contains "$(cat docker/compose/compose.yaml)" "/var/run/docker.sock:/var/run/docker.sock:ro"

it "the socket proxy denies writes"
assert_contains "$(cat docker/compose/compose.yaml)" 'POST: "0"'

it "the control network is internal"
assert_contains "$(cat docker/compose/compose.yaml)" "internal: true"

it "the docker socket is never mounted into traefik"
assert_eq "" "$(sed -n '/^  traefik:/,$p' docker/compose/compose.yaml | grep 'docker.sock' || true)"

describe "SSH keeps host verification on"

it "StrictHostKeyChecking is never disabled"
assert_eq "" "$(tracked 'bin/*' 'scripts/**' | xargs grep -n 'StrictHostKeyChecking=no' 2>/dev/null || true)"

it "the default policy still refuses a changed host key"
assert_contains "$(cat scripts/cmd/remote.sh)" "accept-new"

describe "supply chain"

it "every image pins an explicit version"
# Multi-stage builds refer to their own earlier stages by name, and `FROM x AS y`
# carries the stage name on the end. Neither is an unpinned image.
#
# `image: ${PORTTA_WEB_IMAGE:-ghcr.io/…/portta:0.2.0}` is pinned too: the
# override exists so a developer can point at a local build, and the default
# is what a normal installation pulls. Unwrap the interpolation and judge the
# default the same way as a literal.
assert_eq "" "$(grep -rhE '^\s*(image|FROM):?\s' docker/compose/compose.yaml docker/compose/*/*.yaml docker/examples/*/compose*.yaml docker/images/*/Dockerfile apps/web/Dockerfile 2>/dev/null \
  | sed -E 's/[[:space:]]+[Aa][Ss][[:space:]]+[A-Za-z0-9_.-]+[[:space:]]*$//' \
  | sed -E 's/\$\{[A-Za-z0-9_]+:-([^}]*)\}/\1/g' \
  | grep -vE '^[[:space:]]*FROM[[:space:]]+(deps|base|build|dev|runtime)[[:space:]]*$' \
  | grep -vE ':[A-Za-z0-9][A-Za-z0-9._-]*[[:space:]]*$' || true)"

it "the panel image the installer pulls matches VERSION"
# A tag that drifts from VERSION means an installation pinned by the compose
# file would pull an image that was never published for it.
assert_contains "$(cat docker/compose/features/web.yaml)" "portta:$(tr -d '[:space:]' < VERSION)}"

it "no floating latest tag"
assert_eq "" "$(grep -rn ':latest' docker/compose/compose.yaml docker/compose/*/*.yaml docker/examples/*/compose*.yaml docker/images/*/Dockerfile apps/web/Dockerfile 2>/dev/null || true)"

it "the versions table in ADR 0004 lists every pinned image"
adr="docs/adr/0004-pinned-versions.md"
missing=""
for img in $(grep -rhoE 'image: [a-z0-9./_-]+' docker/compose/compose.yaml docker/compose/*/*.yaml docker/examples/*/compose*.yaml scripts/lib/discovery.sh 2>/dev/null \
             | awk '{print $2}' | sort -u); do
  grep -q "$(basename "$img")" "$adr" || missing="$missing $img"
done
assert_eq "" "$missing"


describe "the panel image build context excludes secrets and state"

it "the root dockerignore exists"
assert_success test -f .dockerignore

it "excludes .env, state/, TLS material and .git as whole lines"
ignore="$(grep -E '^(\.env|state|config/tls|\.git)$' .dockerignore | sort | paste -sd, -)"
assert_eq ".env,.git,config/tls,state" "$ignore"

it "the Dockerfile builds from the repository root"
assert_contains "$(cat apps/web/Dockerfile)" "COPY package.json package-lock.json ./"
# The build lives in the two overlays that are only ever applied inside a
# checkout. web.yaml itself pulls, because an installed PORTTA_HOME has no
# source tree to build from. See docs/adr/0020-installer-and-portta-home.md.
assert_contains "$(cat docker/compose/features/web-build.yaml)" "dockerfile: apps/web/Dockerfile"
assert_contains "$(cat docker/compose/features/web-dev.yaml)" "dockerfile: apps/web/Dockerfile"
assert_contains "$(cat docker/compose/features/auth-build.yaml)" "dockerfile: apps/web/Dockerfile"
assert_contains "$(cat docker/compose/features/auth-build.yaml)" "target: runtime"
assert_eq "" "$(grep -n 'portta-auth:' docker/compose/features/web-build.yaml || true)"

it "a normal installation never builds the panel"
assert_eq "" "$(grep -n 'build:' docker/compose/features/web.yaml || true)"

it "Make never pulls a published Portta image"
assert_eq "" "$(grep -E 'ghcr.io/fabioassuncao' Makefile || true)"

it "make dev calls the checkout setup command"
assert_contains "$(sed -n '/^dev:/,/^[^[:space:]#][^:]*:/p' Makefile)" '$(GW) dev'

it "the checkout setup command keeps Commander’s (arg, options, command) arity"
assert_contains "$(cat packages/cli/src/cli.ts)" 'devCommand(profile, command)'

it "the checkout setup never pulls the published image"
assert_contains "$(sed -n '/export async function devCommand/,/^export async function /p' packages/cli/src/commands/lifecycle.ts)" 'skipPull: true'
assert_contains "$(sed -n '/export function checkoutLocalEnv/,/^}/p' packages/cli/src/commands/lifecycle.ts)" 'LOCAL_PORTA_IMAGE'
assert_contains "$(cat packages/core/src/config.ts)" "LOCAL_PORTA_IMAGE = 'fabioassuncao/portta:local'"
assert_eq "" "$(sed -n '/export function checkoutLocalEnv/,/^}/p' packages/cli/src/commands/lifecycle.ts | grep -E 'ghcr.io/fabioassuncao' || true)"


describe "the TypeScript CLI never constructs a shell command from input"

it "the process primitive disables shell execution"
assert_contains "$(cat packages/cli/src/process.ts)" "shell: false"

it "commands call the primitive with argument arrays"
assert_eq "" "$(grep -rn "from 'node:child_process'" packages/cli/src --include='*.ts' | grep -v '\.test\.ts:' || true)"

t_summary
