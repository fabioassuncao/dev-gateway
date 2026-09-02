#!/usr/bin/env bash
# The CLI is the stable operational contract, so its surface is asserted:
# every command answers --help, unknown input fails clearly, and --json output
# actually parses.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
GW="$PORTTA_ROOT/bin/portta"

COMMAND_PATHS=(
  setup bootstrap up down restart status logs doctor urls inspect update version toolbox
  project "project list" "project show" "project services" "project analyze" "project init" "project namespace"
  network "network status" public "public status" "public enable" "public disable"
  dns "dns check" "dns status" "dns setup" tls "tls status" "tls init" "tls trust" "tls untrust"
  remote analyze init namespace access "access open" "access list" "access close" "access inspect" "access gc"
  services service "service publish" "service list" "service unpublish"
  db "db status" "db shell" "db dump" "db restore" "db open" "db close" "db url" "db psql" "db mysql"
  redis "redis open" "redis close" "redis cli"
  web "web up" "web dev" "web down" "web disable" "web restart" "web status" "web open" "web logs" "web build"
  "web auth" "web auth status" "web auth set" "web auth clear" "web auth apply"
  git "git scan" "git status" "git clear" share "share list" "share revoke" "share gc"
)

describe "every command and subcommand answers --help and --version"
for c in "${COMMAND_PATHS[@]}"; do
  it "$c --help"
  read -r -a words <<< "$c"
  out=$("$GW" "${words[@]}" --help 2>&1 | head -1)
  case "$out" in
    portta*|Usage:*) _t_pass ;;
    *) _t_fail "got: $out" ;;
  esac
  it "$c --version"
  assert_contains "$("$GW" "${words[@]}" --version 2>&1)" "portta"
done

describe "unknown input fails clearly instead of doing something"
it "an unknown command exits non-zero"; assert_failure "$GW" definitely-not-a-command
it "and says so"
assert_contains "$("$GW" definitely-not-a-command 2>&1)" "unknown command"
it "an unknown subcommand exits non-zero"; assert_failure "$GW" access definitely-not-a-subcommand
it "an unknown flag exits non-zero"; assert_failure "$GW" urls --definitely-not-a-flag

describe "commands that need an argument say so"
it "analyze without a path"; assert_failure "$GW" analyze
it "init without a path"; assert_failure "$GW" init
it "access open without a project"; assert_failure "$GW" access open
it "remote bootstrap without a target"; assert_failure "$GW" remote bootstrap

describe "the top-level help lists the commands people need"
help=$("$GW" --help 2>&1)
for c in bootstrap up down status doctor urls analyze init access services public dns tls remote web git share; do
  it "help mentions $c"; assert_contains "$help" "$c"
done

describe "--json output parses"
if ! docker info >/dev/null 2>&1; then
  it "json output"; skip "docker unavailable"
else
  for c in "status --json" "urls --json" "doctor --json" "services --json" "access list --json" "web status --json" "git status --json" "share list --json"; do
    it "portta $c"
    # shellcheck disable=SC2086
    assert_success sh -c "\"$GW\" $c 2>/dev/null | python3 -m json.tool >/dev/null"
  done
fi

describe "version reporting"
it "version prints a semver-shaped string"
assert_success sh -c "\"$GW\" version | grep -qE 'portta [0-9]+\.[0-9]+\.[0-9]+'"
it "--version works too"
assert_contains "$("$GW" --version 2>&1)" "portta"
it "VERSION and the CLI agree"
assert_contains "$("$GW" version)" "$(tr -d '[:space:]' < "$PORTTA_ROOT/VERSION")"

describe "the host needs no Node for the commands the shell implements"
# ADR 0015. The installer ships this entry point and nothing else on a host
# without Node, so a command it implements must be reachable there: every
# cmd_* defined in bin/portta has to have a dispatch arm.
for c in version bootstrap up down status doctor restart logs urls inspect update toolbox; do
  it "PORTTA_FORCE_BASH portta $c is dispatched, not refused"
  out=$(PORTTA_FORCE_BASH=true "$GW" "$c" --help 2>&1)
  assert_not_contains "$out" "requires Node"
done

it "every cmd_* in bin/portta has a dispatch arm"
missing=""
for fn in $(grep -oE '^cmd_[a-z_]+' "$GW" | sed 's/^cmd_//' | sort -u); do
  case "$fn" in help_for) continue ;; esac
  grep -qE "^\s+([a-z|]*\|)?$fn\)" "$GW" || missing="$missing $fn"
done
assert_eq "" "$missing"

describe "a closed pipe is not an error"

# `portta status | head -3` is ordinary, and it used to end in an unhandled
# EPIPE and a Node stack trace printed over the output the reader asked for.
for c in status doctor urls inspect; do
  it "portta $c | head -2 exits cleanly"
  assert_success sh -c "'$GW' $c 2>/dev/null | head -2 >/dev/null"
  it "and prints no stack trace"
  assert_not_contains "$("$GW" "$c" 2>/dev/null | head -2)" "EPIPE"
done

describe "public access accepts a derived base domain"

# Requiring PUBLIC_DOMAIN on top of an auto base would mean buying a domain to
# publish on a name that already resolves here.
it "the derived base is offered when PUBLIC_DOMAIN is unset"
assert_contains "$(cat "$PORTTA_ROOT/packages/cli/src/commands/network.ts")" "context.config.domainMode !== 'local'"

