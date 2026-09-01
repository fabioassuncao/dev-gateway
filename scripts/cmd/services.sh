#!/usr/bin/env bash
# `dev-gateway services`: what is running on this host, and how to reach it.

dg_cmd_services() {
  local as_json=0 project=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --json) as_json=1 ;;
      --project) shift; project="${1:-}" ;;
      --project=*) project="${1#--project=}" ;;
      -h|--help)
        cat >&2 <<'DG_HELP'
dev-gateway services: every service of every running Compose project

  --project <name>   Only this project
  --json             Machine-readable output

Shows what each service is, the ports it listens on inside its container,
whether it publishes anything on the host, whether it is routed over HTTP, and
whether an access bridge is already open for it.
DG_HELP
        return 0 ;;
      *) die "unknown argument: $1" ;;
    esac
    shift
  done

  dg_require_docker || return 1
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" >/dev/null 2>&1 || true

  local FS; FS=$(printf '\037')
  local rows routed
  rows=$(dg_discover_services "$project")
  routed=$(dg_discover_http "$project" | awk -F'\t' '{print $1"/"$2}')

  if [ "$as_json" = "1" ]; then
    printf '{\n  "services": [\n'
    local first=1 p s c img kind ports hostports bport gateway_addr
    while IFS="$FS" read -r p s c img kind ports hostports bport; do
      [ -n "${p:-}" ] || continue
      [ "$first" = "1" ] || printf ',\n'
      first=0
      gateway_addr=$(dg_service_gateway_address "$c" "$p" "$s" "$kind")
      printf '    {"project": "%s", "service": "%s", "image": "%s", "kind": "%s", "container_ports": "%s", "host_ports": "%s", "http_routed": %s, "bridge_port": "%s", "routing": "%s", "gateway_address": "%s"}' \
        "$(dg_json_escape "$p")" "$(dg_json_escape "$s")" "$(dg_json_escape "$img")" \
        "$kind" "$ports" "$(dg_json_escape "$hostports")" \
        "$(printf '%s' "$routed" | grep -qx "$p/$s" && echo true || echo false)" \
        "$bport" "$(dg_routing_for_kind "$kind")" "$(dg_json_escape "$gateway_addr")"
    done <<EOF
$rows
EOF
    printf '\n  ]\n}\n'
    return 0
  fi

  if [ -z "$rows" ]; then
    info "no Compose projects are running"
    return 0
  fi

  printf '%-22s %-14s %-11s %-10s %-9s %s\n' \
    "PROJECT" "SERVICE" "KIND" "PORTS" "HTTP" "ACCESS"
  local p s c img kind ports hostports bport http access gateway_addr
  while IFS="$FS" read -r p s c img kind ports hostports bport; do
    [ -n "${p:-}" ] || continue
    if printf '%s' "$routed" | grep -qx "$p/$s"; then http="routed"; else http="-"; fi

    gateway_addr=$(dg_service_gateway_address "$c" "$p" "$s" "$kind")
    if [ -n "$gateway_addr" ]; then
      access="$gateway_addr"
    elif [ -n "$bport" ]; then
      access="127.0.0.1:$bport"
    elif [ -n "$hostports" ]; then
      case "$hostports" in
        *"0.0.0.0:"*) access="$(dg_c 33 "published $hostports")" ;;
        *) access="published $hostports" ;;
      esac
    elif [ "$kind" != "tcp" ]; then
      access="$(dg_dim 'access open')"
    else
      access="-"
    fi

    printf '%-22s %-14s %-11s %-10s %-9s %s\n' \
      "$p" "$s" "$kind" "${ports:--}" "$http" "$access"
  done <<EOF
$rows
EOF

  printf '\n%s\n' "$(dg_dim 'HTTP services are reached by hostname; see dev-gateway urls')"
  if dg_is_true "${DEV_GATEWAY_TCP:-false}"; then
    printf '%s\n' "$(dg_dim 'A database showing a hostname is reached with TLS: sslmode=require. See docs/tcp-routing.md')"
  fi
  printf '%s\n' "$(dg_dim 'Everything else is reached on demand: dev-gateway access open --project <p> --service <s>')"
}

# dg_service_gateway_address <container> <project> <service> <kind>: the
# hostname and port a client uses when this service is routed by hostname, or
# nothing when it is not.
#
# Three things have to be true: the gateway has to be publishing the
# entrypoint, the protocol has to be one that can be told apart by SNI, and the
# container has to carry the router labels that opt it in.
dg_service_gateway_address() {
  dg_is_true "${DEV_GATEWAY_TCP:-false}" || return 0
  local port
  port=$(dg_tcp_host_port_for_kind "$4")
  [ -n "$port" ] || return 0
  dg_container_tcp_routed "$1" || return 0
  printf '%s:%s' "$(dg_tcp_hostname "$2" "$3")" "$port"
}
