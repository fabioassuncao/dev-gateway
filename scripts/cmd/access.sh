#!/usr/bin/env bash
# `dev-gateway access` — reach a project's private TCP services from the host.
#
# Traefik routes HTTP by Host header. The PostgreSQL, MySQL and Redis wire
# protocols carry no hostname on the connection, so they cannot be multiplexed
# onto one port that way (see docs/tcp-access.md). Instead, each session gets
# its own short-lived forwarder bound to a free loopback port.
#
# The bridge joins the project's private network, forwards to `service:port`,
# and touches nothing that belongs to the project: no volumes, no container
# changes, no Compose edits. Removing it leaves no trace.

dg_cmd_access() {
  local sub="${1:-list}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    open) dg_access_open "$@" ;;
    list|ls) dg_access_list "$@" ;;
    close) dg_access_close "$@" ;;
    inspect) dg_access_inspect "$@" ;;
    gc) dg_access_gc "$@" ;;
    -h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway access — reach a project's private TCP services

  access open --project <p> --service <s> [--port N] [--local-port N] [--ttl 2h]
  access list [--json]
  access close <id> | --project <p> | --all
  access inspect <id>
  access gc

The bridge binds 127.0.0.1 on a port the kernel picks, so any number of
databases can be reachable at once without one of them having to give up 5432.
Binding anywhere else requires --bind and prints a warning.

Nothing about the project is modified, and `close` only ever removes containers
the gateway created.
DG_HELP
      ;;
    *) err "unknown access subcommand: $sub"; return 1 ;;
  esac
}

