#!/usr/bin/env bash
# `dev-gateway service publish` — a persistent private address for a TCP service.
#
# `access open` is for a session: temporary, on a port the kernel picks. This is
# for the database you connect to every day and want at a stable address on
# your tailnet.
#
# The architecture matters as much as the feature. Each published service gets
# its OWN forwarder, which joins that project's private network and the
# gateway's access network. Tailscale talks only to the access network. No
# project's private network is ever merged with another's, and the Tailscale
# container is never attached to them.
#
#   project-a_default            project-b_default
#        postgres                     postgres
#           |                             |
#     forwarder-a-db                forwarder-b-db
#           |                             |
#           +------ dev-gateway-access ---+
#                          |
#                      Tailscale

dg_cmd_service() {
  local sub="${1:-list}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    publish) dg_service_publish "$@" ;;
    unpublish) dg_service_unpublish "$@" ;;
    list|ls) dg_service_list "$@" ;;
    -h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway service — persistent private addresses for TCP services

  service publish --private --project <p> --service <s> [--port N] [--alias NAME]
  service unpublish <alias> | --project <p>
  service list

Creates a dedicated forwarder for one service on the gateway's private access
network, so it has a stable address inside the tailnet. Each service gets its
own forwarder: project networks are never merged.

Public publishing of a database is refused. Always. See docs/tailscale-services.md
for the Tailscale Service and ACL configuration to apply on your tailnet.
DG_HELP
      ;;
    *) err "unknown service subcommand: $sub"; return 1 ;;
  esac
}

# Services that must never be reachable from the internet, whatever flags are
# passed. This list is a refusal, not a warning.
DG_SENSITIVE_KINDS="postgres mysql redis mongodb memcached search amqp clickhouse"

dg_service_publish() {
  local project="" service="" port="" alias="" private=0 public=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --private) private=1 ;;
      --public) public=1 ;;
      --project) shift; project="${1:-}" ;;
      --project=*) project="${1#--project=}" ;;
      --service) shift; service="${1:-}" ;;
      --service=*) service="${1#--service=}" ;;
      --port) shift; port="${1:-}" ;;
      --port=*) port="${1#--port=}" ;;
      --alias) shift; alias="${1:-}" ;;
      --alias=*) alias="${1#--alias=}" ;;
      -*) die "unknown flag: $1" ;;
      *) if [ -z "$project" ]; then project="$1"; else service="$1"; fi ;;
    esac
    shift
  done

  [ -n "$project" ] || { err "--project is required"; return 1; }
  [ -n "$service" ] || { err "--service is required"; return 1; }
  dg_require_docker || return 1

  local target image kind
  target=$(dg_find_container "$project" "$service")
  [ -n "$target" ] || { err "no running container for $project/$service"; hint "dev-gateway services --project $project"; return 1; }
  image=$(docker inspect "$target" --format '{{ .Config.Image }}' 2>/dev/null)
  kind=$(dg_service_kind "$image")

  # This is a hard stop, not a confirmation prompt.
  if [ "$public" = "1" ]; then
    case " $DG_SENSITIVE_KINDS " in
      *" $kind "*)
        err "refusing to publish a $kind service publicly"
        hint "databases, caches and queues are reached over the VPN, never from the internet"
        hint "see docs/security.md"
        return 1 ;;
    esac
    err "public TCP publishing is not implemented, and is not planned for datastores"
    hint "use --private"
    return 1
  fi

  if [ "$private" != "1" ]; then
    err "--private is required"
    hint "dev-gateway service publish --private --project $project --service $service"
    return 1
  fi

  [ -n "$port" ] || port=$(dg_default_port_for_image "$image")
  if [ -z "$port" ]; then
    local ports count
    ports=$(dg_container_ports "$target")
    count=$(printf '%s\n' "$ports" | grep -c . || true)
    [ "$count" = "1" ] && port="$ports"
  fi
  [ -n "$port" ] || { err "cannot tell which port to forward"; hint "--port <port>"; return 1; }

  local network
  network=$(dg_container_private_networks "$target" | grep -x "${project}_default" | head -1)
  [ -n "$network" ] || network=$(dg_container_private_networks "$target" | head -1)
  [ -n "$network" ] || { err "$project/$service is not on a private network"; return 1; }

  [ -n "$alias" ] || alias="$(dg_slug "$project")-$(dg_slug "$service")"

  # The access network is the only thing forwarders share, and it exists purely
  # so Tailscale can reach them without touching a project network.
  dg_network_ensure "$DEV_GATEWAY_ACCESS_NETWORK" \
    || { err "could not create $DEV_GATEWAY_ACCESS_NETWORK"; return 1; }

  local name="dg-forward-$alias"
  if [ -n "$(docker ps -aq --filter "name=^${name}$" 2>/dev/null)" ]; then
    warn "a forwarder named $alias already exists"
    hint "dev-gateway service unpublish $alias"
    return 1
  fi

  docker run -d \
    --name "$name" \
    --network "$network" \
    --restart unless-stopped \
    --label "dev-gateway.managed=true" \
    --label "dev-gateway.component=access-forwarder" \
    --label "dev-gateway.forward.alias=$alias" \
    --label "dev-gateway.forward.project=$project" \
    --label "dev-gateway.forward.service=$service" \
    --label "dev-gateway.forward.port=$port" \
    --label "dev-gateway.forward.kind=$kind" \
    --label "traefik.enable=false" \
    "$DG_BRIDGE_IMAGE" \
    "TCP-LISTEN:$port,fork,reuseaddr" "TCP:$service:$port" >/dev/null \
    || { err "could not create the forwarder"; return 1; }

  # A second, alias-bearing attachment: Tailscale resolves the service by this
  # name and never needs a route into the project's own network.
  docker network connect --alias "$alias" "$DEV_GATEWAY_ACCESS_NETWORK" "$name" \
    || { err "could not attach the forwarder to $DEV_GATEWAY_ACCESS_NETWORK"
         dg_container_is_managed "$name" && docker rm -f "$name" >/dev/null 2>&1
         return 1; }

  ok "published $project/$service privately"
  printf '\n'
  printf '  %-16s %s\n' "alias" "$alias"
  printf '  %-16s %s:%s\n' "target" "$service" "$port"
  printf '  %-16s %s\n' "project network" "$network"
  printf '  %-16s %s\n' "access network" "$DEV_GATEWAY_ACCESS_NETWORK"
  printf '  %-16s %s\n' "reachable at" "$alias:$port (from the access network)"
  printf '\n'

  dg_service_tailscale_hint "$alias" "$port" "$kind"
}

