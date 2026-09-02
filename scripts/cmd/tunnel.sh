#!/usr/bin/env bash
# `portta tunnel`: publish over HTTPS without opening a port.
#
# Cloudflare Tunnel is an optional exposure provider, never a dependency
# ([ADR 0025](../../docs/adr/0025-cloudflare-tunnel.md)). Nothing here runs, and
# no container exists, until somebody enables it.
#
# What this command owns, and what it deliberately does not:
#
#   Portta      writes the connector's config and credentials, runs the
#               container, reports what it observes
#   Cloudflare  the tunnel, the DNS record and any Access policy — all created
#               by the operator, in their own account, and never touched here
#
# Portta holds no Cloudflare API token and cannot change that account. It asks
# for the tunnel token, which is the credential the connector needs and nothing
# more: it cannot create, delete or reconfigure anything in the dashboard.

PORTTA_TUNNEL_DIR_REL="state/cloudflared"

portta_cmd_tunnel() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    status) portta_tunnel_status "$@" ;;
    setup) portta_tunnel_setup "$@" ;;
    enable) portta_tunnel_enable "$@" ;;
    disable) portta_tunnel_disable "$@" ;;
    test) portta_tunnel_test "$@" ;;
    logs) portta_tunnel_logs "$@" ;;
    -h|--help|help)
      cat >&2 <<'PORTTA_HELP'
portta tunnel: publish services over HTTPS with no open port

  tunnel status              Show the connector's state and the routes it serves
  tunnel setup               Write the connector configuration from a tunnel token
  tunnel enable              Start the connector
  tunnel disable             Stop the connector, keeping the configuration
  tunnel test                Check that the tunnel is carrying traffic
  tunnel logs [-n <lines>]   Show the connector's own output

Setup reads the token from a file or from a prompt, never from an argument:
a token on a command line is visible in `ps` to every user on the host.

  portta tunnel setup --zone example.com --token-file ./token.txt
  portta tunnel setup --zone example.com          # prompts for the token

Create the tunnel first at https://one.dash.cloudflare.com -> Networks ->
Tunnels, then point *.<zone> at it with one DNS record. `tunnel setup` prints
the exact record. See docs/cloudflare-tunnel.md.
PORTTA_HELP
      return 0 ;;
    *) err "unknown tunnel command: $sub"; hint "portta tunnel --help"; return 1 ;;
  esac
}

portta_tunnel_dir() { printf '%s' "$PORTTA_ROOT/$PORTTA_TUNNEL_DIR_REL"; }

# portta_tunnel_container: the connector's container name for this project.
portta_tunnel_container() {
  printf '%s-cloudflared-1' "${PORTTA_PROJECT_NAME:-portta}"
}

# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------

