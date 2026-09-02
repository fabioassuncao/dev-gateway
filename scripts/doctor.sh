#!/usr/bin/env bash
# ============================================================================
# Portta: doctor, the zero-Node fallback
# ============================================================================
# The full diagnostic is `packages/cli/src/doctor.ts`: seventy-odd checks whose
# verdicts are pure functions in packages/core and therefore testable without a
# host. This file is not a second implementation of it.
#
# What ADR 0015 actually requires is that a host with nothing but Docker and a
# shell can be *diagnosed before anything is installed* — which is a handful of
# questions, not seventy. Those questions are here, with the same ids and the
# same JSON shape, so a reader on such a host sees a subset of the same report
# rather than a different one. tests/unit/doctor.test.sh asserts the ids match.
#
# Read-only, like the full version: it reports problems and names the fix, and
# never applies one.
#
# Exit codes: 0 all checks passed (warnings allowed), 1 at least one failure.
# ============================================================================

set -uo pipefail

PORTTA_SCRIPT_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$PORTTA_SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/docker.sh
. "$PORTTA_SCRIPT_DIR/lib/docker.sh"

portta_load_env
portta_defaults

AS_JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json) AS_JSON=1 ;;
    -h|--help)
      cat >&2 <<'PORTTA_HELP'
portta doctor: diagnose the gateway and its host

  --json   Emit machine-readable results on stdout

Read-only: doctor never changes state. Each failed check prints a suggested
fix for you (or an agent) to run deliberately.

This is the fallback that runs with no Node on the host, and it reports the
handful of checks a bare host needs before anything is installed. The full
diagnostic needs Node 22.12+.
PORTTA_HELP
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

PORTTA_RESULTS=$(mktemp -t portta-doctor.XXXXXX) || die "cannot create a temporary file"
trap 'rm -f "$PORTTA_RESULTS"' EXIT INT TERM

PORTTA_FAILURES=0
PORTTA_WARNINGS=0

# check <status> <id> <title> <detail> [hint]
check() {
  local status="$1" id="$2" title="$3" detail="$4" fix="${5:-}"
  printf '%s\t%s\t%s\t%s\t%s\n' "$status" "$id" "$title" "$detail" "$fix" >> "$PORTTA_RESULTS"
  case "$status" in
    fail) PORTTA_FAILURES=$((PORTTA_FAILURES + 1)) ;;
    warn) PORTTA_WARNINGS=$((PORTTA_WARNINGS + 1)) ;;
  esac
}

# ---------------------------------------------------------------------------
# 1. Identity and configuration
# ---------------------------------------------------------------------------

check pass gateway.version "gateway version" "$(portta_version)" ""

if portta_profile_valid "$PORTTA_PROFILE"; then
  check pass config.profile "profile" "$PORTTA_PROFILE" ""
else
  check fail config.profile "profile" "unknown profile '$PORTTA_PROFILE'" \
    "set PORTTA_PROFILE to one of: $PORTTA_PROFILES"
fi

portta_resolve_profile "$PORTTA_PROFILE" >/dev/null 2>&1 || true

if [ -f "$PORTTA_ROOT/.env" ]; then
  check pass config.env ".env" "present" ""
else
  check warn config.env ".env" "absent; running on built-in defaults" \
    "cp .env.example .env"
fi

# ---------------------------------------------------------------------------
# 2. The runtime: the one thing Portta genuinely requires
# ---------------------------------------------------------------------------

if ! portta_have docker; then
  check fail runtime.docker "docker engine" "docker not found in PATH" \
    "install OrbStack (macOS) or Docker Engine (Linux)"
elif docker info >/dev/null 2>&1; then
  dver=$(portta_docker_server_version)
  dmaj=$(portta_version_major "$dver")
  if [ "${dmaj:-0}" -ge "$PORTTA_MIN_DOCKER_MAJOR" ] 2>/dev/null; then
    check pass runtime.docker "docker engine" "$dver" ""
  else
    check warn runtime.docker "docker engine" "$dver is below the tested minimum $PORTTA_MIN_DOCKER_MAJOR" \
      "upgrade Docker / OrbStack"
  fi
