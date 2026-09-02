#!/usr/bin/env bash
# backup, restore and repair: the three operations that assume something has
# gone wrong. No Docker — every path exercised here is the file-level one, which
# is the part that must never lose data.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
# portta_file_mode: GNU/BSD-portable, and the one implementation of it.
. "$PORTTA_ROOT/scripts/lib/common.sh"

# These commands write over an installation, so each runs against a throwaway
# root rather than the repository — the .env and the state of whoever is running
# the tests are not fixtures. PORTTA_ROOT is what the installer uses to point
# the entry point at PORTTA_HOME, and it is what points it at the fake one.
GW="$PORTTA_ROOT/bin/portta"

run_in_home() {
  local home="$1"; shift
  ( cd "$home" && PORTTA_ROOT="$home" env -u PORTTA_STATE_DIR "$GW" "$@" )
}

# A believable installation: the files a real PORTTA_HOME holds, and nothing
# that would need Docker to exist.
make_home() {
  local home; home=$(mktemp -d)
  cp -R "$PORTTA_ROOT/docker" "$home/"
  cp "$PORTTA_ROOT/.env.example" "$home/.env"
  printf '0.2.0\n' > "$home/VERSION"
  mkdir -p "$home/config/traefik/dynamic" "$home/config/tls" "$home/state/git" "$home/state/access"
  printf 'MARKER=original\n' >> "$home/.env"
  printf 'keep me\n' > "$home/config/traefik/dynamic/mine.yaml"
  chmod 600 "$home/.env"
  printf '%s' "$home"
}

# A Docker that reports nothing: no running gateway, no networks.
#
# Both restore and repair ask Docker about the world, and the machine running
# these tests may well have a real Portta on it — the developer's own. Without
# this stub, restore is refused because a gateway is up and the network
# assertions pass by accident. What these commands *decide* is the subject.
NO_NETWORKS=$(mktemp -d)
cat > "$NO_NETWORKS/docker" <<'STUB'
#!/usr/bin/env bash
case "$1 $2" in
  "network inspect") exit 1 ;;
  "network create") exit 0 ;;
esac
exit 1
STUB
chmod +x "$NO_NETWORKS/docker"

run_isolated() {
  local home="$1"; shift
  ( cd "$home" && PATH="$NO_NETWORKS:$PATH" PORTTA_ROOT="$home" env -u PORTTA_STATE_DIR "$GW" "$@" )
}

# The mirror image: a Docker that owns every network and runs nothing. Needed
# to assert the *absence* of work, which otherwise depends on whether the
# machine running the tests happens to have the gateway's networks.
ALL_NETWORKS=$(mktemp -d)
cat > "$ALL_NETWORKS/docker" <<'STUB'
#!/usr/bin/env bash
case "$1 $2" in
  "network inspect") exit 0 ;;
esac
exit 1
STUB
chmod +x "$ALL_NETWORKS/docker"

run_with_networks() {
  local home="$1"; shift
  ( cd "$home" && PATH="$ALL_NETWORKS:$PATH" PORTTA_ROOT="$home" env -u PORTTA_STATE_DIR "$GW" "$@" )
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
assert_eq "600" "$(portta_file_mode "$HOME_A/b.tar.gz")"

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
RESTORE_OUT=$(run_isolated "$HOME_A" restore "$HOME_A/b.tar.gz" 2>&1)

it "puts the configuration back"
assert_contains "$(cat "$HOME_A/.env")" "MARKER=original"

it "puts the generated Traefik files back"
assert_success test -f "$HOME_A/config/traefik/dynamic/mine.yaml"

it "leaves .env private"
assert_eq "600" "$(portta_file_mode "$HOME_A/.env")"

# A restore that turns out to be the wrong archive is otherwise unrecoverable.
it "keeps what it replaced"
SAFETY=$(find "$HOME_A/state" -maxdepth 1 -name 'restore-*' -type d | head -1)
assert_ne "" "$SAFETY"
assert_contains "$(cat "$SAFETY/.env" 2>/dev/null)" "MARKER=CLOBBERED"

# The refusal is the safety that matters most: restoring under a running
# gateway swaps its credentials while the containers keep the old ones.
it "refuses while a gateway is running"
RUNNING=$(mktemp -d)
cat > "$RUNNING/docker" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "inspect" ] && { echo true; exit 0; }
exit 1
STUB
chmod +x "$RUNNING/docker"
assert_contains "$( cd "$HOME_A" && PATH="$RUNNING:$PATH" PORTTA_ROOT="$HOME_A" "$GW" restore "$HOME_A/b.tar.gz" 2>&1 )" "the gateway is running"

it "and proceeds anyway when told to"
assert_not_contains "$( cd "$HOME_A" && PATH="$RUNNING:$PATH" PORTTA_ROOT="$HOME_A" "$GW" restore "$HOME_A/b.tar.gz" --force 2>&1 )" "the gateway is running"
rm -rf "$RUNNING"

it "says which version the archive came from"
assert_contains "$RESTORE_OUT" "0.2.0"

