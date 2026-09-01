#!/usr/bin/env bash
# The CLI is the stable operational contract, so its surface is asserted:
# every command answers --help, unknown input fails clearly, and --json output
# actually parses.
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
GW="$DG_ROOT/bin/dev-gateway"

COMMANDS="bootstrap up down restart status logs doctor urls inspect update version
toolbox network public dns tls remote analyze init namespace access services db redis service
web git share"

describe "every command answers --help"
for c in $COMMANDS; do
  it "$c --help"
  out=$("$GW" "$c" --help 2>&1 | head -1)
  case "$out" in
    dev-gateway*|Usage:*) _t_pass ;;
    *) _t_fail "got: $out" ;;
  esac
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
    it "dev-gateway $c"
    # shellcheck disable=SC2086
    assert_success sh -c "\"$GW\" $c 2>/dev/null | python3 -m json.tool >/dev/null"
  done
fi

describe "version reporting"
it "version prints a semver-shaped string"
assert_success sh -c "\"$GW\" version | grep -qE 'dev-gateway [0-9]+\.[0-9]+\.[0-9]+'"
it "--version works too"
assert_contains "$("$GW" --version 2>&1)" "dev-gateway"
it "VERSION and the CLI agree"
assert_contains "$("$GW" version)" "$(tr -d '[:space:]' < "$DG_ROOT/VERSION")"

t_summary