portta_tunnel_setup() {
  local zone="" token="" token_file="" origin="" apex=false

  while [ $# -gt 0 ]; do
    case "$1" in
      --zone) zone="${2:-}"; shift 2 ;;
      --token-file) token_file="${2:-}"; shift 2 ;;
      --origin) origin="${2:-}"; shift 2 ;;
      --apex) apex=true; shift ;;
      # Deliberately absent: --token. A credential passed as an argument is
      # visible in `ps` and in the shell history of whoever ran it.
      --token)
        err "a token must not be passed as an argument: it would be visible in \`ps\` and in your shell history"
        hint "portta tunnel setup --zone $zone --token-file <file>, or omit it to be prompted"
        return 1 ;;
      *) err "unknown option: $1"; return 1 ;;
    esac
  done

  [ -n "$zone" ] || { err "--zone is required"; hint "the domain whose wildcard points at the tunnel, e.g. example.com"; return 1; }

  if [ -n "$token_file" ]; then
    [ -f "$token_file" ] || { err "no such file: $token_file"; return 1; }
    token=$(tr -d '[:space:]' < "$token_file")
  else
    # Read from the terminal, not stdin: this command may be piped.
    printf 'Tunnel token (input is hidden): ' >&2
    if [ -r /dev/tty ]; then
      read -rs token < /dev/tty || true
      printf '\n' >&2
    else
      err "no terminal available to read the token"
      hint "portta tunnel setup --zone $zone --token-file <file>"
      return 1
    fi
  fi
  [ -n "$token" ] || { err "no token was given"; return 1; }

  local dir; dir=$(portta_tunnel_dir)
  mkdir -p "$dir"
  # The directory holds a credential; nothing else on the host needs to read it.
  chmod 700 "$dir"

  # Decoding is the shared implementation's job, so the CLI and the panel accept
  # and reject exactly the same strings. Without Node the token is still usable:
  # the fallback decodes the same three fields with base64 and sed.
  local tunnel_id=""
  if portta_have node && [ -f "$PORTTA_ROOT/packages/core/dist/tunnel.js" ]; then
    tunnel_id=$(printf '%s' "$token" | node --input-type=module -e '
      import { parseTunnelToken, renderTunnelCredentials } from "'"$PORTTA_ROOT"'/packages/core/dist/tunnel.js"
      import { writeFileSync } from "node:fs"
      let input = ""
      for await (const chunk of process.stdin) input += chunk
      try {
        const credentials = parseTunnelToken(input)
        writeFileSync(process.argv[1], renderTunnelCredentials(credentials), { mode: 0o600 })
        process.stdout.write(credentials.TunnelID)
      } catch (error) {
        process.stderr.write(error.message)
        process.exit(1)
      }
    ' "$dir/credentials.json" 2>&1) || { err "the token was refused: $tunnel_id"; return 1; }
  else
    tunnel_id=$(portta_tunnel_write_credentials "$token" "$dir/credentials.json") || return 1
  fi

  chmod 600 "$dir/credentials.json"

  # The origin is where the connector reaches the proxy. Under the Tailscale
  # attachment Traefik has no name of its own on the shared network, so the
  # container that owns the namespace is the right target.
  if [ -z "$origin" ]; then
    if [ "$(portta_attachment "${PORTTA_PROFILE:-local}")" = "tailscale" ]; then
      origin="http://tailscale:${PORTTA_HTTP_PORT:-80}"
    else
      origin="http://traefik:${PORTTA_HTTP_PORT:-80}"
    fi
  fi

  portta_tunnel_write_config "$tunnel_id" "$zone" "$origin" "$apex" > "$dir/config.yml" || return 1

  portta_env_set CLOUDFLARE_TUNNEL_ZONE "$zone"
  portta_env_set CLOUDFLARE_TUNNEL_ID "$tunnel_id"

  ok "the connector is configured"
  printf '\n'
  printf '  zone       %s\n' "$zone"
  printf '  tunnel     %s\n' "$tunnel_id"
  printf '  origin     %s\n' "$origin"
  printf '  routes     *.%s -> %s\n' "$zone" "$origin"
  printf '\n'
  printf 'One DNS record makes every project hostname work, now and in future:\n\n'
  printf '  Type    CNAME\n'
  printf '  Name    *.%s\n' "$zone"
  printf '  Target  %s.cfargotunnel.com\n' "$tunnel_id"
  printf '  Proxy   on (orange cloud)\n\n'
  printf 'Then: portta tunnel enable\n'
}

# portta_tunnel_write_credentials <token> <path>: the no-Node fallback.
#
# ADR 0015: the core commands must work on a host with nothing but Docker and a
# shell. Prints the tunnel id on success.
portta_tunnel_write_credentials() {
  local token="$1" path="$2" decoded account id secret
  decoded=$(printf '%s' "$token" | base64 -d 2>/dev/null) || {
    err "the token is not valid base64"
    hint "copy the whole eyJ... string from the Cloudflare dashboard, not the install command around it"
    return 1
  }
  account=$(printf '%s' "$decoded" | sed -n 's/.*"a" *: *"\([^"]*\)".*/\1/p')
  id=$(printf '%s' "$decoded" | sed -n 's/.*"t" *: *"\([^"]*\)".*/\1/p')
  secret=$(printf '%s' "$decoded" | sed -n 's/.*"s" *: *"\([^"]*\)".*/\1/p')
  if [ -z "$account" ] || [ -z "$id" ] || [ -z "$secret" ]; then
    err "the token is missing the account, tunnel or secret field"
    return 1
  fi
  ( umask 077; printf '{"AccountTag":"%s","TunnelID":"%s","TunnelSecret":"%s"}\n' "$account" "$id" "$secret" > "$path" )
  printf '%s' "$id"
}

