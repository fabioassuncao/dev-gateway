#!/usr/bin/env bash
# The toolbox build context is shared by the Bash and TypeScript CLIs. No
# Docker daemon is contacted here.
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_ROOT/scripts/lib/common.sh"
. "$PORTTA_ROOT/scripts/lib/toolbox.sh"

describe "the toolbox image source"

it "lives with the other Docker-owned image contexts"
assert_eq "$PORTTA_ROOT/docker/images/toolbox" "$PORTTA_TOOLBOX_CONTEXT"
assert_success test -f "$PORTTA_TOOLBOX_CONTEXT/Dockerfile"

it "is also used by the shell command entry point"
assert_contains "$(cat "$PORTTA_ROOT/bin/portta")" '"$PORTTA_TOOLBOX_CONTEXT"'

it "is also used by the TypeScript CLI"
assert_contains "$(cat "$PORTTA_ROOT/packages/cli/src/commands/clients.ts")" "join(context.root, 'docker', 'images', 'toolbox')"

t_summary
