#!/usr/bin/env bash
# Compatibility entry point. The documentation compiler owns validation.
set -euo pipefail
PORTTA_ROOT=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$PORTTA_ROOT"
exec npm run docs:check
