#!/usr/bin/env bash
# ============================================================================
# Capability detection
# ============================================================================
# What this host can do, gathered once and handed to whoever asks in the same
# shape. `doctor`, `status`, the panel and the CLI must all reach the same
# verdict, and they do that by reading the same facts rather than each running
# their own probes.
#
# This file only ever *observes*. It never runs `tailscale up`, never
# authenticates a tunnel, and never changes a bind address. Turning something on
# is a separate, deliberate act; see docs/adr/0024-capabilities-providers-endpoints.md.
#
# The verdicts themselves — which facts add up to which capability state — live
# in packages/core/src/capabilities.ts, and are re-derived from this JSON.
# ============================================================================

# portta_json_string <value>: a JSON string literal, or `null` for the empty one.
#
# Hand-rolled because jq is not a dependency: the gateway has to work on a host
# with nothing but Docker and a shell. Only the characters JSON actually forbids
# are escaped, and a control character is dropped rather than smuggled through.
portta_json_string() {
  local value="${1-}"
  [ -n "$value" ] || { printf 'null'; return 0; }
  printf '%s' "$value" | LC_ALL=C awk '
    BEGIN { printf "\"" }
    {
      gsub(/\\/, "\\\\")
      gsub(/"/, "\\\"")
      gsub(/[\001-\037\177]/, "")
      printf "%s", $0
    }
    END { printf "\"" }'
}

portta_json_bool() {
  case "${1-}" in
    1|true|yes|on|enabled) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

# ---------------------------------------------------------------------------
# Addresses
# ---------------------------------------------------------------------------

# portta_private_addresses: this host's own non-loopback private addresses.
#
# The tailnet address is deliberately excluded: it is reported under its own
# capability, and listing it as a LAN address as well would offer the same
# network twice under two names.
portta_private_addresses() {
  local addresses="" address
  if portta_have ip; then
    # Interface first, address second: Docker's own bridges have to be told
    # apart from a real network, and only the interface name does that. A host
    # running Docker has one 172.x gateway per network, and offering
    # `web.172-18-0-1.sslip.io` as a LAN address would be pure noise.
    addresses=$(ip -4 -o addr show scope global 2>/dev/null | awk '{ split($4, a, "/"); print $2 "|" a[1] }')
  elif portta_have ifconfig; then
    addresses=$(ifconfig 2>/dev/null | awk '/^[a-z]/ { iface = substr($1, 1, length($1) - 1) } /inet /{ sub(/^addr:/, "", $2); print iface "|" $2 }')
  fi
  for address in $addresses; do
    case "${address%%|*}" in
      docker*|br-*|veth*|virbr*|tailscale*|lo) continue ;;
    esac
    address="${address##*|}"
    portta_ip_is_private "$address" || continue
    case "$address" in
      127.*) continue ;;
      # Tailscale's CGNAT range: reported as `tailscale`, not as a LAN.
      100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) continue ;;
    esac
    printf '%s\n' "$address"
  done
}

# ---------------------------------------------------------------------------
# Tailscale
# ---------------------------------------------------------------------------
# Read-only, always. Portta reports what the tailnet allows and never changes
# it: `tailscale up`, the HTTPS-certificates switch and the policy file are the
# operator's, and a gateway that edited them would be doing something nobody
# asked for. See docs/tailscale.md.

# portta_tailscale_facts: installed / connected / ipv4 / magicDns / certs / funnel / tagged
#
# Prints seven lines in that order, empty where unknown.
portta_tailscale_facts() {
  local bin state ipv4="" dnsname="" certs=false funnel=false tagged=false json=""

  bin=$(portta_locate tailscale 2>/dev/null || true)
  if [ -z "$bin" ]; then
    printf 'false\nfalse\n\n\nfalse\nfalse\nfalse\n'
    return 0
  fi

  json=$("$bin" status --json 2>/dev/null || true)
  if [ -z "$json" ]; then
    printf 'true\nfalse\n\n\nfalse\nfalse\nfalse\n'
    return 0
  fi

  state=$(printf '%s' "$json" | portta_json_field BackendState)
  if [ "$state" != "Running" ]; then
    printf 'true\nfalse\n\n\nfalse\nfalse\nfalse\n'
    return 0
  fi

  ipv4=$("$bin" ip -4 2>/dev/null | head -n1 || true)
  # The trailing dot Tailscale reports is part of the DNS name, not the URL.
  dnsname=$(printf '%s' "$json" | portta_json_field DNSName | sed 's/\.$//')

  # Whether the tailnet issues certificates cannot be read from status: the
  # capability is granted per tailnet and only shows up when something asks for
  # a certificate. `tailscale cert --help` will not tell us either, so the
  # honest probe is the state file Tailscale writes once HTTPS is on.
  if printf '%s' "$json" | grep -q '"CertDomains": *\[' && ! printf '%s' "$json" | grep -q '"CertDomains": *null'; then
    certs=true
  fi

  # Funnel is granted through the policy file as a node attribute, and shows up
  # in the node's capability map.
  if printf '%s' "$json" | grep -q 'tailscale\.com/cap/funnel'; then funnel=true; fi

  # Tailscale Services require a tagged node; a user-owned node is refused with
  # "service hosts must be tagged nodes". Tags appear on the node itself.
  if printf '%s' "$json" | grep -q '"Tags": *\['; then tagged=true; fi

  printf 'true\ntrue\n%s\n%s\n%s\n%s\n%s\n' "$ipv4" "$dnsname" "$certs" "$funnel" "$tagged"
}

# portta_json_field <key>: the first string value for a top-level-ish key.
#
# Enough for the handful of scalars read here, and deliberately not a JSON
# parser: anything that needs one belongs in the TypeScript side.
portta_json_field() {
  sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | head -n1
}

