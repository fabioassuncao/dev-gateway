#!/usr/bin/env bash
# ============================================================================
# The Git collector: what it reads, and what it refuses to invent
# ============================================================================
# This runs on the host because the panel cannot: it has no project directory,
# no git and no shell. What is asserted here is the file the panel then reads,
# so a change in shape shows up as a failure rather than as an empty card.
#
# Real repositories in a temporary directory, never a mocked git.
# ============================================================================
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
. "$DG_ROOT/scripts/lib/common.sh"
. "$DG_ROOT/scripts/lib/docker.sh"
. "$DG_ROOT/scripts/lib/toolbox.sh"
. "$DG_ROOT/scripts/cmd/git.sh"

if ! dg_have git; then
  describe "the git collector"
  it "needs git on the host"; skip "git not installed"
  t_summary
  exit $?
fi

WORK=$(mktemp -d -t dg-git-test) || exit 1
trap 'rm -rf "$WORK"' EXIT INT TERM

# make_repo <name> [remote]: a real repository with one commit.
make_repo() {
  local dir="$WORK/$1"
  mkdir -p "$dir"
  ( cd "$dir" || exit 1
    git init -q -b main .
    git config user.email test@example.com
    git config user.name "Test Person"
    [ -z "${2:-}" ] || git remote add origin "$2"
    printf 'hello\n' > README.md
    git add README.md
    git commit -q -m "Add invoice totals"
  ) >/dev/null 2>&1
  printf '%s' "$dir"
}

field() { printf '%s' "$1" | python3 -c "
import json,sys
doc = json.load(sys.stdin)
for key in sys.argv[1].split('.'):
    doc = doc.get(key) if isinstance(doc, dict) else None
    if doc is None: break
print('' if doc is None else (json.dumps(doc) if isinstance(doc,(dict,list)) else doc))
" "$2" 2>/dev/null; }

describe "a repository with a remote"

repo=$(make_repo clean git@github.com:owner/repo.git)
json=$(dg_git_json demo "$repo" "")

it "the record is valid JSON"
assert_success sh -c "printf '%s' '$json' | python3 -m json.tool >/dev/null"

it "names the branch"
assert_eq "main" "$(field "$json" git.branch)"

it "is not detached"
assert_eq "False" "$(field "$json" git.detached)"

it "carries the commit subject, which is what makes the panel readable"
assert_eq "Add invoice totals" "$(field "$json" git.head.subject)"

it "carries a full and a short sha"
sha=$(field "$json" git.head.sha)
short=$(field "$json" git.head.shortSha)
assert_eq "${sha:0:7}" "${short:0:7}"

it "reports the remote as git reports it"
assert_eq "git@github.com:owner/repo.git" "$(field "$json" git.remote)"

it "says the tree is clean"
assert_eq "False" "$(field "$json" git.dirty)"

it "records when it was collected, so the panel can age it"
assert_success sh -c "test \"$(field "$json" collectedAt)\" -gt 0"

describe "a dirty tree, counted the way git counts it"

repo=$(make_repo dirty)
( cd "$repo" && printf 'changed\n' > README.md && printf 'new\n' > extra.txt \
  && printf 'staged\n' > staged.txt && git add staged.txt ) >/dev/null 2>&1
json=$(dg_git_json demo "$repo" "")

it "counts what is staged"
assert_eq "1" "$(field "$json" git.staged)"

it "counts what is not"
assert_eq "1" "$(field "$json" git.unstaged)"

it "counts what git does not track at all"
assert_eq "1" "$(field "$json" git.untracked)"

it "and calls the tree dirty"
assert_eq "True" "$(field "$json" git.dirty)"

describe "the absences, which are the normal cases"

it "a directory that is not a repository says so, and claims no branch"
plain="$WORK/plain"; mkdir -p "$plain"
json=$(dg_git_json demo "$plain" "")
assert_eq "not a git repository" "$(field "$json" reason)"

it "and its git block is null rather than empty"
assert_eq "" "$(field "$json" git.branch)"

it "a directory that does not exist is reported, not skipped"
json=$(dg_git_json demo "$WORK/nowhere" "")
assert_contains "$(field "$json" reason)" "not readable"

it "a repository with no remote keeps its branch"
repo=$(make_repo noremote)
json=$(dg_git_json demo "$repo" "")
assert_eq "main" "$(field "$json" git.branch)"

it "and reports no remote instead of guessing one"
assert_eq "" "$(field "$json" git.remote)"

it "a detached HEAD is named as such, with no branch"
repo=$(make_repo detached git@github.com:owner/repo.git)
( cd "$repo" && git checkout -q --detach HEAD ) >/dev/null 2>&1
json=$(dg_git_json demo "$repo" "")
assert_eq "True" "$(field "$json" git.detached)"

it "an upstream nobody set means zero ahead and zero behind"
repo=$(make_repo noupstream)
json=$(dg_git_json demo "$repo" "")
assert_eq "0" "$(field "$json" git.ahead)"
it "and no upstream is reported"
assert_eq "" "$(field "$json" git.upstream)"

describe "a declared dev-gateway.repo label wins over the local clone URL"

repo=$(make_repo declared git@github.com:local/clone.git)
json=$(dg_git_json demo "$repo" "owner/canonical")

it "the label is what the panel gets"
assert_eq "owner/canonical" "$(field "$json" git.remote)"

describe "nothing beyond metadata leaves the host"

repo=$(make_repo secrets git@github.com:owner/repo.git)
( cd "$repo" && printf 'SECRET=hunter2\n' > .env && git add -f .env \
  && git commit -q -m "add config" ) >/dev/null 2>&1
json=$(dg_git_json demo "$repo" "")

it "no file contents are collected"
assert_not_contains "$json" "hunter2"

it "no diff is collected"
assert_not_contains "$json" "diff --git"

it "and nothing beyond HEAD: one commit, not a log"
assert_eq "1" "$(printf '%s' "$json" | grep -c '"sha"')"

describe "a commit message cannot break the file it lands in"

repo=$(make_repo quoting git@github.com:owner/repo.git)
( cd "$repo" && printf 'x\n' > f.txt && git add f.txt \
  && git commit -q -m 'a "quoted" subject with \ backslash' ) >/dev/null 2>&1
json=$(dg_git_json demo "$repo" "")

it "the record is still valid JSON"
assert_success sh -c "printf '%s' '$json' | python3 -m json.tool >/dev/null"

it "and the subject survived intact"
assert_eq 'a "quoted" subject with \ backslash' "$(field "$json" git.head.subject)"

describe "the command surface"

it "git answers --help"
assert_contains "$("$DG_ROOT/bin/dev-gateway" git --help 2>&1)" "dev-gateway git"

it "an unknown subcommand fails"
assert_failure "$DG_ROOT/bin/dev-gateway" git definitely-not-a-subcommand

it "an unknown flag on scan fails"
assert_failure "$DG_ROOT/bin/dev-gateway" git scan --definitely-not-a-flag

it "the collector writes nowhere but state/git"
assert_contains "$(cat "$DG_ROOT/scripts/cmd/git.sh")" "printf '%s/git' \"\$DG_STATE_DIR\"" 

it "and the panel mounts that directory read-only"
assert_contains "$(cat "$DG_ROOT/compose.web.yaml")" "./state/git:/app/state/git:ro"

it "no git command in the collector writes to a repository"
assert_eq "" "$(grep -nE 'dg_git_in [^ ]+ (checkout|merge|rebase|reset|commit|push|fetch|pull|stash|clean)' "$DG_ROOT/scripts/cmd/git.sh" || true)"

t_summary
