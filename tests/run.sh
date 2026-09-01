#!/usr/bin/env bash
# ============================================================================
# Portta: test runner
# ============================================================================
#   tests/run.sh            lint + unit  (fast, no Docker)
#   tests/run.sh --e2e      also the end-to-end suites (needs Docker)
#   tests/run.sh --all      everything
#   tests/run.sh --lint     lint only
# ============================================================================
set -uo pipefail

PORTTA_ROOT=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$PORTTA_ROOT" || exit 1

RUN_LINT=1; RUN_UNIT=1; RUN_E2E=0
case "${1:-}" in
  --all) RUN_E2E=1 ;;
  --e2e) RUN_LINT=0; RUN_UNIT=0; RUN_E2E=1 ;;
  --lint) RUN_UNIT=0 ;;
  --unit) RUN_LINT=0 ;;
  ''|--fast) ;;
  -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
  *) echo "unknown argument: $1" >&2; exit 1 ;;
esac

FAILED=0
bold() { [ -t 1 ] && printf '\033[1m%s\033[0m\n' "$1" || printf '%s\n' "$1"; }

# ---------------------------------------------------------------------------
# Lint
# ---------------------------------------------------------------------------
if [ "$RUN_LINT" = "1" ]; then
  bold "== shell lint =="
  if command -v shellcheck >/dev/null 2>&1; then
    # Linting is a developer convenience here, never a runtime dependency:
    # when the tool is absent the suite says so instead of quietly passing.
    files=$(find bin scripts tests -type f \( -name '*.sh' -o -name 'portta' \) | sort; printf '%s\n' install.sh)
    # shellcheck disable=SC2086  # deliberate word splitting over the file list
    if shellcheck -S warning -x $files; then
      echo "  ok  $(printf '%s\n' "$files" | wc -l | tr -d ' ') files clean"
    else
      echo "  FAIL shellcheck reported problems"; FAILED=1
    fi
  else
    echo "  skip shellcheck not installed (brew install shellcheck)"
  fi

  bold "== executable bits =="
  missing=""
  for f in bin/portta install.sh scripts/bootstrap.sh scripts/doctor.sh tests/run.sh; do
    [ -x "$f" ] || missing="$missing $f"
  done
  if [ -n "$missing" ]; then echo "  FAIL not executable:$missing"; FAILED=1
  else echo "  ok  entrypoints are executable"; fi

  bold "== compose validation =="
  if docker compose version >/dev/null 2>&1; then
    # Every profile is rendered and asserted in tests/unit/profiles.test.sh;
    # here we only check that each compose file is individually parseable, so
    # a syntax error is reported against the file that has it.
    # Some overlays are fragments that only make sense on top of another one
    # (the dashboard variant extends the Tailscale attachment), so try the
    # progressively larger combinations before calling a file broken.
    # --project-directory mirrors what the CLI does: it anchors the relative
    # paths in the overlays at the repository root, not at docker/compose/.
    for f in docker/compose/compose.yaml docker/compose/*/*.yaml; do
      if docker compose --project-directory . -f "$f" config --quiet >/dev/null 2>&1 \
         || docker compose --project-directory . \
              -f docker/compose/compose.yaml -f "$f" config --quiet >/dev/null 2>&1 \
         || TS_AUTHKEY=x docker compose --project-directory . \
              -f docker/compose/compose.yaml -f docker/compose/attach/tailscale.yaml \
              -f "$f" config --quiet >/dev/null 2>&1 \
         || docker compose --project-directory . \
              -f docker/compose/compose.yaml -f docker/compose/attach/host.yaml \
              -f docker/compose/features/web.yaml -f "$f" config --quiet >/dev/null 2>&1; then
        echo "  ok  $f parses"
      else
        echo "  FAIL $f does not parse"; FAILED=1
      fi
    done
    for d in docker/examples/demo-a docker/examples/demo-b; do
      if ( cd "$d" && docker compose -f compose.yaml -f compose.portta.yaml config --quiet ); then
        echo "  ok  $d config is valid"
      else
        echo "  FAIL $d config is invalid"; FAILED=1
      fi
    done
  else
    echo "  skip docker compose unavailable"
  fi

  bold "== no pinned-to-latest images =="
  # A floating tag turns an unrelated upstream release into an outage.
  floating=$(grep -rnE '^\s*image:\s*\S+(:latest)?\s*$' docker/compose/compose.yaml docker/compose/*/*.yaml docker/examples/*/compose*.yaml \
    | grep -vE 'image:\s*\S+:[A-Za-z0-9]' || true)
  if [ -n "$floating" ]; then
    echo "  FAIL images without an explicit tag:"; printf '%s\n' "$floating" | sed 's/^/       /'; FAILED=1
  else
    echo "  ok  every image pins an explicit version"
  fi

  bold "== documentation links =="
  ./tests/lint-links.sh || FAILED=1

  bold "== no secrets committed =="
  leaked=$(git ls-files -z 2>/dev/null | xargs -0 grep -lE \
    'tskey-(auth|client)-[A-Za-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY-----' 2>/dev/null || true)
  if [ -n "$leaked" ]; then
    echo "  FAIL possible secret material in:"; printf '%s\n' "$leaked" | sed 's/^/       /'; FAILED=1
  else
    echo "  ok  no auth keys or private keys tracked"
  fi
fi

# ---------------------------------------------------------------------------
# Unit
# ---------------------------------------------------------------------------
if [ "$RUN_UNIT" = "1" ]; then
  for t in tests/unit/*.test.sh; do
    [ -f "$t" ] || continue
    bold "== $t =="
    bash "$t" || FAILED=1
  done
fi

# ---------------------------------------------------------------------------
# Web panel
# ---------------------------------------------------------------------------
# The panel has its own suite (Vitest for the API and the components,
# Playwright for the end-to-end run). It needs Node, which the gateway itself
# never does, so it is skipped rather than assumed.
if [ "$RUN_UNIT" = "1" ] && [ -d apps/web ]; then
  # The shared package the shell gateway and the CLI both encode a copy of.
  # Its suite ran only in CI, so a change to composeFiles could pass here and
  # fail there.
  bold "== shared core =="
  if ! command -v node >/dev/null 2>&1; then
    echo "  skip node not installed"
  elif [ ! -d node_modules ] && [ ! -d packages/core/node_modules ]; then
    echo "  skip node_modules missing (run: npm ci)"
  else
    if ( cd packages/core && npm run --silent test ); then
      echo "  ok  core unit suite"
    else
      echo "  FAIL core unit suite"; FAILED=1
    fi
  fi

  bold "== web panel =="
  if ! command -v node >/dev/null 2>&1; then
    echo "  skip node not installed (the panel is built and run in a container)"
  elif [ ! -d node_modules ] && [ ! -d apps/web/node_modules ]; then
    echo "  skip node_modules missing (run: npm ci)"
  else
    if ( cd apps/web && npm run --silent typecheck ); then
      echo "  ok  types check"
    else
      echo "  FAIL typecheck"; FAILED=1
    fi
    if ( cd apps/web && npm run --silent test ); then
      echo "  ok  unit and API suites"
    else
      echo "  FAIL panel test suite"; FAILED=1
    fi
  fi
fi

# ---------------------------------------------------------------------------
# End to end
# ---------------------------------------------------------------------------
if [ "$RUN_E2E" = "1" ]; then
  if ! docker info >/dev/null 2>&1; then
    echo
    echo "E2E suites need a running Docker daemon; refusing to report success without running them." >&2
    exit 1
  fi
  for t in tests/e2e/*.test.sh; do
    [ -f "$t" ] || continue
    bold "== $t =="
    bash "$t" || FAILED=1
  done

  # The package being installed says nothing about the browser being present,
  # and the suite cannot pass without one: it starts, reports "1 passed" out of
  # forty, and fails. Look for the browser itself.
  playwright_browser_present() {
    ( cd apps/web && npx --no-install playwright --version >/dev/null 2>&1 ) || return 1
    local cache="${PLAYWRIGHT_BROWSERS_PATH:-}"
    if [ -z "$cache" ]; then
      case "$(uname -s)" in
        Darwin) cache="$HOME/Library/Caches/ms-playwright" ;;
        *) cache="$HOME/.cache/ms-playwright" ;;
      esac
    fi
    ls -d "$cache"/chromium-* >/dev/null 2>&1
  }

  bold "== web panel end to end =="
  if [ ! -d node_modules ] && [ ! -d apps/web/node_modules ]; then
    echo "  skip node_modules missing (run: npm ci)"
  elif ! playwright_browser_present; then
    echo "  skip playwright browsers not installed (npx --workspace=portta-web playwright install chromium)"
  else
    if ( cd apps/web && npm run --silent test:e2e ); then
      echo "  ok  panel end-to-end run"
    else
      echo "  FAIL panel end-to-end run"; FAILED=1
    fi
  fi
fi

echo
if [ "$FAILED" = "0" ]; then bold "ALL SUITES PASSED"; else bold "SUITE FAILURES"; fi
exit "$FAILED"