dg_access_open() {
  local project="" service="" port="" local_port="" ttl="" bind="127.0.0.1" network="" quiet=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --project) shift; project="${1:-}" ;;
      --project=*) project="${1#--project=}" ;;
      --service) shift; service="${1:-}" ;;
      --service=*) service="${1#--service=}" ;;
      --port) shift; port="${1:-}" ;;
      --port=*) port="${1#--port=}" ;;
      --local-port) shift; local_port="${1:-}" ;;
      --local-port=*) local_port="${1#--local-port=}" ;;
      --ttl) shift; ttl="${1:-}" ;;
      --ttl=*) ttl="${1#--ttl=}" ;;
      --network) shift; network="${1:-}" ;;
      --network=*) network="${1#--network=}" ;;
      --bind) shift; bind="${1:-}" ;;
      --bind=*) bind="${1#--bind=}" ;;
      --quiet) quiet=1 ;;
      -*) die "unknown flag: $1" ;;
      *) if [ -z "$project" ]; then project="$1"; elif [ -z "$service" ]; then service="$1"; fi ;;
    esac
    shift
  done

  [ -n "$project" ] || { err "--project is required"; hint "dev-gateway services   — list what is running"; return 1; }
  [ -n "$service" ] || { err "--service is required"; hint "dev-gateway services --project $project"; return 1; }

  dg_require_docker || return 1

  local target
  target=$(dg_find_container "$project" "$service")
  if [ -z "$target" ]; then
    err "no running container for $project/$service"
    hint "dev-gateway services --project $project"
    return 1
  fi

  local image
  image=$(docker inspect "$target" --format '{{ .Config.Image }}' 2>/dev/null)

  # --- port ------------------------------------------------------------
  if [ -z "$port" ]; then
    local ports count
    ports=$(dg_container_ports "$target")
    count=$(printf '%s\n' "$ports" | grep -c . || true)
    if [ "$count" = "1" ]; then
      port="$ports"
    else
      port=$(dg_default_port_for_image "$image")
      if [ -z "$port" ]; then
        err "cannot tell which port to forward for $project/$service"
        [ "$count" = "0" ] || hint "the container exposes: $(printf '%s' "$ports" | tr '\n' ' ')"
        hint "name it: --port <port>"
        return 1
      fi
      # A guess from the image is worth stating out loud.
      [ "$quiet" = "1" ] || info "using the default port for ${image%%:*}: $port"
    fi
  fi

  # --- network ---------------------------------------------------------
  if [ -z "$network" ]; then
    local nets count
    nets=$(dg_container_private_networks "$target")
    count=$(printf '%s\n' "$nets" | grep -c . || true)
    if [ "$count" = "1" ]; then
      network="$nets"
    elif [ "$count" = "0" ]; then
      err "$project/$service is not on any private network the gateway can join"
      return 1
    else
      # Prefer the conventional one before asking.
      network=$(printf '%s\n' "$nets" | grep -x "${project}_default" | head -1)
      if [ -z "$network" ]; then
        err "$project/$service is on several networks; choose one with --network"
        hint "$(printf '%s' "$nets" | tr '\n' ' ')"
        return 1
      fi
    fi
  fi

  # --- reuse -----------------------------------------------------------
  local existing
  existing=$(dg_bridge_for "$project" "$service")
  if [ -n "$existing" ]; then
    [ "$quiet" = "1" ] || warn "a bridge for $project/$service is already open"
    dg_access_report "$existing"
    return 0
  fi

  # --- bind ------------------------------------------------------------
  case "$bind" in
    127.0.0.1|localhost|::1) ;;
    *)
      warn "binding a database to $bind exposes it beyond this machine"
      hint "the default, 127.0.0.1, is almost always what you want"
      dg_confirm "Bind $project/$service to $bind anyway?" || { info "aborted"; return 1; }
      ;;
  esac

  # --- create ----------------------------------------------------------
  local id name publish
  id=$(dg_access_id)
  name="dg-access-$(dg_slug "$project")-$(dg_slug "$service")-$id"

  # An empty host port asks the kernel for a free one, which removes the
  # check-then-bind race a port scan would have.
  if [ -n "$local_port" ]; then
    publish="$bind:$local_port:$port"
  else
    publish="$bind::$port"
  fi

  local expires="" cid
  if [ -n "$ttl" ]; then
    local secs
    secs=$(dg_duration_seconds "$ttl") || { err "could not parse --ttl '$ttl'"; hint "use forms like 30m, 2h, 90s"; return 1; }
    expires=$(( $(date +%s) + secs ))
  fi

  set -- \
    --detach \
    --name "$name" \
    --network "$network" \
    --publish "$publish" \
    --restart no \
    --label "dev-gateway.managed=true" \
    --label "dev-gateway.component=access-bridge" \
    --label "dev-gateway.access.id=$id" \
    --label "dev-gateway.access.project=$project" \
    --label "dev-gateway.access.service=$service" \
    --label "dev-gateway.access.port=$port" \
    --label "dev-gateway.access.network=$network" \
    --label "dev-gateway.access.kind=$(dg_service_kind "$image")" \
    --label "dev-gateway.access.created=$(date +%s)" \
    --label "traefik.enable=false"
  [ -z "$expires" ] || set -- "$@" --label "dev-gateway.access.expires=$expires"

  if [ -n "$ttl" ]; then
    # busybox `timeout` is in the image; exec so socat still gets the signal.
    cid=$(docker run "$@" --entrypoint sh "$DG_BRIDGE_IMAGE" -c \
      "exec timeout -s TERM $(dg_duration_seconds "$ttl") socat TCP-LISTEN:$port,fork,reuseaddr TCP:$service:$port" 2>&1)
  else
    cid=$(docker run "$@" "$DG_BRIDGE_IMAGE" \
      "TCP-LISTEN:$port,fork,reuseaddr" "TCP:$service:$port" 2>&1)
  fi

  if [ "${cid#*Error}" != "$cid" ] || [ -z "$cid" ]; then
    err "could not open the bridge"
    printf '%s\n' "$cid" | sed 's/^/  /' >&2
    return 1
  fi

  # A bridge that cannot reach its target should fail loudly, not look open.
  sleep 1
  if [ "$(dg_container_state "$name")" != "running" ]; then
    err "the bridge exited immediately"
    docker logs "$name" 2>&1 | tail -5 | sed 's/^/  /' >&2
    hint "is $service reachable on port $port from the $network network?"
    docker rm -f "$name" >/dev/null 2>&1
    return 1
  fi

  [ "$quiet" = "1" ] || ok "bridge open"
  dg_access_report "$name"
}

dg_access_id() {
  # Short, unique enough for concurrent sessions, no external dependency.
  printf '%s' "$$$(date +%s)" | cksum | awk '{printf "%x", $1}' | cut -c1-6
}

# dg_duration_seconds <30m|2h|90s|3600>
dg_duration_seconds() {
  local v="${1:-}" n u
  n=$(printf '%s' "$v" | sed -n 's/^\([0-9][0-9]*\)[smhd]\{0,1\}$/\1/p')
  [ -n "$n" ] || return 1
  u=$(printf '%s' "$v" | sed -n 's/^[0-9][0-9]*\([smhd]\)$/\1/p')
  case "$u" in
    ''|s) printf '%s' "$n" ;;
    m) printf '%s' "$((n * 60))" ;;
    h) printf '%s' "$((n * 3600))" ;;
    d) printf '%s' "$((n * 86400))" ;;
  esac
}

