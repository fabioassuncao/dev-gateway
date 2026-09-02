#!/usr/bin/env bash
# Portta: the container lookups the zero-Node path still needs.
#
# What a service *is* — its kind, its well-known port, whether its protocol can
# be told apart by hostname, the name a TCP client connects to — is one table in
# packages/core/src/discovery.ts, and it used to be a second one here. This file
# keeps only what `scripts/doctor.sh` and the zero-Node commands call directly;
# see docs/adr/0029-shell-only-for-bootstrap.md.
#
# Everything here is derived from Docker labels at call time. There is no
# registry of projects to keep in sync, and nothing to clean up when a project
# disappears.

# Used by the zero-Node remote-access SSH driver, which needs a short id.
portta_access_id() {
  printf '%s' "$$$(date +%s)" | cksum | awk '{printf "%x", $1}' | cut -c1-6
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

# portta_access_label <container> <suffix>: read a portta.access.* label.
portta_access_label() {
  docker inspect "$1" --format "{{ index .Config.Labels \"portta.access.$2\" }}" 2>/dev/null
}
