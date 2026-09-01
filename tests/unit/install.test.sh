#!/usr/bin/env bash
# The installer. Only the paths that cannot change the machine are executed:
# `--help` and argument validation both exit before any detection runs. The
# rest is asserted against the script, because the alternative is installing
# Portta on the machine running the test suite.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT

INSTALLER="$PORTTA_ROOT/install.sh"
SOURCE="$(cat "$INSTALLER")"

describe "the installer is a self-contained entry point"

it "exists and is executable"
assert_success test -x "$INSTALLER"

it "parses as bash"
assert_success bash -n "$INSTALLER"

it "answers --help without touching anything"
assert_contains "$(bash "$INSTALLER" --help 2>&1)" "Portta installer"

it "documents that the same command updates"
assert_contains "$(bash "$INSTALLER" --help 2>&1)" "The same command installs and updates"

describe "arguments are validated before anything is detected"

it "an unknown flag fails"
assert_failure bash "$INSTALLER" --nonsense

it "an unknown panel access mode fails"
assert_failure bash "$INSTALLER" --panel-access nonsense

it "a non-numeric panel port fails"
assert_failure bash "$INSTALLER" --panel-port eighty

it "a panel user with shell metacharacters fails"
assert_failure bash "$INSTALLER" --panel-user 'admin;rm'

it "the three supported access modes reach the parser"
assert_contains "$SOURCE" "''|public|tailscale|local) ;;"

describe "the password never reaches a command line"

it "there is no --panel-password flag"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n -- '--panel-password' || true)"

it "it is read from the environment or a no-echo prompt instead"
assert_contains "$SOURCE" 'PORTTA_PANEL_PASSWORD'
assert_contains "$SOURCE" 'stty -echo'

it "and the help says why"
assert_contains "$(bash "$INSTALLER" --help 2>&1)" "visible in the shell history"

it "a generated password is drawn from /dev/urandom, not from \$RANDOM"
assert_contains "$SOURCE" '/dev/urandom'
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'RANDOM' || true)"

it "only the hash is written, and openssl produces it"
assert_contains "$SOURCE" 'openssl passwd -apr1'

describe "an update never destroys what the first install generated"

it ".env is created only when absent"
assert_contains "$SOURCE" 'if [ ! -f "$ENV_FILE" ]; then'

it "the database credential is generated once"
assert_contains "$SOURCE" 'if [ -z "$(env_get "$ENV_FILE" PORTTA_RUNTIME_DB_PASSWORD)" ]; then'

it "state, TLS material and the dynamic directory are never in the replaced set"
replaced=$(printf '%s' "$SOURCE" | sed -n 's/^for path in \(.*\); do$/\1/p' | head -n1)
assert_contains "$replaced" "docker/compose"
assert_not_contains "$replaced" "state"
assert_not_contains "$replaced" "config"

it "an existing dynamic configuration file is kept"
assert_contains "$SOURCE" 'if [ ! -e "$target" ]; then cp "$file" "$target"'

it "an existing panel access mode is kept when no flag overrides it"
assert_contains "$SOURCE" 'PANEL_ACCESS=$(env_get "$ENV_FILE" PORTTA_WEB_EXPOSE)'

it "a directory that is not a Portta installation is refused, not adopted"
assert_contains "$SOURCE" 'exists and is not a Portta installation'

describe "the installer never builds and never clones"

it "it downloads a tarball rather than cloning"
assert_contains "$SOURCE" 'codeload.github.com'
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'git clone' || true)"

it "it pulls images"
assert_contains "$SOURCE" 'run_compose pull'

it "and never asks Compose to build"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -nE 'compose[^\n]*build|--build' || true)"

describe "the installer configures panel access, and nothing else"

it "it pins the gateway to the local profile, so applications stay unexposed"
assert_contains "$SOURCE" 'env_set "$ENV_FILE" PORTTA_PROFILE "local"'

it "it never enables public application exposure"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'PUBLIC_ENABLED "true"' || true)"

it "a base domain is recorded without activating anything"
assert_contains "$SOURCE" 'recorded only; applications stay unexposed'

it "and it says so at the end"
assert_contains "$SOURCE" 'publishing the panel published nothing else'

describe "a public panel is verified, not assumed"

it "an unauthenticated request must be refused before success is reported"
assert_contains "$SOURCE" 'if [ "$code" = "401" ]; then'