dg_access_report() {
  local c="$1" project service port kind lport bindip
  project=$(dg_access_label "$c" project)
  service=$(dg_access_label "$c" service)
  port=$(dg_access_label "$c" port)
  kind=$(dg_access_label "$c" kind)
  lport=$(dg_bridge_local_port "$c")
  bindip=$(docker inspect "$c" --format \
    '{{ range $p, $cf := .NetworkSettings.Ports }}{{ range $cf }}{{ .HostIp }}{{ end }}{{ end }}' 2>/dev/null)

  printf '\n'
  printf '  %-12s %s\n' "id" "$(dg_access_label "$c" id)"
  printf '  %-12s %s\n' "project" "$project"
  printf '  %-12s %s\n' "service" "$service"
  printf '  %-12s %s:%s\n' "target" "$service" "$port"
  printf '  %-12s %s\n' "local" "$(dg_bold "$bindip:$lport")"
  local exp
  exp=$(dg_access_label "$c" expires)
  [ -z "$exp" ] || printf '  %-12s %s\n' "expires" "$(dg_access_when "$exp")"

  # A connection string template, with no credential in it. The gateway does
  # not read a project's .env to "helpfully" fill in a password.
  printf '\n'
  case "$kind" in
    postgres) printf '  postgresql://<user>@%s:%s/<database>\n' "$bindip" "$lport" ;;
    mysql)    printf '  mysql://<user>@%s:%s/<database>\n' "$bindip" "$lport" ;;
    redis)    printf '  redis://%s:%s\n' "$bindip" "$lport" ;;
    mongodb)  printf '  mongodb://<user>@%s:%s/<database>\n' "$bindip" "$lport" ;;
    *)        printf '  %s:%s\n' "$bindip" "$lport" ;;
  esac
  printf '  %s\n' "$(dg_dim 'credentials come from the project, not from here')"
  printf '\n'
  printf '  %s\n' "$(dg_dim "close with: dev-gateway access close $(dg_access_label "$c" id)")"
}

dg_access_when() {
  local now remain
  now=$(date +%s)
  remain=$(( ${1:-0} - now ))
  if [ "$remain" -le 0 ]; then printf 'expired'; return 0; fi
  if [ "$remain" -lt 60 ]; then printf 'in %ss' "$remain"; return 0; fi
  if [ "$remain" -lt 3600 ]; then printf 'in %sm' "$((remain / 60))"; return 0; fi
  printf 'in %sh%sm' "$((remain / 3600))" "$(((remain % 3600) / 60))"
}

dg_access_list() {
  local as_json=0
  while [ $# -gt 0 ]; do
    case "$1" in --json) as_json=1 ;; *) die "unknown argument: $1" ;; esac
    shift
  done
  dg_require_docker || return 1

  local ids
  ids=$(docker ps -q --filter "label=dev-gateway.component=access-bridge" 2>/dev/null)

  if [ "$as_json" = "1" ]; then
    printf '{\n  "bridges": [\n'
    local first=1 c
    for c in $ids; do
      [ "$first" = "1" ] || printf ',\n'
      first=0
      printf '    {"id": "%s", "project": "%s", "service": "%s", "target_port": "%s", "local_port": "%s", "kind": "%s", "expires": "%s"}' \
        "$(dg_access_label "$c" id)" "$(dg_access_label "$c" project)" \
        "$(dg_access_label "$c" service)" "$(dg_access_label "$c" port)" \
        "$(dg_bridge_local_port "$c")" "$(dg_access_label "$c" kind)" \
        "$(dg_access_label "$c" expires)"
    done
    printf '\n  ]\n}\n'
    return 0
  fi

  if [ -z "$ids" ]; then
    info "no bridges are open"
    hint "dev-gateway access open --project <project> --service postgres"
    return 0
  fi

  printf '%-8s %-24s %-14s %-10s %-22s %s\n' "ID" "PROJECT" "SERVICE" "TARGET" "LOCAL" "EXPIRES"
  local c exp
  for c in $ids; do
    exp=$(dg_access_label "$c" expires)
    printf '%-8s %-24s %-14s %-10s %-22s %s\n' \
      "$(dg_access_label "$c" id)" \
      "$(dg_access_label "$c" project)" \
      "$(dg_access_label "$c" service)" \
      "$(dg_access_label "$c" port)" \
      "127.0.0.1:$(dg_bridge_local_port "$c")" \
      "$([ -n "$exp" ] && dg_access_when "$exp" || printf '-')"
  done
}

