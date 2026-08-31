#!/usr/bin/env bash
# Minimal assertion helpers.
#
# Deliberately dependency-free: the gateway's promise is that a host needs only
# Docker, Git and a shell, and the test suite has to hold itself to that too.

DG_T_TOTAL=0
DG_T_FAILED=0
DG_T_SKIPPED=0
DG_T_CURRENT=""

_t_color() { [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && printf '\033[%sm%s\033[0m' "$1" "$2" || printf '%s' "$2"; }

describe() { printf '\n%s\n' "$(_t_color 1 "$1")"; }

it() {
  DG_T_CURRENT="$1"
  DG_T_TOTAL=$((DG_T_TOTAL + 1))
}

_t_pass() { printf '  %s %s\n' "$(_t_color 32 'ok')" "$DG_T_CURRENT"; }

_t_fail() {
  DG_T_FAILED=$((DG_T_FAILED + 1))
  printf '  %s %s\n' "$(_t_color 31 'FAIL')" "$DG_T_CURRENT"
  printf '       %s\n' "$1"
}

skip() {
  DG_T_SKIPPED=$((DG_T_SKIPPED + 1))
  DG_T_TOTAL=$((DG_T_TOTAL - 1))
  printf '  %s %s\n' "$(_t_color 33 'skip')" "${DG_T_CURRENT}${1:+: $1}"
}

assert_eq() { # assert_eq <expected> <actual>
  if [ "$1" = "$2" ]; then _t_pass; else _t_fail "expected '$1', got '$2'"; fi
}

assert_ne() {
  if [ "$1" != "$2" ]; then _t_pass; else _t_fail "expected something other than '$1'"; fi
}

assert_contains() { # assert_contains <haystack> <needle>
  case "$1" in
    *"$2"*) _t_pass ;;
    *) _t_fail "expected output to contain '$2'; got: $(printf '%s' "$1" | head -c 400)" ;;
  esac
}

assert_not_contains() {
  case "$1" in
    *"$2"*) _t_fail "expected output NOT to contain '$2'" ;;
    *) _t_pass ;;
  esac
}

assert_success() { # assert_success <command...>
  local out
  if out=$("$@" 2>&1); then _t_pass; else _t_fail "command failed (exit $?): $* -> $(printf '%s' "$out" | tail -3)"; fi
}

assert_failure() { # assert_failure <command...>
  local out
  if out=$("$@" 2>&1); then _t_fail "expected failure but the command succeeded: $*"; else _t_pass; fi
}

t_summary() {
  printf '\n'
  if [ "$DG_T_FAILED" -eq 0 ]; then
    printf '%s  %s passed, %s skipped\n' "$(_t_color 32 'PASS')" "$DG_T_TOTAL" "$DG_T_SKIPPED"
    return 0
  fi
  printf '%s  %s of %s failed, %s skipped\n' "$(_t_color 31 'FAIL')" "$DG_T_FAILED" "$DG_T_TOTAL" "$DG_T_SKIPPED"
  return 1
}
