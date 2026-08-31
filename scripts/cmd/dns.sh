#!/usr/bin/env bash
# `dev-gateway dns` — verify and, optionally, create the wildcard DNS record.
#
# Cloudflare is the reference provider, not a requirement: `dns check` works
# with any provider, and `dns setup` simply prints the record to create when
# Cloudflare is not configured.

DG_CF_API="https://api.cloudflare.com/client/v4"

dg_cmd_dns() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    check) dg_dns_check "$@" ;;
    status) dg_dns_status "$@" ;;
    setup) dg_dns_setup "$@" ;;
    -h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway dns — wildcard DNS for the gateway domain

  dns check     Resolve the gateway's wildcard and compare it to this host
  dns status    Show the DNS configuration, and Cloudflare records if configured
  dns setup     Create or update the wildcard record (Cloudflare), or print
                the record to create by hand

Cloudflare is optional. Use a scoped API token with Zone:DNS:Edit on one zone;
never the Global API Key. Tokens are never printed or logged.
DG_HELP
      ;;
    *) err "unknown dns subcommand: $sub"; return 1 ;;
  esac
}

# dg_dns_expected_target — the address the wildcard should point at.
dg_dns_expected_target() {
  case "$DEV_GATEWAY_PROFILE" in
    remote-public)
      dg_curl -s --max-time 8 https://api.ipify.org 2>/dev/null
      ;;
    remote-private)
      local ts_id
      ts_id=$(dg_gateway_container tailscale)
      if [ -n "$ts_id" ] && [ "$(dg_container_state "$ts_id")" = "running" ]; then
        docker exec "$ts_id" tailscale ip -4 2>/dev/null | head -1
      elif dg_have tailscale; then
        tailscale ip -4 2>/dev/null | head -1
      fi
      ;;
    local) printf '127.0.0.1' ;;
  esac
}

dg_dns_check() {
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" || return 1

  local domain="$DEV_GATEWAY_DOMAIN"
  case "$domain" in
    localhost|*.localhost)
      ok "domain '$domain' is RFC 6761 loopback — no DNS records are needed"
      return 0
      ;;
  esac

  printf '%s\n' "$(dg_bold "DNS for *.$domain")"

  local expected probe resolved rc=0
  expected=$(dg_dns_expected_target)
  printf '  %-24s %s\n' "expected target" "${expected:-<unknown>}"

  # Query a name that can only match the wildcard, so a stray A record for the
  # apex cannot make a broken wildcard look healthy.
  probe="dev-gateway-probe.$domain"
  resolved=$(dg_dig +short "$probe" A 2>/dev/null | grep -E '^[0-9]+\.' | head -1)
  printf '  %-24s %s\n' "$probe" "${resolved:-<no A record>}"

  if [ -z "$resolved" ]; then
    err "the wildcard *.$domain does not resolve"
    hint "dev-gateway dns setup    — create the record"
    rc=1
  elif [ -n "$expected" ] && [ "$resolved" != "$expected" ]; then
    warn "the wildcard resolves to $resolved but this host expects $expected"
    hint "that is fine behind a proxy or CDN; otherwise update the record"
  else
    ok "the wildcard resolves to this host"
  fi

  # DNS-01 needs no public reachability, so this is the only check that matters
  # for certificate issuance; reachability is a separate concern.
  if dg_is_true "$TLS_ENABLED" && [ "$TLS_MODE" = "acme" ]; then
    printf '\n  %s\n' "$(dg_dim "wildcard certificates use DNS-01 via $ACME_DNS_PROVIDER; they do not require the record above to be publicly reachable")"
  fi
  return $rc
}

dg_dns_status() {
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" >/dev/null 2>&1 || true

  printf '%s\n' "$(dg_bold 'DNS configuration')"
  printf '  %-24s %s\n' "gateway domain" "$DEV_GATEWAY_DOMAIN"
  printf '  %-24s %s\n' "private domain" "${PRIVATE_DOMAIN:-<unset>}"
  printf '  %-24s %s\n' "public domain" "${PUBLIC_DOMAIN:-<unset>}"
  printf '  %-24s %s\n' "acme dns provider" "${ACME_DNS_PROVIDER:-<unset>}"
  printf '  %-24s %s\n' "cloudflare" "$(dg_is_true "$CLOUDFLARE_ENABLED" && printf 'enabled' || printf 'disabled')"
  printf '  %-24s %s\n' "cloudflare token" "$([ -n "${CF_DNS_API_TOKEN:-}" ] && printf '<set>' || printf '<unset>')"

  if dg_is_true "$CLOUDFLARE_ENABLED" && [ -n "${CF_DNS_API_TOKEN:-}" ]; then
    printf '\n%s\n' "$(dg_bold 'Cloudflare')"
    local zone_id
    zone_id=$(dg_cf_zone_id) || { err "could not resolve the Cloudflare zone"; return 1; }
    printf '  %-24s %s\n' "zone" "${CLOUDFLARE_ZONE:-<unset>} ($zone_id)"
    dg_cf_list_records "$zone_id"
  fi

  printf '\n'
  dg_dns_check
}

# --- Cloudflare ------------------------------------------------------------
# All calls use a scoped API token in an Authorization header. The token is
# never echoed, never passed on a command line that would show in `ps`, and
# never written to a log.

