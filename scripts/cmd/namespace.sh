#!/usr/bin/env bash
# `dev-gateway namespace`: derive a COMPOSE_PROJECT_NAME.
#
# The namespace is the whole mechanism behind parallel environments: Compose
# derives container, network and volume names from it, and the gateway derives
# hostnames from it. Getting one by hand is easy to get subtly wrong, so this
# generates a deterministic, DNS-safe one.

# Docker Compose accepts long project names, but the value also becomes a DNS
# label in <project>-<service>.<domain>, and a label is capped at 63 characters.
# Leave room for the longest plausible service name.
DG_NS_MAX=40

dg_cmd_namespace() {
  local base="" suffix="" path="" check=1

  while [ $# -gt 0 ]; do
    case "$1" in
      --base) shift; base="${1:-}" ;;
      --base=*) base="${1#--base=}" ;;
      --suffix) shift; suffix="${1:-}" ;;
      --suffix=*) suffix="${1#--suffix=}" ;;
      --path) shift; path="${1:-}" ;;
      --path=*) path="${1#--path=}" ;;
      --no-check) check=0 ;;
      -h|--help)
        cat >&2 <<'DG_HELP'
dev-gateway namespace: derive a COMPOSE_PROJECT_NAME

  --path <dir>      Derive from this directory (default: the current one)
  --base <name>     Base name, overriding what the path suggests
  --suffix <text>   Appended to the base, e.g. an issue or agent id
  --no-check        Skip the collision check against running projects

With no arguments, in a git repository, the name comes from the repository and
the current branch, so a worktree gets a distinct namespace on its own:

  ~/my-project          on main      -> my-project
  ~/my-project-issue59  on issue59   -> my-project-issue59

The result is lowercase [a-z0-9-], collapsed, trimmed, and short enough to be a
DNS label once a service name is appended.
DG_HELP
        return 0 ;;
      -*) die "unknown flag: $1" ;;
      *) base="$1" ;;
    esac
    shift
  done

  local dir="${path:-$PWD}"
  [ -d "$dir" ] || { err "not a directory: $dir"; return 1; }

  if [ -z "$base" ]; then
    base=$(dg_ns_derive_base "$dir")
  fi
  if [ -z "$suffix" ]; then
    suffix=$(dg_ns_derive_suffix "$dir")
  fi

  local name
  name=$(dg_ns_compose "$base" "$suffix")

  [ -n "$name" ] || { err "could not derive a namespace from $dir"; return 1; }

  printf '%s\n' "$name"

  if [ "$check" = "1" ] && dg_require_docker >/dev/null 2>&1; then
    if dg_compose_projects | grep -qx "$name"; then
      warn "a Compose project named '$name' is already running"
      hint "if that is not this environment, add a --suffix to keep them apart"
    fi
  fi
}

# dg_ns_derive_base <dir>: the repository name, or the directory name.
dg_ns_derive_base() {
  local dir="$1" top url
  if top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null); then
    # A worktree's directory is often named after the branch, so the repository
    # name comes from the remote when there is one: it is the stable part.
    url=$(git -C "$dir" remote get-url origin 2>/dev/null || true)
    if [ -n "$url" ]; then
      printf '%s' "$(basename "$url" .git)"
      return 0
    fi
    printf '%s' "$(basename "$top")"
    return 0
  fi
  printf '%s' "$(basename "$dir")"
}

# dg_ns_derive_suffix <dir>: the branch, unless it is the trunk.
dg_ns_derive_suffix() {
  local dir="$1" branch
  branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null) || return 0
  case "$branch" in
    main|master|trunk|develop|HEAD) return 0 ;;
  esac
  printf '%s' "$branch"
}

# dg_ns_compose <base> <suffix>: sanitize, join, and fit the length budget.
dg_ns_compose() {
  local base suffix name
  base=$(dg_slug "${1:-}")
  suffix=$(dg_slug "${2:-}")

  if [ -n "$suffix" ]; then
    # A branch like `feature/my-project-search` already carries the base;
    # repeating it produces an unreadable name for no benefit.
    case "$suffix" in
      "$base"|"$base"-*) name="$suffix" ;;
      *) name="$base-$suffix" ;;
    esac
  else
    name="$base"
  fi

  if [ "${#name}" -gt "$DG_NS_MAX" ]; then
    # Truncating is deterministic, but two long branches can then collide, so
    # keep a short digest of the full name to tell them apart.
    local digest
    digest=$(printf '%s' "$name" | cksum | awk '{printf "%x", $1}' | cut -c1-6)
    name="$(printf '%s' "$name" | cut -c1-$((DG_NS_MAX - 7)))-$digest"
  fi

  # Truncation can leave a trailing dash, which is not a valid DNS label.
  printf '%s' "$name" | sed -e 's/-*$//' -e 's/^-*//'
}