it "refuses a file that is not a Portta backup"
printf 'not an archive' > "$HOME_A/junk.tar.gz"
assert_contains "$(run_isolated "$HOME_A" restore "$HOME_A/junk.tar.gz" 2>&1)" "not a Portta backup"

it "refuses an archive without a manifest"
( cd "$HOME_A" && tar -czf stray.tar.gz VERSION ) 2>/dev/null
assert_contains "$(run_isolated "$HOME_A" restore "$HOME_A/stray.tar.gz" 2>&1)" "no Portta manifest"

it "asks which backup when given none"
assert_contains "$(run_isolated "$HOME_A" restore 2>&1)" "which backup"

# The archive format is a contract across versions: one written by the shell
# implementation this command replaced must still restore. PORTTA_BACKUP_VERSION
# stays 1 and the layout does not change, so an archive built by hand in the
# old shape is the honest test of that.
describe "an archive written by the shell implementation still restores"

LEGACY_HOME=$(make_home)
LEGACY_STAGING=$(mktemp -d)
mkdir -p "$LEGACY_STAGING/tree/config/traefik/dynamic"
printf '{"version":1,"portta":"0.3.0","created":"2026-01-01T00:00:00Z","host":"old-host"}\n' \
  > "$LEGACY_STAGING/portta-backup.json"
printf 'MARKER=from-the-shell-version\n' > "$LEGACY_STAGING/tree/.env"
printf '0.3.0\n' > "$LEGACY_STAGING/tree/VERSION"
printf 'shell era\n' > "$LEGACY_STAGING/tree/config/traefik/dynamic/legacy.yaml"
( cd "$LEGACY_STAGING" && tar -czf "$LEGACY_HOME/legacy.tar.gz" . )
rm -rf "$LEGACY_STAGING"

LEGACY_OUT=$(run_isolated "$LEGACY_HOME" restore "$LEGACY_HOME/legacy.tar.gz" 2>&1)

it "reads the manifest and says which version it came from"
assert_contains "$LEGACY_OUT" "0.3.0"

it "puts back a file the shell version wrote"
assert_contains "$(cat "$LEGACY_HOME/config/traefik/dynamic/legacy.yaml" 2>/dev/null)" "shell era"

it "and the .env it carried"
assert_contains "$(cat "$LEGACY_HOME/.env")" "MARKER=from-the-shell-version"

it "leaving it private"
assert_eq "600" "$(portta_file_mode "$LEGACY_HOME/.env")"

rm -rf "$LEGACY_HOME"

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
assert_eq "644" "$(portta_file_mode "$HOME_B/.env")"

describe "repair is idempotent"

HOME_C=$(make_home)
FIRST=$(run_with_networks "$HOME_C" repair --dry-run 2>&1)

it "finds the directories a fresh home is missing"
assert_contains "$FIRST" "would create"

# Create them, then confirm a second look finds nothing: a repair that keeps
# reporting the same work has not repaired anything.
mkdir -p "$HOME_C/config/traefik/dynamic" "$HOME_C/config/tls" \
  "$HOME_C/state/traefik/acme" "$HOME_C/state/tailscale" "$HOME_C/state/access" \
  "$HOME_C/state/git" "$HOME_C/state/github" "$HOME_C/state/cloudflared"
chmod 700 "$HOME_C/state/traefik/acme" "$HOME_C/state/cloudflared"
chmod 600 "$HOME_C/.env"
SECOND=$(run_with_networks "$HOME_C" repair --dry-run 2>&1)

it "finds nothing once everything is in place"
assert_contains "$SECOND" "nothing to repair"

# repair created state/cloudflared with the default umask and then reported it
# as needing 700 — work it had just made for itself, on a healthy install.
# Behavioural, not a grep: the mode on disk is the thing that matters. The
# compose step afterwards fails without Docker, which is fine; the directories
# are created before it runs.
it "creates a private directory private, rather than fixing it afterwards"
HOME_D=$(make_home)
run_in_home "$HOME_D" repair >/dev/null 2>&1 || true
assert_eq "700" "$(portta_file_mode "$HOME_D/state/cloudflared")"

it "and leaves an ordinary directory ordinary"
assert_eq "755" "$(portta_file_mode "$HOME_D/state/github")"

# The access network carries TCP services. On a host with them off it is absent
# by design, and demanding it reported a repair that was not one.
# `.env` wins over the environment here, so the setting goes in the file.
it "does not demand the access network when TCP routing is off"
printf 'PORTTA_TCP=false\n' >> "$HOME_D/.env"
assert_not_contains "$(run_isolated "$HOME_D" repair --dry-run 2>&1)" "portta-access"

it "does demand it when TCP routing is on"
sed -i.bak 's/^PORTTA_TCP=false/PORTTA_TCP=true/' "$HOME_D/.env"
assert_contains "$(run_isolated "$HOME_D" repair --dry-run 2>&1)" "portta-access"
rm -rf "$HOME_D" "$NO_NETWORKS" "$ALL_NETWORKS"

rm -rf "$HOME_A" "$HOME_B" "$HOME_C"

t_summary
