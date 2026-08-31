#!/usr/bin/env bash
# Every shipped template must be valid Compose and must follow the two rules
# that are easy to get wrong. An overlay has no `image:` of its own, so each is
# merged with a generated base that supplies one per service.
set -uo pipefail

DG_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$DG_TEST_DIR/lib/assert.sh"
DG_ROOT=$(cd -P "$DG_TEST_DIR/.." && pwd); export DG_ROOT
. "$DG_ROOT/scripts/lib/common.sh"

if ! docker compose version >/dev/null 2>&1; then
  describe "templates"; it "validation"; skip "docker compose unavailable"; t_summary; exit $?
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/dg-tpl.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# Services declared by an overlay, read from the two-space indent level.
services_in() {
  sed -n '/^services:/,/^[a-z]/p' "$1" \
    | sed -n 's/^  \([a-z0-9][a-z0-9._-]*\):[[:space:]]*$/\1/p'
}

describe "every overlay template is valid Compose"
for tpl in "$DG_ROOT"/templates/overlays/*.yaml; do
  name=$(basename "$tpl")
  base="$TMP/base-$name"
  {
    printf 'services:\n'
    services_in "$tpl" | while read -r svc; do
      [ -n "$svc" ] || continue
      printf '  %s:\n    image: alpine:3.24.1\n' "$svc"
    done
  } > "$base"

  it "$name renders"
  if COMPOSE_PROJECT_NAME=tpl DEV_GATEWAY_NETWORK=dev-gateway \
     docker compose -f "$base" -f "$tpl" config --quiet >/dev/null 2>&1; then
    _t_pass
  else
    _t_fail "$(COMPOSE_PROJECT_NAME=tpl docker compose -f "$base" -f "$tpl" config 2>&1 | head -2)"
  fi
done

describe "templates follow the rules that are easy to get wrong"
for tpl in "$DG_ROOT"/templates/overlays/*.yaml; do
  name=$(basename "$tpl")
  body=$(cat "$tpl")

  it "$name writes labels in list form"
  # A mapping key is never interpolated, so `traefik.` at the start of an
  # indented line without a leading dash is the bug this catches.
  assert_eq "" "$(grep -nE '^[[:space:]]+traefik\.[^ ]*:' "$tpl" || true)"

  it "$name namespaces its Traefik service names"
  offenders=$(grep -oE 'traefik\.http\.services\.[^.]*\.' "$tpl" \
    | grep -v '\${COMPOSE_PROJECT_NAME' || true)
  assert_eq "" "$offenders"

  it "$name declares the shared network as external"
  assert_contains "$body" "external: true"

  it "$name attaches nothing that looks like a datastore"
  assert_eq "" "$(services_in "$tpl" | grep -E '^(postgres|postgresql|pgsql|mysql|mariadb|redis|valkey|mongo|memcached|opensearch|elasticsearch|rabbitmq)$' || true)"
done

describe "the worktree template"
it "sets a namespace"
assert_contains "$(cat "$DG_ROOT/templates/overlays/07-worktree.env")" "COMPOSE_PROJECT_NAME="
it "warns against sharing a database between worktrees"
assert_contains "$(cat "$DG_ROOT/templates/overlays/07-worktree.env")" "worktrees writing to one database"

describe "the examples follow the same rules"
for ov in "$DG_ROOT"/examples/*/compose.dev-gateway.yaml; do
  name=$(basename "$(dirname "$ov")")
  it "$name writes labels in list form"
  assert_eq "" "$(grep -nE '^[[:space:]]+traefik\.[^ ]*:' "$ov" || true)"
  it "$name namespaces its Traefik service names"
  assert_eq "" "$(grep -oE 'traefik\.http\.services\.[^.]*\.' "$ov" | grep -v '\${COMPOSE_PROJECT_NAME' || true)"
done

t_summary