it "and a non-401 fails the run"
assert_contains "$SOURCE" 'expected HTTP 401 from the panel without credentials'

describe "Tailscale is observed, never driven"

it "no tailscale up, no login, no set"
# Only an actual invocation counts: the script mentions `tailscale up` several
# times to tell the reader to run it themselves, which is the whole point.
assert_eq "" "$(printf '%s' "$SOURCE" | grep -nE '(^|[;&|(]|\$\()[[:space:]]*tailscale[[:space:]]+(up|login|set|logout)([[:space:]]|$)' || true)"

it "only the read-only address lookup"
assert_contains "$SOURCE" 'tailscale ip -4'

it "and its absence never stops the install"
assert_contains "$SOURCE" 'optional: the panel can be reached publicly or over an SSH tunnel instead'

describe "AI agent CLIs are reported, never touched"

it "every agent check is a version probe"
assert_contains "$SOURCE" 'agent_report "Claude Code"  claude'
assert_contains "$SOURCE" 'agent_report "Codex CLI"    codex'

it "a tool off this PATH is reported as such, not as missing"
# nvm in .zshrc, agent CLIs symlinked into ~/.local/bin: a non-interactive
# shell sees none of it, and "not found" would be a wrong answer.
assert_contains "$SOURCE" "not on this PATH"
assert_contains "$SOURCE" '.nvm/versions/node'

it "and the installer and doctor look in the same places"
for place in '.local/bin' '.nvm/versions/node' '.bun/bin' '.volta/bin'; do
  assert_contains "$SOURCE" "$place"
  assert_contains "$(cat "$PORTTA_ROOT/scripts/lib/common.sh")" "$place"
done

it "nothing is installed or authenticated"
assert_contains "$SOURCE" 'the installer never installs, authenticates or reconfigures these'

describe "uninstall is conservative"

it "it asks first"
assert_contains "$SOURCE" 'confirm "Continue?" || die "aborted"'

it "it keeps the database volume"
assert_contains "$SOURCE" 'the panel database volume was kept'

it "it keeps the shared network, because projects may still be attached"
assert_contains "$SOURCE" 'the shared network was kept'

it "it finds the installation when no directory is given"
assert_contains "$SOURCE" 'no installation found at $PORTTA_HOME, and none in the usual places'

it "and honours an explicit --install-dir exactly"
assert_contains "$SOURCE" 'if [ -z "$INSTALL_DIR_EXPLICIT" ] && [ ! -f "$PORTTA_HOME/VERSION" ]; then'

it "it never prunes"
assert_eq "" "$(printf '%s' "$SOURCE" | grep -n 'system prune' || true)"

describe "one host runs one Portta"

it "a second installation is refused, with the first one named"
assert_contains "$SOURCE" 'Portta is already installed at $err_home and running'

it "and it is detected from the label Compose already writes"
assert_contains "$SOURCE" 'com.docker.compose.project.working_dir'

describe "the runtime layout the installer writes is a valid gateway root"

# packages/cli/src/context.ts recognises a root by VERSION plus a compose file
# under docker/compose/. `npx portta` on an installed host depends on it.
it "VERSION is downloaded"
assert_contains "$SOURCE" 'for path in VERSION'

it "and so is docker/compose"
assert_contains "$SOURCE" 'docker/compose'

it "the CLI still finds its libraries through that symlink"
# The installer links PORTTA_HOME/bin/portta into a bin directory on PATH, so
# bin/portta has to resolve the link before looking for scripts/lib beside it.
link=$(mktemp -u "${TMPDIR:-/tmp}/portta-link.XXXXXX")
ln -sf "$PORTTA_ROOT/bin/portta" "$link"
assert_contains "$("$link" version 2>&1)" "portta "
rm -f "$link"

it "and that link does not shadow a globally installed npm CLI"
# PORTTA_HOME has no packages/ directory, so without this the linked entry
# point would answer with the reduced shell command set even where the full
# TypeScript CLI is installed.
assert_contains "$(cat "$PORTTA_ROOT/bin/portta")" "lib/node_modules/portta/dist/cli.js"

it "and it links only into a directory already on PATH"
assert_contains "$SOURCE" 'for candidate in /usr/local/bin "$HOME/.local/bin"'

it "the CLI looks in the directories the installer defaults to"
context="$(cat "$PORTTA_ROOT/packages/cli/src/context.ts")"
assert_contains "$context" "'/opt/portta'"
assert_contains "$context" "'.portta'"

t_summary
