#!/usr/bin/env bash
# `dev-gateway network status`: what is listening, on which interface, and
# who can reach it. Read-only: it never changes a firewall rule or a bind.

dg_cmd_network() {
  local sub="${1:-status}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    status) dg_network_status "$@" ;;
    -h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway network status: interfaces, binds, listeners and exposure

  --public-ip   Also look up this host's public address (makes an outbound
                request to an external service)

Read-only. Firewall changes are never made for you; see docs/firewall.md.
DG_HELP
      ;;
    *) err "unknown network subcommand: $sub"; hint "try: dev-gateway network status"; return 1 ;;
  esac
}

dg_network_status() {
  local want_public=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --public-ip) want_public=1 ;;
      *) die "unknown argument: $1" ;;
    esac
    shift
  done

  dg_require_docker || return 1
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" || return 1

  printf '%s\n' "$(dg_bold 'Profile')"
  printf '  %-22s %s\n' "profile" "$DEV_GATEWAY_PROFILE"
  printf '  %-22s %s\n' "domain" "$DEV_GATEWAY_DOMAIN"
  printf '  %-22s %s\n' "attachment" "$(dg_attachment "$DEV_GATEWAY_PROFILE")"
  printf '  %-22s %s\n' "configured bind" "$DEV_GATEWAY_BIND_ADDRESS"
  printf '  %-22s %s\n' "public access" "$(dg_is_true "$PUBLIC_ENABLED" && printf 'ENABLED' || printf 'disabled')"

  printf '\n%s\n' "$(dg_bold 'Host interfaces')"
  if dg_have ip; then
    ip -o addr show scope global 2>/dev/null \
      | awk '{printf "  %-22s %s\n", $2, $4}'
  elif dg_have ifconfig; then
    ifconfig 2>/dev/null | awk '
      /^[a-z0-9]+:/ { iface = substr($1, 1, length($1)-1) }
      /inet / && $2 != "127.0.0.1" { printf "  %-22s %s\n", iface, $2 }'
  else
    printf '  %s\n' "(no ip/ifconfig available on this host)"
  fi

  printf '\n%s\n' "$(dg_bold 'Tailscale')"
  local ts_id
  ts_id=$(dg_gateway_container tailscale)
  if [ -n "$ts_id" ] && [ "$(dg_container_state "$ts_id")" = "running" ]; then
    local ts_ip ts_status
    ts_ip=$(docker exec "$ts_id" tailscale ip -4 2>/dev/null | head -1)
    ts_status=$(docker exec "$ts_id" tailscale status --peers=false 2>&1 | head -1)
    printf '  %-22s %s\n' "container" "running"
    printf '  %-22s %s\n' "tailnet address" "${ts_ip:-<not assigned>}"
    printf '  %-22s %s\n' "status" "${ts_status:-unknown}"
  elif dg_have tailscale; then
    printf '  %-22s %s\n' "host-native" "$(tailscale ip -4 2>/dev/null | head -1 || printf 'installed, not connected')"
  else
    printf '  %-22s %s\n' "tailscale" "not in use"
  fi

  if [ "$want_public" = "1" ]; then
    printf '\n%s\n' "$(dg_bold 'Public address')"
    local pub
    pub=$(dg_curl -s --max-time 8 https://api.ipify.org 2>/dev/null || true)
    printf '  %-22s %s\n' "as seen by ipify.org" "${pub:-<lookup failed>}"
  fi

  printf '\n%s\n' "$(dg_bold 'Published by gateway-owned containers')"
  local any=0 cid cname pub
  for cid in $(docker ps -q --filter "label=dev-gateway.managed=true" 2>/dev/null); do
    cname=$(docker inspect "$cid" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')
    pub=$(docker inspect "$cid" \
      --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }}->{{ $p }} {{ end }}{{ end }}' 2>/dev/null)
    [ -n "$pub" ] || continue
    any=1
    printf '  %-30s %s\n' "$cname" "$pub"
  done
  [ "$any" = "1" ] || printf '  %s\n' "(nothing published)"

  printf '\n%s\n' "$(dg_bold 'Published by consumer projects')"
  any=0
  for cid in $(docker ps -q 2>/dev/null); do
    dg_container_is_managed "$cid" && continue
    pub=$(docker inspect "$cid" \
      --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }}->{{ $p }} {{ end }}{{ end }}' 2>/dev/null)
    [ -n "$pub" ] || continue
    any=1
    cname=$(docker inspect "$cid" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')
    case "$pub" in
      *"0.0.0.0:"*) printf '  %-30s %s  %s\n' "$cname" "$pub" "$(dg_c 33 '<- reachable from the network')" ;;
      *) printf '  %-30s %s\n' "$cname" "$pub" ;;
    esac
  done
  [ "$any" = "1" ] || printf '  %s\n' "(nothing published, which is the goal)"

  printf '\n%s\n' "$(dg_bold 'Host listeners on the gateway ports')"
  local p
  for p in "$DEV_GATEWAY_HTTP_PORT" "$DEV_GATEWAY_HTTPS_PORT"; do
    if dg_have lsof; then
      printf '  :%-6s %s\n' "$p" "$(lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{printf "%s(%s) ", $1, $9}' || printf 'free')"
    elif dg_have ss; then
      printf '  :%-6s %s\n' "$p" "$(ss -ltnH "sport = :$p" 2>/dev/null | awk '{printf "%s ", $4}' || printf 'free')"
    else
      printf '  :%-6s %s\n' "$p" "(no lsof/ss available)"
    fi
  done

  printf '\n%s\n' "$(dg_dim 'Firewall rules are never changed for you. See docs/firewall.md.')"
}