# portta_tunnel_write_config <id> <zone> <origin> <apex>
#
# One wildcard rule for the whole gateway. Traefik does the routing; duplicating
# it here would mean a Cloudflare change per service, which is the thing this
# design exists to avoid.
portta_tunnel_write_config() {
  local id="$1" zone="$2" origin="$3" apex="$4"
  cat <<EOF
# ============================================================================
# Generated by Portta. Edits are overwritten.
# ============================================================================
# One rule for the whole gateway: every hostname under the zone reaches
# Traefik, which routes it by Host to the right container. Publishing a
# project therefore needs no change here and none at Cloudflare.
#
# See docs/adr/0025-cloudflare-tunnel.md.
# ============================================================================
tunnel: "$id"
credentials-file: /etc/cloudflared/credentials.json

# The original Host header is what Traefik routes on, and cloudflared passes it
# through untouched. \`httpHostHeader\` would overwrite it, which is why it is
# deliberately absent.
ingress:
EOF
  if [ "$apex" = "true" ]; then
    printf '  - hostname: "%s"\n    service: "%s"\n' "$zone" "$origin"
  fi
  cat <<EOF
  - hostname: "*.$zone"
    service: "$origin"

  # Required: a configuration with ingress rules must end in a catch-all.
  - service: http_status:404
EOF
}

# ---------------------------------------------------------------------------
# enable / disable
# ---------------------------------------------------------------------------

portta_tunnel_enable() {
  portta_tunnel_configured || {
    err "the connector is not configured"
    hint "portta tunnel setup --zone <domain>"
    return 1
  }
  portta_env_set CLOUDFLARE_TUNNEL_ENABLED true
  ok "Cloudflare Tunnel enabled"
  say "starting the connector"
  # The overlay is selected from the same variable, so `up` is all it takes.
  CLOUDFLARE_TUNNEL_ENABLED=true portta_compose "${PORTTA_PROFILE:-local}" up -d --remove-orphans || return 1
  portta_tunnel_status
}

portta_tunnel_disable() {
  local keep_config=true
  case "${1:-}" in --forget) keep_config=false ;; esac

  say "stopping the connector"
  # Stop before flipping the variable: once it is false the overlay is not
  # selected, and Compose would no longer know the container belongs to it.
  CLOUDFLARE_TUNNEL_ENABLED=true portta_compose "${PORTTA_PROFILE:-local}" rm -sf cloudflared >/dev/null 2>&1 || true
  portta_env_set CLOUDFLARE_TUNNEL_ENABLED false

  if [ "$keep_config" = "false" ]; then
    rm -f "$(portta_tunnel_dir)/config.yml" "$(portta_tunnel_dir)/credentials.json"
    portta_env_set CLOUDFLARE_TUNNEL_ID ""
    ok "the connector is stopped and its configuration removed"
  else
    ok "the connector is stopped; its configuration is kept for re-enabling"
  fi

  printf '\n'
  say "nothing was changed in your Cloudflare account"
  printf '  The tunnel, the DNS record and any Access policy are still there.\n'
  printf '  Remove them yourself if you want them gone.\n'
}

portta_tunnel_configured() {
  [ -f "$(portta_tunnel_dir)/config.yml" ] && [ -f "$(portta_tunnel_dir)/credentials.json" ]
}

# ---------------------------------------------------------------------------
# status / test / logs
# ---------------------------------------------------------------------------

portta_tunnel_logs() {
  local lines=50
  case "${1:-}" in -n|--lines) lines="${2:-50}" ;; esac
  docker logs --tail "$lines" "$(portta_tunnel_container)" 2>&1 || {
    err "the connector container does not exist"
    return 1
  }
}

