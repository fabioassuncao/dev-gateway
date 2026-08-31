#!/usr/bin/env bash
# Fails when a relative link in the documentation points at a file that does
# not exist. Cheap to run, and it catches the drift that makes documentation
# stop being trustworthy.
set -uo pipefail

DG_ROOT=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$DG_ROOT" || exit 1

missing=0
# docs/prompts holds the build brief, not project documentation.
files=$(git ls-files '*.md' 2>/dev/null | grep -v '^docs/prompts/' || find . -name '*.md' -not -path './docs/prompts/*')

for md in $files; do
  dir=$(dirname "$md")
  # Extract the target of every inline markdown link, dropping any #anchor.
  targets=$(sed -n 's/.*](\([^)]*\)).*/\1/p' "$md" \
    | sed -e 's/#.*$//' -e '/^$/d' \
    | grep -vE '^(https?:|mailto:|tel:)' || true)
  for t in $targets; do
    if [ ! -e "$dir/$t" ]; then
      printf '  FAIL %s -> %s\n' "$md" "$t"
      missing=$((missing + 1))
    fi
  done
done

if [ "$missing" -gt 0 ]; then
  printf '  %s broken documentation link(s)\n' "$missing"
  exit 1
fi
printf '  ok  every relative documentation link resolves\n'
