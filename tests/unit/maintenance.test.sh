#!/usr/bin/env bash
# backup, restore and repair: the three operations that assume something has
# gone wrong. No Docker — every path exercised here is the file-level one, which
# is the part that must never lose data.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT

# `bin/portta` honours an inherited PORTTA_ROOT, which is what lets the
# installer point it at PORTTA_HOME. This suite exports one, so every
# invocation must clear it or the command would operate on the repository —
# the .env and the state of whoever is running the tests.
run_in_home() {
  local home="$1"; shift
  ( cd "$home" && env -u PORTTA_ROOT -u PORTTA_STATE_DIR ./bin/portta "$@" )
}

# A believable installation: the files a real PORTTA_HOME holds, and nothing
# that would need Docker to exist.
make_home() {
  local home; home=$(mktemp -d)
  cp -R "$PORTTA_ROOT/bin" "$PORTTA_ROOT/scripts" "$PORTTA_ROOT/docker" "$home/" 2>/dev/null
  cp "$PORTTA_ROOT/.env.example" "$home/.env"
  printf '0.2.0\n' > "$home/VERSION"
  mkdir -p "$home/config/traefik/dynamic" "$home/config/tls" "$home/state/git" "$home/state/access"
  printf 'MARKER=original\n' >> "$home/.env"
  printf 'keep me\n' > "$home/config/traefik/dynamic/mine.yaml"
  chmod 600 "$home/.env"
  printf '%s' "$home"
}

mode_of() {
  stat -f '%OLp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null
}

describe "backup"

HOME_A=$(make_home)
run_in_home "$HOME_A" backup -o "$HOME_A/b.tar.gz" --no-database >/dev/null 2>&1

it "writes an archive"
assert_success test -f "$HOME_A/b.tar.gz"

# The archive holds .env, the panel password hash and any tunnel token. It is
# created under a private umask rather than chmod'ed afterwards, so it is never
# even briefly world-readable.
it "is private from the moment it exists"
assert_eq "600" "$(mode_of "$HOME_A/b.tar.gz")"

it "carries a manifest saying which Portta produced it"
assert_contains "$(tar -xzOf "$HOME_A/b.tar.gz" ./portta-backup.json 2>/dev/null)" '"portta":"0.2.0"'

it "contains the configuration that cannot be regenerated"
CONTENTS=$(tar -tzf "$HOME_A/b.tar.gz")
assert_contains "$CONTENTS" "./tree/.env"
assert_contains "$CONTENTS" "./tree/config/traefik/dynamic/mine.yaml"

# Including the code would make the archive a stale copy of the release, and
# restoring it onto a newer Portta would quietly downgrade it.
it "leaves out everything the installer can fetch again"
assert_not_contains "$CONTENTS" "./tree/bin/"
assert_not_contains "$CONTENTS" "./tree/scripts/"
assert_not_contains "$CONTENTS" "./tree/docker/"

describe "restore"

# Break the installation the way a bad edit or a bad deploy would.
printf 'MARKER=CLOBBERED\n' > "$HOME_A/.env"
rm -f "$HOME_A/config/traefik/dynamic/mine.yaml"
RESTORE_OUT=$(run_in_home "$HOME_A" restore "$HOME_A/b.tar.gz" 2>&1)

it "puts the configuration back"
assert_contains "$(cat "$HOME_A/.env")" "MARKER=original"

it "puts the generated Traefik files back"
assert_success test -f "$HOME_A/config/traefik/dynamic/mine.yaml"

it "leaves .env private"
assert_eq "600" "$(mode_of "$HOME_A/.env")"

# A restore that turns out to be the wrong archive is otherwise unrecoverable.
it "keeps what it replaced"
SAFETY=$(find "$HOME_A/state" -maxdepth 1 -name 'restore-*' -type d | head -1)
assert_ne "" "$SAFETY"
assert_contains "$(cat "$SAFETY/.env" 2>/dev/null)" "MARKER=CLOBBERED"

it "says which version the archive came from"
assert_contains "$RESTORE_OUT" "0.2.0"

it "refuses a file that is not a Portta backup"
printf 'not an archive' > "$HOME_A/junk.tar.gz"
assert_contains "$(run_in_home "$HOME_A" restore "$HOME_A/junk.tar.gz" 2>&1)" "not a Portta backup"

it "refuses an archive without a manifest"
( cd "$HOME_A" && tar -czf stray.tar.gz VERSION ) 2>/dev/null
assert_contains "$(run_in_home "$HOME_A" restore "$HOME_A/stray.tar.gz" 2>&1)" "no Portta manifest"

it "asks which backup when given none"
assert_contains "$(run_in_home "$HOME_A" restore 2>&1)" "which backup"

describe "repair"

HOME_B=$(make_home)
# Exactly the damage repair exists for: bind-mount directories deleted, and a
# world-readable .env.
rm -rf "$HOME_B/state/access" "$HOME_B/config/tls"
chmod 644 "$HOME_B/.env"
DRY=$(run_in_home "$HOME_B" repair --dry-run 2>&1)

it "reports the missing directories"
assert_contains "$DRY" "would create state/access"
assert_contains "$DRY" "would create config/tls"

it "reports a .env anyone on the host could read"
assert_contains "$DRY" "would change .env from 644 to 600"

# A dry run that changed something would be worse than no dry run at all.
it "changes nothing on a dry run"
assert_success test ! -d "$HOME_B/state/access"
assert_eq "644" "$(mode_of "$HOME_B/.env")"

describe "repair is idempotent"

HOME_C=$(make_home)
FIRST=$(run_in_home "$HOME_C" repair --dry-run 2>&1)

it "finds the directories a fresh home is missing"
assert_contains "$FIRST" "would create"

# Create them, then confirm a second look finds nothing: a repair that keeps
# reporting the same work has not repaired anything.
mkdir -p "$HOME_C/config/traefik/dynamic" "$HOME_C/config/tls" \
  "$HOME_C/state/traefik/acme" "$HOME_C/state/tailscale" "$HOME_C/state/access" \
  "$HOME_C/state/git" "$HOME_C/state/github" "$HOME_C/state/cloudflared"
chmod 700 "$HOME_C/state/traefik/acme" "$HOME_C/state/cloudflared"
chmod 600 "$HOME_C/.env"
SECOND=$(run_in_home "$HOME_C" repair --dry-run 2>&1)

it "finds nothing once everything is in place"
assert_contains "$SECOND" "nothing to repair"

rm -rf "$HOME_A" "$HOME_B" "$HOME_C"

t_summary
