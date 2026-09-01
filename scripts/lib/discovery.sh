#!/usr/bin/env bash
# Portta: service discovery across consumer projects.
#
# Everything here is derived from Docker labels at call time. There is no
# registry of projects to keep in sync, and nothing to clean up when a project
# disappears.

# Pinned; see docs/adr/0004-pinned-versions.md.
# shellcheck disable=SC2034  # consumed by doctor and remote-access fallbacks
PORTTA_BRIDGE_IMAGE="alpine/socat:1.8.1.3"

# Used by the zero-Node remote-access SSH driver. Local access bridges moved
# to packages/cli, but this shell-native driver still needs a short id.
portta_access_id() {
  printf '%s' "$$$(date +%s)" | cksum | awk '{printf "%x", $1}' | cut -c1-6
}

# Well-known ports, used only when a container exposes several and we have to
# guess. `--port` always wins.
portta_default_port_for_image() {
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

# portta_service_kind <image>: how a service should be reached.
portta_service_kind() {
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

# ---------------------------------------------------------------------------
# Protocol registry
# ---------------------------------------------------------------------------
# What a protocol needs in order to be told apart by hostname on a shared port.
# Every entry was verified with two instances and a real client; see
# docs/tcp-routing.md. Nothing is listed as routable on the assumption that it
# behaves like its neighbour.
#
#   starttls-sni  client opens in plaintext, asks to upgrade, then sends SNI
#                 (Traefik has explicit support for the Postgres handshake)
#   tls-sni       client sends a TLS ClientHello first, so SNI is there at once
#   unsupported   the server speaks first, so there is no SNI to route on
#   unevaluated   not tested; treated as unsupported until it is
#
# portta_routing_for_kind <kind>
portta_routing_for_kind() {
  case "${1:-}" in
    postgres) printf 'starttls-sni' ;;
    redis) printf 'tls-sni' ;;
    mysql) printf 'unsupported' ;;
    *) printf 'unevaluated' ;;
  esac
}

# portta_tcp_entrypoint_for_kind <kind>: the Traefik entrypoint that serves it, or
# nothing when the protocol cannot be routed by hostname.
portta_tcp_entrypoint_for_kind() {
  case "${1:-}" in
    postgres) printf 'postgres' ;;
    redis) printf 'redis' ;;
    *) printf '' ;;
  esac
}

# portta_tcp_host_port_for_kind <kind>: the host port that entrypoint is published on.
portta_tcp_host_port_for_kind() {
  case "${1:-}" in
    postgres) printf '%s' "${PORTTA_TCP_POSTGRES_PORT:-5432}" ;;
    redis) printf '%s' "${PORTTA_TCP_REDIS_PORT:-6379}" ;;
    *) printf '' ;;
  esac
}

# portta_tcp_hostname <project> <service>: the name a client connects to.
#
# Flat on purpose, and the same shape the HTTP routers use: a wildcard
# certificate covers exactly one label, so `postgres.storefront.<domain>` would
# need a certificate per project. See docs/tcp-routing.md.
portta_tcp_hostname() {
  printf '%s-%s.%s' "$(portta_slug "$1")" "$(portta_slug "$2")" "${PORTTA_DOMAIN:-localhost}"
}

# portta_container_tcp_routed <container>: true when the container carries TCP
# router labels, which is the only way it gets routed.
portta_container_tcp_routed() {
  portta_container_labels "$1" | grep -q '^traefik\.tcp\.routers\.'
}

# portta_find_container <project> <service>: the running container for a Compose
# service, or nothing.
portta_find_container() {
  docker ps -q \
    --filter "label=com.docker.compose.project=$1" \
    --filter "label=com.docker.compose.service=$2" \
    2>/dev/null | head -1
}

# portta_container_private_networks <container>: the project's own networks, with
# the gateway's shared and access networks excluded. Those are ours, not the
# project's, and a bridge attached to them would defeat the isolation.
portta_container_private_networks() {
  docker inspect "$1" --format '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}' 2>/dev/null \
    | tr ' ' '\n' | grep -v '^$' \
    | grep -vx "$PORTTA_NETWORK" \
    | grep -vx "$PORTTA_CONTROL_NETWORK" \
    | grep -vx "$PORTTA_ACCESS_NETWORK"
}

# portta_container_ports <container>: every port the image or the compose file
# declares, one per line, numbers only.
portta_container_ports() {
  docker inspect "$1" --format '{{ range $p, $v := .Config.ExposedPorts }}{{ $p }} {{ end }}' 2>/dev/null \
    | tr ' ' '\n' | sed -n 's#^\([0-9]\{1,5\}\)/tcp$#\1#p' | sort -n -u
}

# portta_bridge_for <project> <service>: an existing bridge's container id.
portta_bridge_for() {
  docker ps -q \
    --filter "label=portta.component=access-bridge" \
    --filter "label=portta.access.project=$1" \
    --filter "label=portta.access.service=$2" \
    2>/dev/null | head -1
}

portta_bridge_local_port() {
  docker inspect "$1" --format \
    '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostPort }}{{ end }}{{ end }}' 2>/dev/null
}

# portta_discover_services [project]: every service of every running Compose
# project.
#
# Output, one line per service, separated by the unit separator:
#   project service container image kind ports hostports bridge_port
portta_discover_services() {
  local want="${1:-}" id project service name image kind ports hostports bridge bport
  local FS; FS=$(printf '\037')

  for id in $(docker ps -q 2>/dev/null); do
    project=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null)
    [ -n "$project" ] || continue
    # Gateway-owned containers are infrastructure, not services to connect to.
    portta_container_is_managed "$id" && continue
    [ -z "$want" ] || [ "$want" = "$project" ] || continue

    service=$(docker inspect "$id" --format '{{ index .Config.Labels "com.docker.compose.service" }}' 2>/dev/null)
    name=$(docker inspect "$id" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')
    image=$(docker inspect "$id" --format '{{ .Config.Image }}' 2>/dev/null)
    kind=$(portta_service_kind "$image")
    ports=$(portta_container_ports "$id" | tr '\n' ',' | sed 's/,$//')
    hostports=$(docker inspect "$id" \
      --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null \
      | sed 's/ *$//')
    bridge=$(portta_bridge_for "$project" "$service")
    bport=""
    [ -n "$bridge" ] && bport=$(portta_bridge_local_port "$bridge")

    printf '%s%s%s%s%s%s%s%s%s%s%s%s%s%s%s\n' \
      "$project" "$FS" "$service" "$FS" "$name" "$FS" "$image" "$FS" \
      "$kind" "$FS" "$ports" "$FS" "$hostports" "$FS" "$bport"
  done | sort
}

# portta_access_label <container> <suffix>: read a portta.access.* label.
portta_access_label() {
  docker inspect "$1" --format "{{ index .Config.Labels \"portta.access.$2\" }}" 2>/dev/null
}