# ---------------------------------------------------------------------------
# Cloudflare Tunnel
# ---------------------------------------------------------------------------

# portta_cloudflared_available: a connector this host can actually run.
#
# Either a binary on the host or the image already pulled. Portta prefers the
# container (docs/adr/0025-cloudflare-tunnel.md) because everything else it runs
# is a container, but an operator who already runs cloudflared under systemd
# keeps it and Portta stays out of the way.
portta_cloudflared_available() {
  portta_locate cloudflared >/dev/null 2>&1 && return 0
  docker image inspect "${PORTTA_CLOUDFLARED_IMAGE:-cloudflare/cloudflared:2026.8.3}" >/dev/null 2>&1
}

portta_tunnel_config_file() {
  printf '%s' "${PORTTA_STATE_DIR:-$PORTTA_ROOT/state}/cloudflared/config.yml"
}

portta_tunnel_configured() {
  [ -f "$(portta_tunnel_config_file)" ] \
    && [ -f "${PORTTA_STATE_DIR:-$PORTTA_ROOT/state}/cloudflared/credentials.json" ]
}

# portta_tunnel_connected: the connector holds registered connections.
#
# Asked of the container's own metrics endpoint rather than of Cloudflare, so
# the answer is about this host and needs no credentials to obtain.
portta_tunnel_connected() {
  local container="${PORTTA_PROJECT_NAME:-portta}-cloudflared-1"
  docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -q true || return 1
  docker exec "$container" cloudflared tunnel info 2>/dev/null >/dev/null && return 0
  # `tunnel info` needs credentials the container may not carry; the log line
  # the connector prints on every successful registration is the fallback.
  docker logs --tail 200 "$container" 2>&1 | grep -q "Registered tunnel connection"
}

# ---------------------------------------------------------------------------
# The whole picture
# ---------------------------------------------------------------------------

# portta_capability_facts_json: everything above, in the shape
# packages/core/src/capabilities.ts consumes.
#
# Call after portta_load_env and portta_defaults.
portta_capability_facts_json() {
  local ts_installed ts_connected ts_ip ts_dns ts_certs ts_funnel ts_tagged
  local private_list="" address first=1
  local cf_available=false cf_configured=false cf_connected=false cf_access=false

  {
    read -r ts_installed
    read -r ts_connected
    read -r ts_ip
    read -r ts_dns
    read -r ts_certs
    read -r ts_funnel
    read -r ts_tagged
  } <<EOF
$(portta_tailscale_facts)
EOF

  while IFS= read -r address; do
    [ -n "$address" ] || continue
    [ "$first" -eq 1 ] || private_list="$private_list,"
    private_list="$private_list$(portta_json_string "$address")"
    first=0
  done <<EOF
$(portta_private_addresses)
EOF

  portta_cloudflared_available && cf_available=true
  if [ "$cf_available" = true ] && portta_tunnel_configured; then
    cf_configured=true
    portta_tunnel_connected && cf_connected=true
  fi
  # Access is Cloudflare-side state. Portta records that the operator told it a
  # policy exists; it never creates, reads or assumes one.
  [ "${CLOUDFLARE_ACCESS_ENABLED:-false}" = "true" ] && cf_access=true

  # PORTTA_PUBLIC_IP is "the address the automatic domain encodes", which on a
  # host reached only over the tailnet is deliberately a CGNAT address. That is
  # not a public address, and reporting it as one is the exact conflation this
  # model exists to undo: a tailnet address is a *private* capability, and
  # `auto-domain` must not claim the internet can reach it.
  local public_ip=""
  if [ -n "${PORTTA_PUBLIC_IP:-}" ] && ! portta_ip_is_private "$PORTTA_PUBLIC_IP"; then
    public_ip="$PORTTA_PUBLIC_IP"
  fi

  printf '{'
  printf '"publicIpv4":%s,' "$(portta_json_string "$public_ip")"
  printf '"privateIpv4":[%s],' "$private_list"
  printf '"tailscale":{'
  printf '"installed":%s,' "$(portta_json_bool "$ts_installed")"
  printf '"connected":%s,' "$(portta_json_bool "$ts_connected")"
  printf '"ipv4":%s,' "$(portta_json_string "$ts_ip")"
  printf '"magicDns":%s,' "$(portta_json_string "$ts_dns")"
  printf '"httpsCerts":%s,' "$(portta_json_bool "$ts_certs")"
  printf '"funnel":%s,' "$(portta_json_bool "$ts_funnel")"
  printf '"tagged":%s' "$(portta_json_bool "$ts_tagged")"
  printf '},'
  printf '"cloudflare":{'
  printf '"connectorAvailable":%s,' "$(portta_json_bool "$cf_available")"
  printf '"tunnelConfigured":%s,' "$(portta_json_bool "$cf_configured")"
  printf '"tunnelConnected":%s,' "$(portta_json_bool "$cf_connected")"
  printf '"accessConfigured":%s,' "$(portta_json_bool "$cf_access")"
  printf '"zone":%s' "$(portta_json_string "${CLOUDFLARE_TUNNEL_ZONE:-}")"
  printf '},'
  printf '"customDomain":%s,' "$(portta_json_string "$([ "${PORTTA_DOMAIN_MODE:-local}" = custom ] && printf '%s' "${PORTTA_DOMAIN:-}")")"
  printf '"resolvedDomain":%s,' "$(portta_json_string "${PORTTA_DOMAIN:-localhost}")"
  printf '"tlsEnabled":%s,' "$(portta_json_bool "${TLS_ENABLED:-false}")"
  printf '"bindAddress":%s' "$(portta_json_string "${PORTTA_BIND_ADDRESS:-127.0.0.1}")"
  printf '}\n'
}