it "and localhost is still refused, with the way out named"
network="$(cat "$PORTTA_ROOT/packages/cli/src/commands/network.ts")"
assert_contains "$network" 'public access needs a domain, and this host has only localhost'
assert_contains "$network" 'portta config set domain.mode auto'

describe "one doctor, two surfaces"
# The deep diagnostics live in scripts/doctor.sh. The TypeScript CLI runs it
# rather than reimplementing a thinner version, so `portta doctor` and
# `npx portta doctor` cannot answer differently.
it "the TypeScript doctor runs the shell one"
assert_contains "$(cat "$PORTTA_ROOT/packages/cli/src/commands/lifecycle.ts")" "scripts/doctor.sh"
if ! docker info >/dev/null 2>&1; then
  it "shared checks"; skip "docker unavailable"
else
  it "and reports the checks only the shell doctor makes"
  ids=$(PORTTA_WEB=true "$GW" doctor --json 2>/dev/null | python3 -c "import json,sys; print(' '.join(c['id'] for c in json.load(sys.stdin)['checks']))")
  for id in agents.claude tools.git vpn.tailscale; do
    assert_contains "$ids" "$id"
  done

  # `panel.access` exists only while the panel is enabled, and a .env in this
  # checkout overrides the environment, so whether it is emitted depends on the
  # machine. Asserting it unconditionally passed for a developer with the panel
  # on and failed on CI, which has no .env at all.
  it "including panel access, whenever the panel is on"
  if [ "$(PORTTA_WEB=true "$GW" inspect 2>/dev/null | sed -n 's/^ *PORTTA_WEB *//p' | head -1)" = "false" ]; then
    skip "this checkout's .env disables the panel"
  else
    assert_contains "$ids" "panel.access"
  fi
  it "and a warning is not a failure"
  assert_contains "$("$GW" doctor --json 2>/dev/null)" '"status": "warn"'
fi

describe "the CLI says which installation it is talking to"
# A CLI installed from npm outlives the installation it addresses in both
# directions, so `version` reports both and whether they agree.
it "it names the gateway it resolved"
assert_contains "$("$GW" version 2>&1)" "gateway"
it "and the root it found"
assert_contains "$("$GW" version 2>&1)" "$PORTTA_ROOT"
it "the JSON form carries a compatibility verdict"
assert_success sh -c "'$GW' version --json | python3 -c 'import json,sys; d=json.load(sys.stdin); assert set([\"cli\",\"gateway\",\"panel\",\"compatible\",\"apiSeries\"]) <= set(d)'"
it "and this checkout is self-consistent"
assert_success sh -c "'$GW' version --json | python3 -c 'import json,sys; assert json.load(sys.stdin)[\"compatible\"] is True'"
it "a mismatched installation is reported, not ignored"
mismatch=$(mktemp -d "${TMPDIR:-/tmp}/portta-version.XXXXXX")
mkdir -p "$mismatch/docker/compose/attach" "$mismatch/docker/compose/profiles"
printf '9.9.9\n' > "$mismatch/VERSION"
for f in compose.yaml attach/host.yaml profiles/local.yaml; do printf '{}\n' > "$mismatch/docker/compose/$f"; done
assert_contains "$(PORTTA_ROOT="$mismatch" "$GW" version 2>&1)" "installation is 9.9.9"
rm -rf "$mismatch"

describe "exit codes have a stable machine contract"
it "success is 0"; assert_success "$GW" version
failure_root=$(mktemp -d "${TMPDIR:-/tmp}/portta-cli-exit.XXXXXX")
mkdir -p "$failure_root/state/git" "$failure_root/docker/compose/attach" "$failure_root/docker/compose/profiles"
printf '0.1.1\n' > "$failure_root/VERSION"
printf '{}\n' > "$failure_root/docker/compose/compose.yaml"
printf '{}\n' > "$failure_root/docker/compose/attach/host.yaml"
printf '{}\n' > "$failure_root/docker/compose/profiles/local.yaml"
printf '{broken\n' > "$failure_root/state/git/broken.json"
it "an operational failure is 1"; assert_exit 1 env PORTTA_ROOT="$failure_root" "$GW" git status
rm -rf "$failure_root"
it "usage is 2"; assert_exit 2 "$GW" definitely-not-a-command
it "a missing runtime precondition is 3"
# Through the TypeScript CLI directly, because bin/portta deliberately carries
# the root it lives in: an installed PORTTA_HOME links its entry point onto
# PATH, and running it from elsewhere must still address that installation.
assert_exit 3 sh -c "cd /tmp && env -u PORTTA_ROOT -u PORTTA_HOME node '$PORTTA_ROOT/packages/cli/dist/cli.js' inspect >/dev/null 2>&1"

it "and the entry point addresses the installation it belongs to"
assert_contains "$(cd /tmp && env -u PORTTA_ROOT "$GW" inspect 2>&1)" "PORTTA_ROOT"
it "a refused unsafe operation is 4"
assert_exit 4 "$GW" service publish --public --project demo --service db

describe "checkout-local read commands emit one JSON document on stdout"
for c in "inspect" "git status" "share list" "tls status" "public status" "dns status" "project namespace --no-check"; do
  it "$c --json"
  read -r -a words <<< "$c"
  assert_success sh -c "'$GW' ${words[*]} --json 2>/dev/null | python3 -m json.tool >/dev/null"
done

t_summary
