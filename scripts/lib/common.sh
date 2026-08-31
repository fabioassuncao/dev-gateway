#!/usr/bin/env bash
# Dev Gateway: shared shell helpers.
#
# Targets bash 3.2 (the version macOS still ships), so: no associative arrays,
# no ${var,,}, no mapfile. Sourced by bin/dev-gateway and scripts/*.sh.

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# DG_ROOT is the repository root, resolved from this file's location so the
# CLI works when called through a symlink or from any working directory.
dg_resolve_root() {
  local src="${BASH_SOURCE[0]}" dir
  while [ -L "$src" ]; do
    dir=$(cd -P "$(dirname "$src")" && pwd)
    src=$(readlink "$src")
    case "$src" in
      /*) ;;
      *) src="$dir/$src" ;;
    esac
  done
  cd -P "$(dirname "$src")/../.." && pwd
}

DG_ROOT="${DG_ROOT:-$(dg_resolve_root)}"
export DG_ROOT

DG_STATE_DIR="$DG_ROOT/state"
export DG_STATE_DIR

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

DG_COLOR_ENABLED=0
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
  DG_COLOR_ENABLED=1
fi

dg_c() { # dg_c <ansi-code> <text>
  if [ "$DG_COLOR_ENABLED" = "1" ]; then
    printf '\033[%sm%s\033[0m' "$1" "$2"
  else
    printf '%s' "$2"
  fi
}

dg_bold() { dg_c "1" "$1"; }
dg_dim() { dg_c "2" "$1"; }

# All diagnostics go to stderr so `--json` output on stdout stays parseable.
info() { printf '%s %s\n' "$(dg_c '34' '::')" "$*" >&2; }
ok()   { printf '%s %s\n' "$(dg_c '32' 'ok')" "$*" >&2; }
warn() { printf '%s %s\n' "$(dg_c '33' 'warn')" "$*" >&2; }
err()  { printf '%s %s\n' "$(dg_c '31' 'error')" "$*" >&2; }

die() { err "$*"; exit 1; }

step() { printf '\n%s\n' "$(dg_bold "$*")" >&2; }

# hint <text>: an actionable suggestion printed under an error or warning.
hint() { printf '   %s %s\n' "$(dg_dim '->')" "$*" >&2; }

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

# dg_load_env: read .env into the environment without executing it.
#
# Mirrors Compose precedence: a variable already set in the shell wins over the
# file, so `DEV_GATEWAY_DOMAIN=foo ./bin/dev-gateway up` behaves as expected.
# The file is parsed, never sourced: a stray backtick in a value must not run.
dg_load_env() {
  local file="${1:-$DG_ROOT/.env}"
  [ -f "$file" ] || return 0

  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac

    key=${line%%=*}
    value=${line#*=}

    # `export FOO=bar` is valid in a .env read by some tools; tolerate it.
    key=${key#export }
    # Trim surrounding whitespace from the key.
    key=$(printf '%s' "$key" | tr -d '[:space:]')

    case "$key" in
      ''|*[!A-Za-z0-9_]*) continue ;;
    esac

    # Strip one layer of matching quotes, then trailing whitespace.
    case "$value" in
      \"*\") value=${value#\"}; value=${value%\"} ;;
      \'*\') value=${value#\'}; value=${value%\'} ;;
      *) value=${value%"${value##*[![:space:]]}"} ;;
    esac

    # Shell environment wins over the file. Indirect expansion rather than
    # eval, so a crafted key can never be executed even if the filter above
    # were ever loosened.
    if [ -z "${!key+set}" ]; then
      export "$key=$value"
    fi
  done < "$file"
}

# dg_defaults: fill in every value the CLI relies on.
# Runs after dg_load_env so an empty (or missing) .env still yields a usable
# local gateway. Keep these in sync with .env.example.
dg_defaults() {
  : "${DEV_GATEWAY_PROFILE:=local}"
  : "${DEV_GATEWAY_PROJECT_NAME:=dev-gateway}"
  : "${DEV_GATEWAY_NETWORK:=dev-gateway}"
  : "${DEV_GATEWAY_CONTROL_NETWORK:=dev-gateway-control}"
  : "${DEV_GATEWAY_ACCESS_NETWORK:=dev-gateway-access}"
  : "${DEV_GATEWAY_DOMAIN:=localhost}"
  : "${DEV_GATEWAY_BIND_ADDRESS:=127.0.0.1}"
  : "${DEV_GATEWAY_HTTP_PORT:=80}"
  : "${DEV_GATEWAY_HTTPS_PORT:=443}"
  : "${DEV_GATEWAY_LOG_LEVEL:=INFO}"
  : "${DEV_GATEWAY_ACCESS_LOG:=false}"
  : "${DEV_GATEWAY_ALIAS_HEADERS_STRATEGY:=keep}"
  : "${DEV_GATEWAY_DASHBOARD:=false}"
  : "${DEV_GATEWAY_DASHBOARD_BIND_ADDRESS:=127.0.0.1}"
  : "${DEV_GATEWAY_DASHBOARD_PORT:=8080}"
  : "${TLS_ENABLED:=false}"
  : "${TLS_MODE:=local}"
  : "${ACME_CA_SERVER:=https://acme-v02.api.letsencrypt.org/directory}"
  : "${ACME_DNS_PROVIDER:=cloudflare}"
  : "${ACME_DNS_RESOLVERS:=1.1.1.1:53,8.8.8.8:53}"
  : "${TAILSCALE_ENABLED:=false}"
  : "${TAILSCALE_HOSTNAME:=dev-gateway}"
  : "${PUBLIC_ENABLED:=false}"
  : "${CLOUDFLARE_ENABLED:=false}"

  export DEV_GATEWAY_PROFILE DEV_GATEWAY_PROJECT_NAME DEV_GATEWAY_NETWORK \
    DEV_GATEWAY_CONTROL_NETWORK DEV_GATEWAY_ACCESS_NETWORK DEV_GATEWAY_DOMAIN \
    DEV_GATEWAY_BIND_ADDRESS DEV_GATEWAY_HTTP_PORT DEV_GATEWAY_HTTPS_PORT \
    DEV_GATEWAY_LOG_LEVEL DEV_GATEWAY_ACCESS_LOG DEV_GATEWAY_ALIAS_HEADERS_STRATEGY \
    DEV_GATEWAY_DASHBOARD \
    DEV_GATEWAY_DASHBOARD_BIND_ADDRESS DEV_GATEWAY_DASHBOARD_PORT \
    TLS_ENABLED TLS_MODE ACME_CA_SERVER ACME_DNS_PROVIDER ACME_DNS_RESOLVERS \
    TAILSCALE_ENABLED TAILSCALE_HOSTNAME PUBLIC_ENABLED CLOUDFLARE_ENABLED
}

dg_version() {
  if [ -f "$DG_ROOT/VERSION" ]; then
    tr -d '[:space:]' < "$DG_ROOT/VERSION"
  else
    printf 'unknown'
  fi
}

# dg_env_set <key> <value> [file]: set a value in .env in place.
#
# Rewrites the line if the key is present (keeping its position and the
# comments around it) and appends otherwise. Writes through a temporary file in
# the same directory so an interrupted run cannot truncate the user's config.
dg_env_set() {
  local key="$1" value="$2" file="${3:-$DG_ROOT/.env}" tmp

  case "$key" in
    ''|*[!A-Za-z0-9_]*) err "refusing to write invalid .env key: $key"; return 1 ;;
  esac

  if [ ! -f "$file" ]; then
    printf '%s=%s\n' "$key" "$value" > "$file"
    chmod 600 "$file"
    return 0
  fi

  tmp="$file.dg-tmp.$$"
  if grep -q "^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}$key=" "$file"; then
    awk -v k="$key" -v v="$value" '
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?" k "=" { print k "=" v; next }
      { print }
    ' "$file" > "$tmp"
  else
    cp "$file" "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi

  chmod 600 "$tmp"
  mv "$tmp" "$file"
  export "$key=$value"
}

# ---------------------------------------------------------------------------
# Predicates
# ---------------------------------------------------------------------------

# dg_is_true <value>: accepts the spellings people actually write in .env.
dg_is_true() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled) return 0 ;;
    *) return 1 ;;
  esac
}

dg_have() { command -v "$1" >/dev/null 2>&1; }

# dg_confirm <prompt>: returns 0 on yes. Non-interactive callers must pass
# --yes explicitly; we never assume consent when there is no tty.
dg_confirm() {
  local prompt="$1" reply
  if dg_is_true "${DG_ASSUME_YES:-}"; then
    return 0
  fi
  if [ ! -t 0 ]; then
    err "$prompt"
    hint "no terminal available to confirm; re-run with --yes to proceed"
    return 1
  fi
  printf '%s [y/N] ' "$prompt" >&2
  read -r reply
  case "$reply" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

# dg_slug <text>: DNS-safe label: lowercase, [a-z0-9-], no leading/trailing
# dash, collapsed dashes. Mirrors Traefik's `normalize` closely enough that a
# hostname printed by `urls` matches the one Traefik generates.
dg_slug() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]/-/g' -e 's/--*/-/g' -e 's/^-//' -e 's/-$//'
}

# dg_json_escape <text>: minimal JSON string escaping for hand-built output.
dg_json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g'
}
