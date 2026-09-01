#!/usr/bin/env bash
# Portta: shared shell helpers.
#
# Targets bash 3.2 (the version macOS still ships), so: no associative arrays,
# no ${var,,}, no mapfile. Sourced by bin/portta and scripts/*.sh.

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

# PORTTA_ROOT is the repository root, resolved from this file's location so the
# CLI works when called through a symlink or from any working directory.
portta_resolve_root() {
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

PORTTA_ROOT="${PORTTA_ROOT:-$(portta_resolve_root)}"
export PORTTA_ROOT

PORTTA_STATE_DIR="$PORTTA_ROOT/state"
export PORTTA_STATE_DIR

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

PORTTA_COLOR_ENABLED=0
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
  PORTTA_COLOR_ENABLED=1
fi

portta_c() { # portta_c <ansi-code> <text>
  if [ "$PORTTA_COLOR_ENABLED" = "1" ]; then
    printf '\033[%sm%s\033[0m' "$1" "$2"
  else
    printf '%s' "$2"
  fi
}

portta_bold() { portta_c "1" "$1"; }
portta_dim() { portta_c "2" "$1"; }

# All diagnostics go to stderr so `--json` output on stdout stays parseable.
info() { printf '%s %s\n' "$(portta_c '34' '::')" "$*" >&2; }
ok()   { printf '%s %s\n' "$(portta_c '32' 'ok')" "$*" >&2; }
warn() { printf '%s %s\n' "$(portta_c '33' 'warn')" "$*" >&2; }
err()  { printf '%s %s\n' "$(portta_c '31' 'error')" "$*" >&2; }

die() { err "$*"; exit 1; }

step() { printf '\n%s\n' "$(portta_bold "$*")" >&2; }

# hint <text>: an actionable suggestion printed under an error or warning.
hint() { printf '   %s %s\n' "$(portta_dim '->')" "$*" >&2; }

# A bootstrap secret, written straight to .env and never printed. `od` is in
# POSIX userlands (including macOS) and the finite pipeline cannot SIGPIPE.
portta_random_hex() {
  LC_ALL=C od -An -N "${1:-32}" -tx1 /dev/urandom | tr -d ' \n'
}

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

# portta_load_env: read .env into the environment without executing it.
#
# Mirrors Compose precedence: a variable already set in the shell wins over the
# file, so `PORTTA_DOMAIN=foo ./bin/portta up` behaves as expected.
# The file is parsed, never sourced: a stray backtick in a value must not run.
portta_load_env() {
  local file="${1:-$PORTTA_ROOT/.env}"
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

# portta_defaults: fill in every value the CLI relies on.
# Runs after portta_load_env so an empty (or missing) .env still yields a usable
# local gateway. Keep these in sync with .env.example.
portta_defaults() {
  : "${PORTTA_PROFILE:=local}"
  : "${PORTTA_PROJECT_NAME:=portta}"
  : "${PORTTA_NETWORK:=portta}"
  : "${PORTTA_CONTROL_NETWORK:=portta-control}"
  : "${PORTTA_ACCESS_NETWORK:=portta-access}"
  : "${PORTTA_DOMAIN:=localhost}"
  : "${PORTTA_BIND_ADDRESS:=127.0.0.1}"
  : "${PORTTA_HTTP_PORT:=80}"
  : "${PORTTA_HTTPS_PORT:=443}"
  : "${PORTTA_LOG_LEVEL:=INFO}"
  : "${PORTTA_ACCESS_LOG:=false}"
  : "${PORTTA_ALIAS_HEADERS_STRATEGY:=keep}"
  : "${PORTTA_DASHBOARD:=false}"
  : "${PORTTA_DASHBOARD_BIND_ADDRESS:=127.0.0.1}"
  : "${PORTTA_DASHBOARD_PORT:=8080}"
  : "${PORTTA_WEB:=false}"
  : "${PORTTA_WEB_BIND_ADDRESS:=127.0.0.1}"
  : "${PORTTA_WEB_PORT:=8081}"
  : "${PORTTA_WEB_DEV_PORT:=5173}"
  : "${PORTTA_WEB_DEV:=false}"
  : "${PORTTA_WEB_EXPOSE:=local}"
  : "${PORTTA_WEB_HOST:=portta-web}"
  : "${PORTTA_WEB_NETWORK:=portta-web}"
  : "${PORTTA_WEB_READ_ONLY:=false}"
  : "${PORTTA_WEB_BUILD:=false}"
  : "${PORTTA_WEB_IMAGE:=}"
  : "${PORTTA_PANEL_ADVERTISED_HOST:=}"
  : "${PORTTA_WEB_AUTH:=none}"
  : "${PORTTA_WEB_AUTH_USER:=}"
  : "${PORTTA_WEB_AUTH_HASH:=}"
  : "${PORTTA_RUNTIME_API_DOCS:=}"
  : "${PORTTA_DB_NETWORK:=portta-data}"
  : "${PORTTA_DB_VOLUME:=portta-db}"
  : "${PORTTA_RUNTIME_DB_PASSWORD:=}"
  : "${PORTTA_RUNTIME_DATABASE_URL:=}"
  : "${PORTTA_TCP:=false}"
  : "${PORTTA_TCP_POSTGRES_PORT:=5432}"
  : "${PORTTA_TCP_REDIS_PORT:=6379}"
  : "${TLS_ENABLED:=false}"
  : "${TLS_MODE:=local}"
  : "${ACME_CA_SERVER:=https://acme-v02.api.letsencrypt.org/directory}"
  : "${ACME_DNS_PROVIDER:=cloudflare}"
  : "${ACME_DNS_RESOLVERS:=1.1.1.1:53,8.8.8.8:53}"
  : "${TAILSCALE_ENABLED:=false}"
  : "${TAILSCALE_HOSTNAME:=portta}"
  : "${PUBLIC_ENABLED:=false}"
  : "${CLOUDFLARE_ENABLED:=false}"

  if [ -z "$PORTTA_RUNTIME_API_DOCS" ]; then
    if [ "$PORTTA_WEB_EXPOSE" = "local" ]; then
      PORTTA_RUNTIME_API_DOCS=true
    else
      PORTTA_RUNTIME_API_DOCS=false
    fi
  fi

  export PORTTA_PROFILE PORTTA_PROJECT_NAME PORTTA_NETWORK \
    PORTTA_CONTROL_NETWORK PORTTA_ACCESS_NETWORK PORTTA_DOMAIN \
    PORTTA_BIND_ADDRESS PORTTA_HTTP_PORT PORTTA_HTTPS_PORT \
    PORTTA_LOG_LEVEL PORTTA_ACCESS_LOG PORTTA_ALIAS_HEADERS_STRATEGY \
    PORTTA_DASHBOARD \
    PORTTA_DASHBOARD_BIND_ADDRESS PORTTA_DASHBOARD_PORT \
    PORTTA_WEB PORTTA_WEB_BIND_ADDRESS PORTTA_WEB_PORT \
    PORTTA_WEB_DEV_PORT PORTTA_WEB_DEV PORTTA_WEB_EXPOSE \
    PORTTA_WEB_HOST PORTTA_WEB_NETWORK PORTTA_WEB_READ_ONLY \
    PORTTA_WEB_BUILD PORTTA_WEB_IMAGE PORTTA_PANEL_ADVERTISED_HOST \
    PORTTA_WEB_AUTH PORTTA_WEB_AUTH_USER PORTTA_WEB_AUTH_HASH \
    PORTTA_RUNTIME_API_DOCS PORTTA_DB_NETWORK PORTTA_DB_VOLUME \
    PORTTA_RUNTIME_DB_PASSWORD PORTTA_RUNTIME_DATABASE_URL \
    PORTTA_TCP PORTTA_TCP_POSTGRES_PORT PORTTA_TCP_REDIS_PORT \
    TLS_ENABLED TLS_MODE ACME_CA_SERVER ACME_DNS_PROVIDER ACME_DNS_RESOLVERS \
    TAILSCALE_ENABLED TAILSCALE_HOSTNAME PUBLIC_ENABLED CLOUDFLARE_ENABLED
}

portta_version() {
  if [ -f "$PORTTA_ROOT/VERSION" ]; then
    tr -d '[:space:]' < "$PORTTA_ROOT/VERSION"
  else
    printf 'unknown'
  fi
}

# portta_env_set <key> <value> [file]: set a value in .env in place.
#
# Rewrites the line if the key is present (keeping its position and the
# comments around it) and appends otherwise. Writes through a temporary file in
# the same directory so an interrupted run cannot truncate the user's config.
portta_env_set() {
  local key="$1" value="$2" file="${3:-$PORTTA_ROOT/.env}" tmp

  case "$key" in
    ''|*[!A-Za-z0-9_]*) err "refusing to write invalid .env key: $key"; return 1 ;;
  esac

  if [ ! -f "$file" ]; then
    printf '%s=%s\n' "$key" "$value" > "$file"
    chmod 600 "$file"
    return 0
  fi

  tmp="$file.portta-tmp.$$"
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

# portta_is_true <value>: accepts the spellings people actually write in .env.
portta_is_true() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled) return 0 ;;
    *) return 1 ;;
  esac
}

portta_have() { command -v "$1" >/dev/null 2>&1; }

# portta_confirm <prompt>: returns 0 on yes. Non-interactive callers must pass
# --yes explicitly; we never assume consent when there is no tty.
portta_confirm() {
  local prompt="$1" reply
  if portta_is_true "${PORTTA_ASSUME_YES:-}"; then
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

# portta_slug <text>: DNS-safe label: lowercase, [a-z0-9-], no leading/trailing
# dash, collapsed dashes. Mirrors Traefik's `normalize` closely enough that a
# hostname printed by `urls` matches the one Traefik generates.
portta_slug() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9]/-/g' -e 's/--*/-/g' -e 's/^-//' -e 's/-$//'
}

# portta_json_escape <text>: minimal JSON string escaping for hand-built output.
portta_json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g'
}

# Octal permission bits of a file, portable between GNU and BSD stat. Empty
# when the file is gone or neither form works, so callers say "unknown" rather
# than guessing a mode is safe.
portta_file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null || printf ''
}
