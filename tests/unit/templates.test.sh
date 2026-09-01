#!/usr/bin/env bash
# Every shipped template must be valid Compose and must follow the two rules
# that are easy to get wrong. An overlay has no `image:` of its own, so each is
# merged with a generated base that supplies one per service.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"

if ! docker compose version >/dev/null 2>&1; then
  describe "templates"; it "validation"; skip "docker compose unavailable"; t_summary; exit $?
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/portta-tpl.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# Services declared by an overlay, read from the two-space indent level.
services_in() {
  sed -n '/^services:/,/^[a-z]/p' "$1" \
    | sed -n 's/^  \([a-z0-9][a-z0-9._-]*\):[[:space:]]*$/\1/p'
}

# An overlay has no `image:` of its own, so it is merged with a generated base
# that supplies one per service before Compose will render it.
render_base() {
  local tpl="$1" out="$2"
  {
    printf 'services:\n'
    services_in "$tpl" | while read -r svc; do
      [ -n "$svc" ] || continue
      printf '  %s:\n    image: alpine:3.24.1\n' "$svc"
    done
  } > "$out"
}

# Datastores attached to the shared HTTP network, read from the rendered
# configuration rather than guessed from the file. Written as a heredoc so no
# amount of shell quoting can silently turn it into a check that passes.
datastores_on_shared_network() {
  python3 - "$1" <<'PORTTA_PY'
import json, re, sys

DATASTORE = re.compile(
    r'^(postgres|postgresql|pgsql|mysql|mariadb|redis|valkey|mongo'
    r'|memcached|opensearch|elasticsearch|rabbitmq)$'
)
try:
    with open(sys.argv[1]) as handle:
        config = json.load(handle)
except Exception as cause:            # an unrendered template is a failure,
    print(f'could not read the rendered configuration: {cause}')   # not a pass
    raise SystemExit(0)

shared = {
    alias
    for alias, network in (config.get('networks') or {}).items()
    if (network or {}).get('name') == 'portta'
}
for service, spec in sorted((config.get('services') or {}).items()):
    if not DATASTORE.match(service):
        continue
    for attached in (spec.get('networks') or {}):
        if attached in shared:
            print(f'{service} -> {attached}')
PORTTA_PY
}

describe "every overlay template is valid Compose"
for tpl in "$PORTTA_ROOT"/templates/overlays/*.yaml; do
  name=$(basename "$tpl")
  base="$TMP/base-$name"
  render_base "$tpl" "$base"

  it "$name renders"
  if COMPOSE_PROJECT_NAME=tpl PORTTA_NETWORK=portta \
     docker compose -f "$base" -f "$tpl" config --quiet >/dev/null 2>&1; then
    _t_pass
  else
    _t_fail "$(COMPOSE_PROJECT_NAME=tpl docker compose -f "$base" -f "$tpl" config 2>&1 | head -2)"
  fi
done

describe "templates follow the rules that are easy to get wrong"
for tpl in "$PORTTA_ROOT"/templates/overlays/*.yaml; do
  name=$(basename "$tpl")
  body=$(cat "$tpl")
  base="$TMP/base-$name"
  render_base "$tpl" "$base"

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

  it "$name attaches no datastore to the shared HTTP network"
  # A template may name a datastore: the TCP routing overlay attaches one to
  # the access network on purpose, which is what makes hostname routing
  # possible. What must never happen is a datastore joining the shared network
  # that carries HTTP traffic.
  COMPOSE_PROJECT_NAME=tpl PORTTA_NETWORK=portta \
    docker compose -f "$base" -f "$tpl" config --format json > "$TMP/rendered.json" 2>/dev/null
  assert_eq "" "$(datastores_on_shared_network "$TMP/rendered.json")"
done

describe "the worktree template"
it "sets a namespace"
assert_contains "$(cat "$PORTTA_ROOT/templates/overlays/07-worktree.env")" "COMPOSE_PROJECT_NAME="
it "warns against sharing a database between worktrees"
assert_contains "$(cat "$PORTTA_ROOT/templates/overlays/07-worktree.env")" "worktrees writing to one database"

describe "the examples follow the same rules"
for ov in "$PORTTA_ROOT"/docker/examples/*/compose.portta.yaml; do
  name=$(basename "$(dirname "$ov")")
  it "$name writes labels in list form"
  assert_eq "" "$(grep -nE '^[[:space:]]+traefik\.[^ ]*:' "$ov" || true)"
  it "$name namespaces its Traefik service names"
  assert_eq "" "$(grep -oE 'traefik\.http\.services\.[^.]*\.' "$ov" | grep -v '\${COMPOSE_PROJECT_NAME' || true)"
done

describe "the optional identity labels stay optional"

it "the monorepo template shows them, commented out"
assert_contains "$(cat templates/overlays/06-monorepo.yaml)" "portta.repo="

it "the worktree template explains the grouping label"
assert_contains "$(cat templates/overlays/07-worktree.env)" "portta.project="

it "no template requires one"
assert_eq "" "$(grep -rn '^ *- "portta\.\(project\|repo\|git\)' templates/overlays/ || true)"

it "the example that declares them is the monorepo, where inference cannot"
assert_contains "$(cat docker/examples/demo-monorepo/compose.portta.yaml)" "portta.git.root="

for demo in demo-a demo-b demo-site demo-shop; do
  it "$demo declares none, and needs none"
  assert_eq "" "$(grep -n 'portta\.\(project\|repo\|git\.root\)' "docker/examples/$demo/compose.portta.yaml" 2>/dev/null || true)"
done

it "analyze reports them, and says so plainly when there are none"
assert_contains "$(./bin/portta analyze docker/examples/demo-a 2>&1)" "none (inferred from the Compose labels)"

t_summary
