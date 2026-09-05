#!/usr/bin/env bash
# Compatibility entry point. Use a targeted test during ordinary development.
set -uo pipefail
exec node "$(dirname "$0")/run.mjs" "$@"