else
  check fail runtime.docker "docker engine" "daemon unreachable" \
    "start OrbStack or Docker Desktop, or check DOCKER_HOST"
fi

if docker compose version >/dev/null 2>&1; then
  cver=$(portta_compose_version)
  cmaj=$(portta_version_major "$cver")
  if [ "${cmaj:-0}" -ge "$PORTTA_MIN_COMPOSE_MAJOR" ] 2>/dev/null; then
    check pass runtime.compose "docker compose" "$cver" ""
  else
    check fail runtime.compose "docker compose" "v$cver is too old" \
      "install the Compose v2 plugin"
  fi
else
  check fail runtime.compose "docker compose" "plugin missing" \
    "install the Docker Compose v2 plugin"
fi

# ---------------------------------------------------------------------------
# 3. The shared network, which `up` cannot create for itself
# ---------------------------------------------------------------------------
# It is declared external on purpose: it outlives the stack, so a housekeeping
# sweep on the host can remove it and nothing brings it back.

if portta_network_exists "$PORTTA_NETWORK"; then
  check pass network.shared "shared network" \
    "$PORTTA_NETWORK ($(portta_network_endpoints "$PORTTA_NETWORK") attached)" ""
else
  check fail network.shared "shared network" "'$PORTTA_NETWORK' does not exist" \
    "portta bootstrap"
fi

# ---------------------------------------------------------------------------
# 4. Whether the Compose files this profile selects render at all
# ---------------------------------------------------------------------------
# The one check that reads the whole configuration. A broken overlay makes `up`
# fail with a message about YAML rather than about the gateway.

if docker compose version >/dev/null 2>&1; then
  if portta_compose "$PORTTA_PROFILE" config --quiet >/dev/null 2>&1; then
    check pass config.compose "compose configuration" "renders for the $PORTTA_PROFILE profile" ""
  else
    check fail config.compose "compose configuration" \
      "the $PORTTA_PROFILE profile does not render" \
      "portta inspect   shows the file list; the error is above"
  fi
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

if [ "$AS_JSON" = "1" ]; then
  printf '{\n  "version": "%s",\n  "profile": "%s",\n  "failures": %s,\n  "warnings": %s,\n  "checks": [\n' \
    "$(portta_version)" "$PORTTA_PROFILE" "$PORTTA_FAILURES" "$PORTTA_WARNINGS"
  first=1
  while IFS="$(printf '\t')" read -r status id title detail fix; do
    [ -n "${status:-}" ] || continue
    [ "$first" = "1" ] || printf ',\n'
    first=0
    printf '    {"id": "%s", "status": "%s", "title": "%s", "detail": "%s", "fix": "%s"}' \
      "$(portta_json_escape "$id")" "$status" "$(portta_json_escape "$title")" \
      "$(portta_json_escape "$detail")" "$(portta_json_escape "$fix")"
  done < "$PORTTA_RESULTS"
  printf '\n  ]\n}\n'
else
  printf '%s\n\n' "$(portta_bold "Portta doctor")" >&2
  while IFS="$(printf '\t')" read -r status id title detail fix; do
    [ -n "${status:-}" ] || continue
    case "$status" in
      pass) badge=$(portta_c '32' ' ok ') ;;
      warn) badge=$(portta_c '33' 'warn') ;;
      fail) badge=$(portta_c '31' 'fail') ;;
      *) badge="$status" ;;
    esac
    printf '[%s] %-34s %s\n' "$badge" "$title" "$detail" >&2
    if [ -n "$fix" ] && [ "$status" != "pass" ]; then
      hint "$fix"
    fi
  done < "$PORTTA_RESULTS"

  printf '\n' >&2
  if [ "$PORTTA_FAILURES" -gt 0 ]; then
    err "$PORTTA_FAILURES failure(s), $PORTTA_WARNINGS warning(s)"
  elif [ "$PORTTA_WARNINGS" -gt 0 ]; then
    warn "no failures, $PORTTA_WARNINGS warning(s)"
  else
    ok "all checks passed"
  fi
  printf '\n' >&2
  hint "this is the fallback diagnostic; the full one needs Node 22.12+"
fi

[ "$PORTTA_FAILURES" -eq 0 ] || exit 1
exit 0