# portta_tunnel_state: one of the states the panel reports, on stdout.
portta_tunnel_state() {
  local container state health logs
  container=$(portta_tunnel_container)

  if ! portta_tunnel_configured; then printf 'not-configured'; return 0; fi
  if ! portta_is_true "${CLOUDFLARE_TUNNEL_ENABLED:-false}"; then printf 'configured'; return 0; fi

  state=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || printf '')
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || printf '')
  logs=$(docker logs --tail 200 "$container" 2>&1 || printf '')

  # A rejected credential is checked first: the container is running perfectly
  # and the tunnel will never come up, so "disconnected" would point at the
  # network instead of the token.
  case "$logs" in
    *Unauthorized*|*"failed to authenticate"*|*"invalid tunnel secret"*) printf 'auth-error'; return 0 ;;
  esac
  case "$logs" in
    *"Couldn't start tunnel"*|*"validation failed"*|*"error parsing YAML"*) printf 'config-error'; return 0 ;;
  esac
  [ "$state" = "running" ] || { printf 'disconnected'; return 0; }
  case "$logs" in
    *"Registered tunnel connection"*) printf 'connected'; return 0 ;;
  esac
  [ "$health" = "starting" ] && { printf 'starting'; return 0; }
  printf 'disconnected'
}

portta_tunnel_status() {
  local state zone id container cstate
  state=$(portta_tunnel_state)
  zone="${CLOUDFLARE_TUNNEL_ZONE:-}"
  id="${CLOUDFLARE_TUNNEL_ID:-}"
  container=$(portta_tunnel_container)
  cstate=$(docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || printf 'absent')

  printf '\n'
  printf '%s\n' "$(portta_bold "Cloudflare Tunnel")"
  printf '\n'
  printf '  state       %s\n' "$state"
  printf '  domain      %s\n' "${zone:-<unset>}"
  [ -n "$zone" ] && printf '  wildcard    *.%s\n' "$zone"
  printf '  tunnel      %s\n' "${id:-<unset>}"
  printf '  connector   %s (%s)\n' "$container" "$cstate"
  # The token is never printed, only whether there is one.
  if [ -f "$(portta_tunnel_dir)/credentials.json" ]; then
    printf '  credential  configured\n'
  else
    printf '  credential  not set\n'
  fi
  printf '\n'

  case "$state" in
    not-configured) hint "portta tunnel setup --zone <domain>" ;;
    configured) hint "portta tunnel enable" ;;
    auth-error)
      err "Cloudflare rejected the tunnel token"
      hint "the tunnel may have been deleted, or the token belongs to another account: portta tunnel setup --zone $zone" ;;
    config-error) err "the connector refused its configuration"; hint "portta tunnel logs" ;;
    disconnected)
      err "the connector holds no connection to the Cloudflare edge"
      hint "portta tunnel logs   (the connector dials out on 7844/udp and 443/tcp)" ;;
    starting) say "the connector is still establishing its connections" ;;
    connected) ok "carrying traffic for *.$zone" ;;
  esac
}

# portta_tunnel_test: does a hostname under the zone actually come back?
#
# Asks the internet, not the container: the question is whether somebody else
# can reach a service, and only a request from outside answers that.
portta_tunnel_test() {
  local zone="${CLOUDFLARE_TUNNEL_ZONE:-}" host code
  [ -n "$zone" ] || { err "no domain is configured"; hint "portta tunnel setup --zone <domain>"; return 1; }
  portta_have curl || { err "curl is needed to test the tunnel"; return 1; }

  # A name nothing routes to. Traefik answering 404 through the tunnel proves
  # the whole path — edge, connector, proxy — without needing a live service.
  host="portta-tunnel-check.$zone"
  say "asking Cloudflare for https://$host"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$host/" 2>/dev/null || printf '000')

  case "$code" in
    404)
      ok "the tunnel is carrying traffic ($code from the gateway)"
      printf '  Traefik answered, which means the whole path works:\n'
      printf '  Cloudflare -> tunnel -> connector -> Traefik.\n'
      printf '  404 is correct here: nothing is routed at that name.\n' ;;
    200|3??)
      ok "the tunnel is carrying traffic ($code)" ;;
    530)
      err "Cloudflare has no connector for this tunnel (530)"
      hint "portta tunnel status" ;;
    502|504)
      err "the connector answered but could not reach the gateway ($code)"
      hint "portta status   (is Traefik running?)" ;;
    000)
      err "no answer at all"
      hint "check that *.$zone resolves: dig +short $host" ;;
    *)
      err "unexpected response: $code" ;;
  esac
}
