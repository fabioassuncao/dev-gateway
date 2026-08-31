#!/usr/bin/env bash
# `dev-gateway public` — opt in to, and out of, internet exposure.
#
# Turning this on is the single most consequential thing the gateway can do, so
# it is explicit, it shows exactly what changes, and it asks first.

dg_cmd_public() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    status) dg_public_status "$@" ;;
    enable) dg_public_enable "$@" ;;
    disable) dg_public_disable "$@" ;;
    -h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway public — control internet exposure (disabled by default)

  public status     Show what is exposed, and what would be
  public enable     Expose HTTP services on the public wildcard domain
  public disable    Stop exposing them

Only services that already opted into the gateway are ever routed. Databases,
caches and the Docker API are never published publicly, in any profile.
DG_HELP
      ;;
    *) err "unknown public subcommand: $sub"; return 1 ;;
  esac
}

# dg_public_preview — everything the user should see before saying yes.
dg_public_preview() {
  local routes
  routes=$(dg_discover_http)

  printf '\n%s\n' "$(dg_bold 'What becomes reachable from the internet')"
  printf '  %-22s %s\n' "domain" "*.${PUBLIC_DOMAIN:-<unset>}"
  printf '  %-22s %s\n' "interface" "0.0.0.0 (every interface on this host)"
  printf '  %-22s %s\n' "ports" "${DEV_GATEWAY_HTTP_PORT}/tcp, ${DEV_GATEWAY_HTTPS_PORT}/tcp"
  printf '  %-22s %s\n' "tls" "$(dg_is_true "$TLS_ENABLED" && printf '%s via %s' "$TLS_MODE" "$ACME_DNS_PROVIDER" || printf 'DISABLED — traffic would be plaintext')"
  printf '  %-22s %s\n' "dashboard" "$(dg_is_true "$DEV_GATEWAY_DASHBOARD" && printf 'enabled (loopback only, never routed publicly)' || printf 'disabled')"

  printf '\n%s\n' "$(dg_bold 'Services that would be served publicly')"
  if [ -z "$routes" ]; then
    printf '  %s\n' "(none opted in yet)"
  else
    printf '%s\n' "$routes" | sort | while IFS="$(printf '\t')" read -r p s _c _h _port _state; do
      [ -n "${p:-}" ] || continue
      printf '  https://%s-%s.%s\n' "$(dg_slug "$p")" "$(dg_slug "$s")" "$PUBLIC_DOMAIN"
    done
  fi

  printf '\n%s\n' "$(dg_bold 'Never published, in any profile')"
  printf '  %s\n' "PostgreSQL, MySQL, Redis, MongoDB and other datastores"
  printf '  %s\n' "the Docker API and the socket proxy"
  printf '  %s\n' "the Traefik dashboard"
}

dg_public_status() {
  dg_require_docker || return 1
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" >/dev/null 2>&1 || true

  printf '%s\n' "$(dg_bold 'Public access')"
  printf '  %-22s %s\n' "state" "$(dg_is_true "$PUBLIC_ENABLED" && dg_c 33 'ENABLED' || printf 'disabled')"
  printf '  %-22s %s\n' "public domain" "${PUBLIC_DOMAIN:-<unset>}"
  printf '  %-22s %s\n' "active profile" "$DEV_GATEWAY_PROFILE"

  local traefik_id binds=""
  traefik_id=$(dg_gateway_container traefik)
  [ -n "$traefik_id" ] && binds=$(docker inspect "$traefik_id" \
    --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)
  local ts_id
  ts_id=$(dg_gateway_container tailscale)
  [ -n "$ts_id" ] && binds="$binds$(docker inspect "$ts_id" \
    --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)"

  printf '  %-22s %s\n' "actual binds" "${binds:-none}"
  case "$binds" in
    *"0.0.0.0:"*)
      printf '  %-22s %s\n' "reachability" "$(dg_c 33 'the gateway is reachable from any network that can route here')" ;;
    *)
      printf '  %-22s %s\n' "reachability" "not bound to a public interface" ;;
  esac

  if dg_is_true "$PUBLIC_ENABLED"; then
    dg_public_preview
  fi
}

dg_public_enable() {
  dg_require_docker || return 1

  if [ -z "${PUBLIC_DOMAIN:-}" ]; then
    err "PUBLIC_DOMAIN is not set"
    hint "set PUBLIC_DOMAIN in .env, e.g. PUBLIC_DOMAIN=dev.example.com"
    return 1
  fi

  # Serving development environments over plaintext to the open internet is
  # not something to do by accident.
  if ! dg_is_true "$TLS_ENABLED"; then
    warn "TLS_ENABLED is false — everything would be served over plain HTTP"
    hint "set TLS_ENABLED=true and TLS_MODE=acme before exposing anything"
    dg_confirm "Expose over plain HTTP anyway?" || { info "aborted"; return 1; }
  elif [ "$TLS_MODE" = "acme" ] && [ -z "${ACME_EMAIL:-}" ]; then
    err "TLS_MODE=acme requires ACME_EMAIL"
    return 1
  fi

  # So the preview shows the hostnames as they will actually be served.
  DEV_GATEWAY_DOMAIN="$PUBLIC_DOMAIN"; export DEV_GATEWAY_DOMAIN
  dg_public_preview

  printf '\n'
  dg_confirm "Enable public access on *.${PUBLIC_DOMAIN}?" || { info "aborted; nothing changed"; return 1; }

  dg_env_set PUBLIC_ENABLED true
  dg_env_set DEV_GATEWAY_PROFILE remote-public
  ok "public access enabled in .env"

  dg_resolve_profile remote-public || return 1
  info "applying the remote-public profile"
  dg_compose remote-public up -d --remove-orphans || return 1

  ok "the gateway is now serving *.${PUBLIC_DOMAIN}"
  hint "dev-gateway dns check     — confirm the wildcard record points here"
  hint "dev-gateway public status — confirm what is exposed"
  hint "dev-gateway public disable — turn it off again"
}

dg_public_disable() {
  dg_require_docker || return 1

  local target="local"
  if dg_is_true "${TAILSCALE_ENABLED:-false}" || [ -n "${PRIVATE_DOMAIN:-}" ]; then
    target="remote-private"
  fi

  dg_confirm "Disable public access and switch to the '$target' profile?" \
    || { info "aborted; nothing changed"; return 1; }

  dg_env_set PUBLIC_ENABLED false
  dg_env_set DEV_GATEWAY_PROFILE "$target"

  dg_resolve_profile "$target" || return 1
  # `up` on the new profile republishes the ports on the narrower bind address.
  # `down` first, because a published port cannot be rebound in place.
  dg_compose remote-public down >/dev/null 2>&1 || true
  dg_compose "$target" up -d --remove-orphans || return 1

  ok "public access disabled; the gateway is on the '$target' profile"
  hint "consumer projects were not touched"
}