# dg_access_resolve <id> — a bridge container id from a short access id.
dg_access_resolve() {
  docker ps -q \
    --filter "label=dev-gateway.component=access-bridge" \
    --filter "label=dev-gateway.access.id=$1" 2>/dev/null | head -1
}

dg_access_close() {
  local id="" project="" all=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --project) shift; project="${1:-}" ;;
      --project=*) project="${1#--project=}" ;;
      --all) all=1 ;;
      -*) die "unknown flag: $1" ;;
      *) id="$1" ;;
    esac
    shift
  done
  dg_require_docker || return 1

  local targets=""
  if [ "$all" = "1" ]; then
    targets=$(docker ps -q --filter "label=dev-gateway.component=access-bridge" 2>/dev/null)
  elif [ -n "$project" ]; then
    targets=$(docker ps -q \
      --filter "label=dev-gateway.component=access-bridge" \
      --filter "label=dev-gateway.access.project=$project" 2>/dev/null)
  elif [ -n "$id" ]; then
    targets=$(dg_access_resolve "$id")
    [ -n "$targets" ] || { err "no open bridge with id '$id'"; hint "dev-gateway access list"; return 1; }
  else
    err "give a bridge id, --project <name>, or --all"
    return 1
  fi

  if [ -z "$targets" ]; then
    info "nothing to close"
    return 0
  fi

  local c n=0
  for c in $targets; do
    # Ownership is checked again here rather than trusted from the filter: this
    # is the code path that removes containers.
    if ! dg_container_is_managed "$c"; then
      warn "refusing to remove $(docker inspect "$c" --format '{{ .Name }}' | sed 's#^/##'): not owned by the gateway"
      continue
    fi
    if [ "$(dg_access_label "$c" id)" = "" ]; then
      warn "refusing to remove a gateway container that is not an access bridge"
      continue
    fi
    docker rm -f "$c" >/dev/null 2>&1 && n=$((n + 1))
  done
  ok "closed $n bridge(s) — the services themselves were not touched"
}

dg_access_inspect() {
  local id="${1:-}"
  [ -n "$id" ] || { err "a bridge id is required"; hint "dev-gateway access list"; return 1; }
  dg_require_docker || return 1
  local c
  c=$(dg_access_resolve "$id")
  [ -n "$c" ] || { err "no open bridge with id '$id'"; return 1; }

  printf '%s\n' "$(dg_bold "Bridge $id")"
  dg_access_report "$c"
  printf '  %-12s %s\n' "network" "$(dg_access_label "$c" network)"
  printf '  %-12s %s\n' "container" "$(docker inspect "$c" --format '{{ .Name }}' | sed 's#^/##')"
  printf '  %-12s %s\n' "state" "$(dg_container_state "$c")"
  printf '\n%s\n' "$(dg_bold 'Recent log')"
  docker logs "$c" 2>&1 | tail -10 | sed 's/^/  /'
}

dg_access_gc() {
  dg_require_docker || return 1
  local now removed=0 c reason
  now=$(date +%s)

  # Stopped bridges and expired ones. Only containers carrying BOTH the
  # ownership label and an access id are ever considered.
  for c in $(docker ps -aq --filter "label=dev-gateway.component=access-bridge" 2>/dev/null); do
    dg_container_is_managed "$c" || continue
    [ -n "$(dg_access_label "$c" id)" ] || continue

    reason=""
    case "$(dg_container_state "$c")" in
      exited|dead|created) reason="not running" ;;
    esac
    if [ -z "$reason" ]; then
      local exp
      exp=$(dg_access_label "$c" expires)
      if [ -n "$exp" ] && [ "$exp" -lt "$now" ] 2>/dev/null; then reason="expired"; fi
    fi
    if [ -z "$reason" ]; then
      # The project it bridges to is gone, so the bridge leads nowhere.
      local proj svc
      proj=$(dg_access_label "$c" project)
      svc=$(dg_access_label "$c" service)
      [ -n "$(dg_find_container "$proj" "$svc")" ] || reason="target $proj/$svc is gone"
    fi

    [ -n "$reason" ] || continue
    info "removing $(dg_access_label "$c" id) ($reason)"
    docker rm -f "$c" >/dev/null 2>&1 && removed=$((removed + 1))
  done

  if [ "$removed" = "0" ]; then
    ok "nothing to collect"
  else
    ok "removed $removed orphaned bridge(s)"
  fi
  printf '  %s\n' "$(dg_dim 'only gateway-owned bridges are ever removed; consumer containers are never touched')"
}