dg_cf_require() {
  if [ -z "${CF_DNS_API_TOKEN:-}" ]; then
    err "CF_DNS_API_TOKEN is not set"
    hint "create a scoped token with Zone:DNS:Edit on ${CLOUDFLARE_ZONE:-your zone}"
    hint "see docs/cloudflare.md — never use the Global API Key"
    return 1
  fi
  if [ -z "${CLOUDFLARE_ZONE:-}" ]; then
    err "CLOUDFLARE_ZONE is not set"
    hint "set it to the zone that contains your gateway domain, e.g. example.com"
    return 1
  fi
  return 0
}

# dg_cf_api <method> <path> [body] — returns the raw JSON response.
dg_cf_api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    dg_curl -s -X "$method" "$DG_CF_API$path" \
      -H "Authorization: Bearer $CF_DNS_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "$body"
  else
    dg_curl -s -X "$method" "$DG_CF_API$path" \
      -H "Authorization: Bearer $CF_DNS_API_TOKEN"
  fi
}

dg_cf_zone_id() {
  dg_cf_require || return 1
  local resp id
  resp=$(dg_cf_api GET "/zones?name=$CLOUDFLARE_ZONE")
  id=$(printf '%s' "$resp" | dg_jq -r '.result[0].id // empty' 2>/dev/null)
  if [ -z "$id" ]; then
    err "Cloudflare did not return a zone named '$CLOUDFLARE_ZONE'"
    hint "$(printf '%s' "$resp" | dg_jq -r '.errors[0].message // "check the token scope and the zone name"' 2>/dev/null)"
    return 1
  fi
  printf '%s' "$id"
}

dg_cf_list_records() {
  local zone_id="$1"
  dg_cf_api GET "/zones/$zone_id/dns_records?per_page=100" \
    | dg_jq -r '.result[] | "  \(.type)\t\(.name)\t\(.content)\t\(if .proxied then "proxied" else "dns-only" end)"' 2>/dev/null \
    | sort || printf '  (could not list records)\n'
}

dg_dns_setup() {
  local apply=0 target=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --apply) apply=1 ;;
      --target) shift; target="${1:-}" ;;
      --target=*) target="${1#--target=}" ;;
      *) die "unknown argument: $1" ;;
    esac
    shift
  done

  dg_resolve_profile "$DEV_GATEWAY_PROFILE" || return 1
  local domain="$DEV_GATEWAY_DOMAIN"

  case "$domain" in
    localhost|*.localhost)
      ok "domain '$domain' needs no DNS records"
      return 0
      ;;
  esac

  [ -n "$target" ] || target=$(dg_dns_expected_target)
  if [ -z "$target" ]; then
    err "could not determine the address the record should point at"
    hint "pass it explicitly: dev-gateway dns setup --target <ip>"
    return 1
  fi

  printf '%s\n' "$(dg_bold 'Record required')"
  printf '  %-8s %-28s %s\n' "TYPE" "NAME" "CONTENT"
  printf '  %-8s %-28s %s\n' "A" "*.$domain" "$target"
  printf '\n'

  if [ "$DEV_GATEWAY_PROFILE" = "remote-private" ]; then
    printf '  %s\n\n' "$(dg_dim 'This points a public DNS name at a private VPN address. That is intentional: the name is public, the address is only routable inside your tailnet. Keep the record DNS-only, never proxied.')"
  fi

  if ! dg_is_true "$CLOUDFLARE_ENABLED"; then
    info "Cloudflare integration is disabled — create the record above with your DNS provider"
    hint "set CLOUDFLARE_ENABLED=true and CF_DNS_API_TOKEN to automate this"
    return 0
  fi

  dg_cf_require || return 1
  local zone_id
  zone_id=$(dg_cf_zone_id) || return 1

  local name="*.$domain" existing_id existing_content
  local resp
  resp=$(dg_cf_api GET "/zones/$zone_id/dns_records?type=A&name=$name")
  existing_id=$(printf '%s' "$resp" | dg_jq -r '.result[0].id // empty' 2>/dev/null)
  existing_content=$(printf '%s' "$resp" | dg_jq -r '.result[0].content // empty' 2>/dev/null)

  if [ -n "$existing_id" ] && [ "$existing_content" = "$target" ]; then
    ok "the record already exists and is correct"
    return 0
  fi

  if [ "$apply" != "1" ]; then
    if [ -n "$existing_id" ]; then
      info "would UPDATE $name from $existing_content to $target"
    else
      info "would CREATE $name -> $target"
    fi
    hint "re-run with --apply to make the change"
    return 0
  fi

  # `proxied: false` matters: Cloudflare's proxy terminates TLS and would break
  # a private-address record entirely.
  local body
  body=$(printf '{"type":"A","name":"%s","content":"%s","ttl":60,"proxied":false}' "$name" "$target")

  if [ -n "$existing_id" ]; then
    dg_confirm "Update $name from $existing_content to $target?" || { info "aborted"; return 1; }
    resp=$(dg_cf_api PUT "/zones/$zone_id/dns_records/$existing_id" "$body")
  else
    dg_confirm "Create $name -> $target?" || { info "aborted"; return 1; }
    resp=$(dg_cf_api POST "/zones/$zone_id/dns_records" "$body")
  fi

  if [ "$(printf '%s' "$resp" | dg_jq -r '.success' 2>/dev/null)" = "true" ]; then
    ok "record applied"
    hint "dev-gateway dns check    — confirm propagation"
  else
    err "Cloudflare rejected the change"
    hint "$(printf '%s' "$resp" | dg_jq -r '.errors[0].message // "unknown error"' 2>/dev/null)"
    return 1
  fi
}
