#!/usr/bin/env bash
# Dev Gateway — service discovery across consumer projects.
#
# Everything here is derived from Docker labels at call time. There is no
# registry of projects to keep in sync, and nothing to clean up when a project
# disappears.

# Pinned; see docs/adr/0004-pinned-versions.md.
# shellcheck disable=SC2034  # consumed by scripts/cmd/access.sh
DG_BRIDGE_IMAGE="alpine/socat:1.8.1.3"

# Well-known ports, used only when a container exposes several and we have to
# guess. `--port` always wins.
dg_default_port_for_image() {
  local lower
  lower=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')
  case "$lower" in
    *postgres*|*postgis*|*timescale*) printf '5432' ;;
    *mysql*|*mariadb*|*percona*) printf '3306' ;;
    *redis*|*valkey*|*keydb*) printf '6379' ;;
    *mongo*) printf '27017' ;;
    *memcached*) printf '11211' ;;
    *elasticsearch*|*opensearch*) printf '9200' ;;
    *rabbitmq*) printf '5672' ;;
    *clickhouse*) printf '9000' ;;
    *cassandra*) printf '9042' ;;
    *neo4j*) printf '7687' ;;
    *mailpit*|*mailhog*) printf '1025' ;;
    *) printf '' ;;
  esac
}

# dg_service_kind <image> — how a service should be reached.
dg_service_kind() {
  local lower
  lower=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')
  case "$lower" in
    *postgres*|*postgis*|*timescale*) printf 'postgres' ;;
    *mysql*|*mariadb*|*percona*) printf 'mysql' ;;
    *redis*|*valkey*|*keydb*) printf 'redis' ;;
    *mongo*) printf 'mongodb' ;;
    *memcached*) printf 'memcached' ;;
    *elasticsearch*|*opensearch*) printf 'search' ;;
    *rabbitmq*) printf 'amqp' ;;
    *clickhouse*) printf 'clickhouse' ;;
    *mailpit*|*mailhog*) printf 'smtp' ;;
    *) printf 'tcp' ;;
  esac
}

# dg_find_container <project> <service> — the running container for a Compose
# service, or nothing.
dg_find_container() {
  docker ps -q \
    --filter "label=com.docker.compose.project=$1" \
    --filter "label=com.docker.compose.service=$2" \
    2>/dev/null | head -1
}

# dg_container_private_networks <container> — the project's own networks, with
# the gateway's shared and access networks excluded. Those are ours, not the
# project's, and a bridge attached to them would defeat the isolation.
dg_container_private_networks() {
  docker inspect "$1" --format '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}' 2>/dev/null \
    | tr ' ' '\n' | grep -v '^$' \
    | grep -vx "$DEV_GATEWAY_NETWORK" \
    | grep -vx "$DEV_GATEWAY_CONTROL_NETWORK" \
    | grep -vx "$DEV_GATEWAY_ACCESS_NETWORK"
}

# dg_container_ports <container> — every port the image or the compose file
# declares, one per line, numbers only.
dg_container_ports() {
  docker inspect "$1" --format '{{ range $p, $v := .Config.ExposedPorts }}{{ $p }} {{ end }}' 2>/dev/null \
    | tr ' ' '\n' | sed -n 's#^\([0-9]\{1,5\}\)/tcp$#\1#p' | sort -n -u
}

# dg_bridge_for <project> <service> — an existing bridge's container id.
dg_bridge_for() {
  docker ps -q \
    --filter "label=dev-gateway.component=access-bridge" \
    --filter "label=dev-gateway.access.project=$1" \
    --filter "label=dev-gateway.access.service=$2" \
    2>/dev/null | head -1
}

dg_bridge_local_port() {
  docker inspect "$1" --format \
    '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostPort }}{{ end }}{{ end }}' 2>/dev/null
}

# dg_discover_services [project] — every service of every running Compose
# project.
#
# Output, one line per service, separated by the unit separator:
#   project service container image kind ports hostports bridge_port
dg_discover_services() {
  local want="${1:-}" id project service name image kind ports hostports bridge bport
  local FS; FS=$(printf '\037')

  for id in $(docker ps -q 2>/dev/null); do
    project=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null)
    [ -n "$project" ] || continue
    # Gateway-owned containers are infrastructure, not services to connect to.
    dg_container_is_managed "$id" && continue
    [ -z "$want" ] || [ "$want" = "$project" ] || continue

    service=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.service" }}' 2>/dev/null)
    name=$(docker inspect "$id" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')
    image=$(docker inspect "$id" --format '{{ .Config.Image }}' 2>/dev/null)
    kind=$(dg_service_kind "$image")
    ports=$(dg_container_ports "$id" | tr '\n' ',' | sed 's/,$//')
    hostports=$(docker inspect "$id" \
      --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null \
      | sed 's/ *$//')
    bridge=$(dg_bridge_for "$project" "$service")
    bport=""
    [ -n "$bridge" ] && bport=$(dg_bridge_local_port "$bridge")

    printf '%s%s%s%s%s%s%s%s%s%s%s%s%s%s%s\n' \
      "$project" "$FS" "$service" "$FS" "$name" "$FS" "$image" "$FS" \
      "$kind" "$FS" "$ports" "$FS" "$hostports" "$FS" "$bport"
  done | sort
}

# dg_access_label <container> <suffix> — read a dev-gateway.access.* label.
dg_access_label() {
  docker inspect "$1" --format "{{ index .Config.Labels \"dev-gateway.access.$2\" }}" 2>/dev/null
}