dg_service_tailscale_hint() {
  local alias="$1" port="$2" kind="$3"
  printf '%s\n' "$(dg_bold 'To reach it from your tailnet')"
  printf '%s\n\n' "$(dg_dim 'The forwarder exists now. The tailnet side is configured on your tailnet, deliberately: the gateway never edits your Tailscale policy.')"

  printf '  1. Attach the Tailscale container to the access network:\n\n'
  printf '       docker network connect %s %s\n\n' "$DEV_GATEWAY_ACCESS_NETWORK" "dev-gateway-tailscale-1"

  printf '  2. Advertise it as a Tailscale Service, so it gets its own address\n'
  printf '     and can keep the standard port:\n\n'
  printf '       svc:%s  ->  tcp:%s  ->  %s:%s\n\n' "$alias" "$port" "$alias" "$port"

  printf '  3. Grant access in your tailnet policy — never a blanket rule:\n\n'
  cat <<POLICY
       {
         "grants": [
           {
             "src": ["group:developers"],
             "dst": ["svc:$alias"],
             "ip":  ["tcp:$port"]
           }
         ]
       }

POLICY
  printf '  %s\n' "$(dg_dim "Full walkthrough, including the ACL model: docs/tailscale-services.md")"
  printf '  %s\n' "$(dg_dim "Not set up for that yet? dev-gateway remote access open works today over SSH.")"
}

dg_service_list() {
  dg_require_docker || return 1
  local ids
  ids=$(docker ps -q --filter "label=dev-gateway.component=access-forwarder" 2>/dev/null)
  if [ -z "$ids" ]; then
    info "no services are published privately"
    hint "dev-gateway service publish --private --project <p> --service <s>"
    return 0
  fi
  printf '%-28s %-22s %-14s %-8s %s\n' "ALIAS" "PROJECT" "SERVICE" "PORT" "STATE"
  local c
  for c in $ids; do
    printf '%-28s %-22s %-14s %-8s %s\n' \
      "$(docker inspect "$c" --format '{{ index .Config.Labels "dev-gateway.forward.alias" }}')" \
      "$(docker inspect "$c" --format '{{ index .Config.Labels "dev-gateway.forward.project" }}')" \
      "$(docker inspect "$c" --format '{{ index .Config.Labels "dev-gateway.forward.service" }}')" \
      "$(docker inspect "$c" --format '{{ index .Config.Labels "dev-gateway.forward.port" }}')" \
      "$(dg_container_state "$c")"
  done
}

dg_service_unpublish() {
  local alias="" project=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --project) shift; project="${1:-}" ;;
      --project=*) project="${1#--project=}" ;;
      -*) die "unknown flag: $1" ;;
      *) alias="$1" ;;
    esac
    shift
  done
  dg_require_docker || return 1

  local targets
  if [ -n "$project" ]; then
    targets=$(docker ps -aq --filter "label=dev-gateway.component=access-forwarder" \
      --filter "label=dev-gateway.forward.project=$project" 2>/dev/null)
  elif [ -n "$alias" ]; then
    targets=$(docker ps -aq --filter "label=dev-gateway.component=access-forwarder" \
      --filter "label=dev-gateway.forward.alias=$alias" 2>/dev/null)
  else
    err "give an alias or --project <name>"
    return 1
  fi

  [ -n "$targets" ] || { info "nothing to unpublish"; return 0; }

  local c n=0
  for c in $targets; do
    dg_container_is_managed "$c" || { warn "refusing to remove a container the gateway does not own"; continue; }
    docker rm -f "$c" >/dev/null 2>&1 && n=$((n + 1))
  done
  ok "unpublished $n forwarder(s) — the services themselves keep running"
}
