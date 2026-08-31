#!/usr/bin/env bash
# ============================================================================
# Dev Gateway: doctor
# ============================================================================
# Read-only diagnostics. Reports problems and suggests fixes; never applies
# them, never stops a container, never removes anything.
#
# Exit codes: 0 all checks passed (warnings allowed), 1 at least one failure.
# ============================================================================

set -uo pipefail

DG_SCRIPT_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$DG_SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/docker.sh
. "$DG_SCRIPT_DIR/lib/docker.sh"
# shellcheck source=lib/toolbox.sh
. "$DG_SCRIPT_DIR/lib/toolbox.sh"
# shellcheck source=lib/discovery.sh
. "$DG_SCRIPT_DIR/lib/discovery.sh"

dg_load_env
dg_defaults

AS_JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json) AS_JSON=1 ;;
    -h|--help)
      cat >&2 <<'DG_HELP'
dev-gateway doctor: diagnose the gateway and its host

  --json   Emit machine-readable results on stdout

Read-only: doctor never changes state. Each failed check prints a suggested
fix for you (or an agent) to run deliberately.
DG_HELP
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

DG_RESULTS=$(mktemp -t dg-doctor.XXXXXX) || die "cannot create a temporary file"
trap 'rm -f "$DG_RESULTS"' EXIT INT TERM

DG_FAILURES=0
DG_WARNINGS=0

# check <status> <id> <title> <detail> [hint]
check() {
  local status="$1" id="$2" title="$3" detail="$4" fix="${5:-}"
  printf '%s\t%s\t%s\t%s\t%s\n' "$status" "$id" "$title" "$detail" "$fix" >> "$DG_RESULTS"
  case "$status" in
    fail) DG_FAILURES=$((DG_FAILURES + 1)) ;;
    warn) DG_WARNINGS=$((DG_WARNINGS + 1)) ;;
  esac
}

# ---------------------------------------------------------------------------
# Gateway identity and configuration
# ---------------------------------------------------------------------------

check pass gateway.version "gateway version" "$(dg_version)" ""

if dg_profile_valid "$DEV_GATEWAY_PROFILE"; then
  check pass config.profile "profile" "$DEV_GATEWAY_PROFILE" ""
else
  check fail config.profile "profile" "unknown profile '$DEV_GATEWAY_PROFILE'" \
    "set DEV_GATEWAY_PROFILE to one of: $DG_PROFILES"
fi

dg_resolve_profile "$DEV_GATEWAY_PROFILE" >/dev/null 2>&1 || true

if [ -f "$DG_ROOT/.env" ]; then
  check pass config.env ".env" "present" ""
  env_perms=$(ls -l "$DG_ROOT/.env" 2>/dev/null | cut -c1-10)
  case "$env_perms" in
    *r--r--*|*rw-r--*|*rw-rw-*|*r--rw-*)
      check warn config.env.perms ".env permissions" "$env_perms is group/world readable" \
        "chmod 600 .env" ;;
    *) check pass config.env.perms ".env permissions" "$env_perms" "" ;;
  esac
else
  check warn config.env ".env" "absent; running on built-in defaults" \
    "cp .env.example .env"
fi

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------

if dg_have docker; then
  if docker info >/dev/null 2>&1; then
    dver=$(dg_docker_server_version)
    dmaj=$(dg_version_major "$dver")
    if [ "${dmaj:-0}" -ge "$DG_MIN_DOCKER_MAJOR" ] 2>/dev/null; then
      check pass runtime.docker "docker engine" "$dver" ""
    else
      check warn runtime.docker "docker engine" "$dver is below the tested minimum $DG_MIN_DOCKER_MAJOR" \
        "upgrade Docker / OrbStack"
    fi

    ctx=$(docker context show 2>/dev/null || printf 'unknown')
    check pass runtime.context "docker context" "$ctx" ""
  else
    check fail runtime.docker "docker engine" "daemon unreachable" \
      "start OrbStack or Docker Desktop, or check DOCKER_HOST"
  fi
else
  check fail runtime.docker "docker engine" "docker not found in PATH" \
    "install OrbStack (macOS) or Docker Engine (Linux)"
fi

if docker compose version >/dev/null 2>&1; then
  cver=$(dg_compose_version)
  cmaj=$(dg_version_major "$cver")
  if [ "${cmaj:-0}" -ge "$DG_MIN_COMPOSE_MAJOR" ] 2>/dev/null; then
    check pass runtime.compose "docker compose" "$cver" ""
  else
    check fail runtime.compose "docker compose" "v$cver is too old" \
      "install the Compose v2 plugin"
  fi
else
  check fail runtime.compose "docker compose" "plugin missing" \
    "install the Docker Compose v2 plugin"
fi

# ---------------------------------------------------------------------------
# Networks
# ---------------------------------------------------------------------------

if dg_network_exists "$DEV_GATEWAY_NETWORK"; then
  attached=$(dg_network_endpoints "$DEV_GATEWAY_NETWORK")
  check pass network.shared "shared network" "$DEV_GATEWAY_NETWORK ($attached attached)" ""
  if dg_network_is_managed "$DEV_GATEWAY_NETWORK"; then
    check pass network.shared.owned "shared network ownership" "created by the gateway" ""
  else
    check warn network.shared.owned "shared network ownership" \
      "'$DEV_GATEWAY_NETWORK' has no dev-gateway.managed label" \
      "harmless: the gateway will never remove a network it does not own"
  fi
else
  check fail network.shared "shared network" "'$DEV_GATEWAY_NETWORK' does not exist" \
    "dev-gateway bootstrap"
fi

if dg_network_exists "$DEV_GATEWAY_CONTROL_NETWORK"; then
  internal=$(docker network inspect "$DEV_GATEWAY_CONTROL_NETWORK" --format '{{ .Internal }}' 2>/dev/null)
  if [ "$internal" = "true" ]; then
    check pass network.control "control network" "$DEV_GATEWAY_CONTROL_NETWORK (internal)" ""
  else
    check fail network.control "control network" \
      "$DEV_GATEWAY_CONTROL_NETWORK is not marked internal" \
      "the Docker socket proxy must sit on an internal network; recreate the gateway"
  fi
else
  check warn network.control "control network" "not created yet" \
    "dev-gateway up $DEV_GATEWAY_PROFILE"
fi

# ---------------------------------------------------------------------------
# Gateway components
# ---------------------------------------------------------------------------

traefik_id=$(dg_gateway_container traefik)
if [ -n "$traefik_id" ]; then
  tstate=$(dg_container_state "$traefik_id")
  thealth=$(dg_container_health "$traefik_id")
  if [ "$tstate" = "running" ] && [ "$thealth" = "healthy" ]; then
    check pass traefik.state "traefik" "running and healthy" ""
  elif [ "$tstate" = "running" ]; then
    check warn traefik.state "traefik" "running, health=$thealth" \
      "dev-gateway logs traefik"
  else
    check fail traefik.state "traefik" "state=$tstate" \
      "dev-gateway up $DEV_GATEWAY_PROFILE"
  fi

  timg=$(docker inspect "$traefik_id" --format '{{ .Config.Image }}' 2>/dev/null)
  case "$timg" in
    *:latest)
      check warn traefik.image "traefik image" "$timg uses the floating 'latest' tag" \
        "pin a version in compose.yaml; see docs/adr/0004-pinned-versions.md" ;;
    *:*)
      check pass traefik.image "traefik image" "$timg" "" ;;
    *)
      check warn traefik.image "traefik image" "$timg has no tag, which implies :latest" \
        "pin a version in compose.yaml; see docs/adr/0004-pinned-versions.md" ;;
  esac

  # Traefik must reach Docker only through the socket proxy.
  if docker inspect "$traefik_id" --format '{{ range .Mounts }}{{ .Source }}{{ "\n" }}{{ end }}' 2>/dev/null \
     | grep -q 'docker\.sock'; then
    check fail traefik.socket "docker socket" "the Docker socket is mounted into Traefik" \
      "remove the bind mount; Traefik must use the socket proxy on the control network"
  else
    check pass traefik.socket "docker socket" "not mounted into Traefik" ""
  fi
else
  check warn traefik.state "traefik" "container not created" \
    "dev-gateway up $DEV_GATEWAY_PROFILE"
fi

proxy_id=$(dg_gateway_container socket-proxy)
if [ -n "$proxy_id" ]; then
  pstate=$(dg_container_state "$proxy_id")
  if [ "$pstate" = "running" ]; then
    check pass proxy.state "docker socket proxy" "running" ""
  else
    check fail proxy.state "docker socket proxy" "state=$pstate" \
      "dev-gateway up $DEV_GATEWAY_PROFILE"
  fi

  published=$(docker inspect "$proxy_id" \
    --format '{{ range $p, $conf := .NetworkSettings.Ports }}{{ range $conf }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)
  if [ -z "$published" ]; then
    check pass proxy.exposure "docker socket proxy exposure" "no host ports published" ""
  else
    check fail proxy.exposure "docker socket proxy exposure" "publishes host ports: $published" \
      "the Docker API must never be reachable from the host or the network"
  fi

  mounts=$(docker inspect "$proxy_id" --format '{{ range .Mounts }}{{ .Source }}:{{ .RW }} {{ end }}' 2>/dev/null)
  case "$mounts" in
    *docker.sock:true*)
      check fail proxy.socket "docker socket mount" "mounted read-write" \
        "mount /var/run/docker.sock read-only (:ro)" ;;
    *docker.sock:false*)
      check pass proxy.socket "docker socket mount" "read-only" "" ;;
    *)
      check warn proxy.socket "docker socket mount" "could not determine mount mode" "" ;;
  esac
else
  check warn proxy.state "docker socket proxy" "container not created" \
    "dev-gateway up $DEV_GATEWAY_PROFILE"
fi

# ---------------------------------------------------------------------------
# Exposure
# ---------------------------------------------------------------------------

if [ -n "$traefik_id" ] && [ "$(dg_container_state "$traefik_id")" = "running" ]; then
  binds=$(docker inspect "$traefik_id" \
    --format '{{ range $p, $conf := .NetworkSettings.Ports }}{{ range $conf }}{{ $p }}={{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)
  check pass exposure.binds "published ports" "${binds:-none}" ""

  case "$DEV_GATEWAY_PROFILE" in
    local)
      case "$binds" in
        *0.0.0.0:*|*::*)
          check fail exposure.local "local profile exposure" \
            "the gateway is bound to a non-loopback address in the local profile" \
            "set DEV_GATEWAY_BIND_ADDRESS=127.0.0.1 and run 'dev-gateway up local'" ;;
        *)
          check pass exposure.local "local profile exposure" "loopback only" "" ;;
      esac
      ;;
    remote-private)
      case "$binds" in
        *0.0.0.0:*)
          check fail exposure.private "private profile exposure" \
            "ports are published on every interface while the profile is private" \
            "bind to the VPN address or run Traefik behind the Tailscale sidecar" ;;
        *) check pass exposure.private "private profile exposure" "not publicly bound" "" ;;
      esac
      ;;
    remote-public)
      check warn exposure.public "public profile" "80/443 are intentionally public" \
        "only services that opted in are routed; databases are never published" ;;
  esac
fi

# Anything the gateway owns must not publish a sensitive port publicly.
for cid in $(docker ps -q --filter "label=dev-gateway.managed=true" 2>/dev/null); do
  cname=$(docker inspect "$cid" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')
  pub=$(docker inspect "$cid" \
    --format '{{ range $p, $conf := .NetworkSettings.Ports }}{{ range $conf }}{{ .HostIp }}:{{ .HostPort }}->{{ $p }} {{ end }}{{ end }}' 2>/dev/null)
  case "$pub" in
    *"0.0.0.0:"*"->5432/tcp"*|*"0.0.0.0:"*"->3306/tcp"*|*"0.0.0.0:"*"->6379/tcp"*|*"0.0.0.0:"*"->27017/tcp"*|*"0.0.0.0:"*"->2375/tcp"*|*"0.0.0.0:"*"->2376/tcp"*)
      check fail exposure.sensitive "sensitive port exposure" \
        "$cname publishes a database or Docker API port on all interfaces: $pub" \
        "bind it to 127.0.0.1 or remove the published port" ;;
  esac
done

# ---------------------------------------------------------------------------
# Tailscale
# ---------------------------------------------------------------------------

attachment=$(dg_attachment "$DEV_GATEWAY_PROFILE")
check pass config.attachment "traefik attachment" "$attachment" ""

if [ "$attachment" = "tailscale" ]; then
  ts_id=$(dg_gateway_container tailscale)
  if [ -n "$ts_id" ]; then
    ts_state=$(dg_container_state "$ts_id")
    ts_health=$(dg_container_health "$ts_id")
    if [ "$ts_state" = "running" ] && [ "$ts_health" = "healthy" ]; then
      ts_ip=$(docker exec "$ts_id" tailscale ip -4 2>/dev/null | head -1)
      if [ -n "$ts_ip" ]; then
        check pass tailscale.state "tailscale" "connected as $ts_ip" ""
      else
        check fail tailscale.state "tailscale" "running but has no tailnet address" \
          "check TS_AUTHKEY and the tailnet's device approval settings"
      fi
    else
      check fail tailscale.state "tailscale" "state=$ts_state health=$ts_health" \
        "dev-gateway logs tailscale"
    fi

    # Traefik must actually be inside that namespace, or the gateway is not
    # on the tailnet at all and nothing is reachable.
    if [ -n "$traefik_id" ]; then
      tnetmode=$(docker inspect "$traefik_id" --format '{{ .HostConfig.NetworkMode }}' 2>/dev/null)
      case "$tnetmode" in
        container:*)
          check pass tailscale.netns "traefik network namespace" "shared with tailscale" "" ;;
        *)
          check fail tailscale.netns "traefik network namespace" "traefik is not in the tailscale namespace ($tnetmode)" \
            "dev-gateway up $DEV_GATEWAY_PROFILE" ;;
      esac
    fi

    # State has to survive a restart or the node identity churns.
    if [ -d "$DG_STATE_DIR/tailscale" ]; then
      check pass tailscale.state.dir "tailscale state" "persisted under state/tailscale" ""
    else
      check warn tailscale.state.dir "tailscale state" "state directory missing" \
        "dev-gateway bootstrap"
    fi
  else
    check warn tailscale.state "tailscale" "container not created" \
      "dev-gateway up $DEV_GATEWAY_PROFILE"
  fi

  if [ -z "${TS_AUTHKEY:-}" ] && [ ! -f "$DG_STATE_DIR/tailscale/tailscaled.state" ]; then
    check fail tailscale.authkey "tailscale auth" "no TS_AUTHKEY and no persisted state" \
      "set TS_AUTHKEY in .env; prefer an ephemeral, tagged, pre-authorized key"
  else
    check pass tailscale.authkey "tailscale auth" \
      "$([ -n "${TS_AUTHKEY:-}" ] && printf 'auth key set' || printf 'using persisted state')" ""
  fi
fi

# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

if dg_is_true "$DEV_GATEWAY_DASHBOARD"; then
  case "$DEV_GATEWAY_DASHBOARD_BIND_ADDRESS" in
    127.0.0.1|localhost|::1)
      check pass dashboard "traefik dashboard" \
        "enabled on $DEV_GATEWAY_DASHBOARD_BIND_ADDRESS:$DEV_GATEWAY_DASHBOARD_PORT (loopback)" "" ;;
    *)
      check fail dashboard "traefik dashboard" \
        "enabled and bound to $DEV_GATEWAY_DASHBOARD_BIND_ADDRESS, which exposes routing internals" \
        "set DEV_GATEWAY_DASHBOARD_BIND_ADDRESS=127.0.0.1 or DEV_GATEWAY_DASHBOARD=false" ;;
  esac
else
  check pass dashboard "traefik dashboard" "disabled" ""
fi

# ---------------------------------------------------------------------------
# DNS and TLS
# ---------------------------------------------------------------------------

case "$DEV_GATEWAY_DOMAIN" in
  localhost|*.localhost)
    # RFC 6761 reserves `localhost`; resolvers must map it to loopback.
    if dg_have ping && ping -c1 -W1 "dev-gateway-probe.localhost" >/dev/null 2>&1; then
      check pass dns.local "local DNS" "*.localhost resolves to loopback" ""
    else
      check warn dns.local "local DNS" "could not confirm *.localhost resolution" \
        "see docs/local-development.md if hostnames do not resolve"
    fi
    ;;
  *)
    check pass dns.domain "domain" "$DEV_GATEWAY_DOMAIN" ""
    # A name that can only match the wildcard, so a stray apex A record cannot
    # make a broken wildcard look healthy.
    probe_host="dev-gateway-probe.$DEV_GATEWAY_DOMAIN"
    resolved=$(dg_dig +short "$probe_host" A 2>/dev/null | grep -E '^[0-9]+\.' | head -1)
    if [ -n "$resolved" ]; then
      check pass dns.wildcard "wildcard DNS" "*.$DEV_GATEWAY_DOMAIN -> $resolved" ""
    else
      check fail dns.wildcard "wildcard DNS" "*.$DEV_GATEWAY_DOMAIN does not resolve" \
        "dev-gateway dns setup"
    fi
    ;;
esac

if dg_is_true "$TLS_ENABLED"; then
  case "$TLS_MODE" in
    acme)
      if [ -z "${ACME_EMAIL:-}" ]; then
        check fail tls.acme "ACME configuration" "ACME_EMAIL is not set" \
          "set ACME_EMAIL in .env"
      else
        check pass tls.acme "ACME configuration" "$ACME_EMAIL via $ACME_DNS_PROVIDER" ""
      fi
      if [ -f "$DG_STATE_DIR/traefik/acme/acme.json" ]; then
        perms=$(ls -l "$DG_STATE_DIR/traefik/acme/acme.json" | cut -c1-10)
        case "$perms" in
          -rw-------) check pass tls.acme.perms "ACME store permissions" "$perms" "" ;;
          *) check fail tls.acme.perms "ACME store permissions" "$perms is too permissive" \
               "chmod 600 state/traefik/acme/acme.json" ;;
        esac
      else
        check warn tls.acme.store "ACME store" "no certificate has been issued yet" ""
      fi
      ;;
    local)
      check pass tls.local "TLS" "local certificate mode" "" ;;
    *)
      check fail tls.mode "TLS mode" "unknown TLS_MODE '$TLS_MODE'" "use TLS_MODE=local or acme" ;;
  esac
else
  check pass tls.disabled "TLS" "disabled (plain HTTP)" ""
fi

# ---------------------------------------------------------------------------
# Routing and consumers
# ---------------------------------------------------------------------------

routes=$(dg_discover_http)
route_count=$(printf '%s' "$routes" | grep -c . || true)
check pass routes.count "routed services" "$route_count" ""

# Two Compose projects whose names differ only in punctuation collapse to the
# same hostname once normalised. That silently steals traffic, so surface it.
collisions=$(dg_discover_http | awk -F'\t' '{print $4}' | sort | uniq -d)
if [ -n "$collisions" ]; then
  check fail routes.collision "hostname collisions" \
    "more than one service resolves to: $(printf '%s' "$collisions" | tr '\n' ' ')" \
    "give the projects distinct COMPOSE_PROJECT_NAME values"
else
  check pass routes.collision "hostname collisions" "none" ""
fi

# Compose interpolates ${VAR} inside a label written in LIST form but not
# inside a mapping key. A project that used the map form ships labels with a
# literal ${...} in them, and every worktree of that project then collapses
# onto one Traefik service. Cheap to detect, very confusing to debug.
uninterpolated=""
for cid in $(docker ps -q --filter "label=traefik.enable=true" 2>/dev/null); do
  if docker inspect "$cid" --format '{{ range $k, $v := .Config.Labels }}{{ $k }}={{ $v }}{{ "\n" }}{{ end }}' 2>/dev/null \
     | grep '^traefik\.' | grep -q '\${'; then
    uninterpolated="$uninterpolated $(docker inspect "$cid" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')"
  fi
done
if [ -n "$uninterpolated" ]; then
  check fail labels.interpolation "Traefik label interpolation" \
    "labels still contain a literal \${...}:$uninterpolated" \
    "write those labels in list form (- \"key=value\"); Compose does not interpolate mapping keys"
else
  check pass labels.interpolation "Traefik label interpolation" "no literal \${...} in labels" ""
fi

# Traefik service names are one flat namespace for the whole host. Two
# projects declaring the same name are merged into a single load balancer,
# which silently sends one project's traffic to the other.
svc_dupes=$(docker ps -q --filter "label=traefik.enable=true" 2>/dev/null | while read -r cid; do
  proj=$(docker inspect "$cid" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null)
  docker inspect "$cid" --format '{{ range $k, $v := .Config.Labels }}{{ $k }}{{ "\n" }}{{ end }}' 2>/dev/null \
    | sed -n 's/^traefik\.http\.services\.\([^.]*\)\..*/\1/p' \
    | sort -u | sed "s/^/$proj	/"
done | awk -F'\t' '{print $2}' | sort | uniq -d)
if [ -n "$svc_dupes" ]; then
  check fail services.collision "Traefik service name collisions" \
    "shared across projects: $(printf '%s' "$svc_dupes" | tr '\n' ' ')" \
    "prefix each Traefik service name with the project namespace"
else
  check pass services.collision "Traefik service name collisions" "none" ""
fi

# A database or cache on the shared HTTP network is almost always a mistake.
if dg_network_exists "$DEV_GATEWAY_NETWORK"; then
  risky=""
  for cid in $(docker network inspect "$DEV_GATEWAY_NETWORK" --format '{{ range $k, $v := .Containers }}{{ $k }} {{ end }}' 2>/dev/null); do
    img=$(docker inspect "$cid" --format '{{ .Config.Image }}' 2>/dev/null)
    cn=$(docker inspect "$cid" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')
    case "$img" in
      *postgres*|*mysql*|*mariadb*|*redis*|*mongo*|*memcached*)
        risky="$risky $cn" ;;
    esac
  done
  if [ -n "$risky" ]; then
    check warn network.datastores "datastores on the shared network" \
      "attached:$risky" \
      "databases and caches belong on the project's private network only; see docs/networking.md"
  else
    check pass network.datastores "datastores on the shared network" "none" ""
  fi
fi

# ---------------------------------------------------------------------------
# TCP access
# ---------------------------------------------------------------------------

bridges=$(docker ps -q --filter "label=dev-gateway.component=access-bridge" 2>/dev/null)
bridge_count=$(printf '%s' "$bridges" | grep -c . || true)
check pass access.bridges "open access bridges" "$bridge_count" ""

# A bridge is a hole into a project's private network. It must stay on
# loopback, or the database it fronts is on the local network.
bad_binds=""
for cid in $bridges; do
  bind=$(docker inspect "$cid" \
    --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }} {{ end }}{{ end }}' 2>/dev/null)
  case "$bind" in
    *0.0.0.0*|*"::"*)
      bad_binds="$bad_binds $(dg_access_label "$cid" id)" ;;
  esac
done
if [ -n "$bad_binds" ]; then
  check fail access.binds "access bridge binds" "bound beyond loopback:$bad_binds" \
    "close them and reopen without --bind, or with --bind 127.0.0.1"
else
  check pass access.binds "access bridge binds" "loopback only" ""
fi

# A bridge whose target is gone forwards nowhere and should be collected.
stale=""
for cid in $bridges; do
  bproj=$(dg_access_label "$cid" project)
  bsvc=$(dg_access_label "$cid" service)
  [ -n "$(dg_find_container "$bproj" "$bsvc")" ] || stale="$stale $(dg_access_label "$cid" id)"
done
if [ -n "$stale" ]; then
  check warn access.stale "stale access bridges" "target gone:$stale" \
    "dev-gateway access gc"
else
  check pass access.stale "stale access bridges" "none" ""
fi

# A forwarder on the shared HTTP network would make a database reachable by
# every project on the host, which is exactly what the access network avoids.
forwarders=$(docker ps -q --filter "label=dev-gateway.component=access-forwarder" 2>/dev/null)
leaky=""
for cid in $forwarders; do
  if docker inspect "$cid" --format '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}' 2>/dev/null \
     | tr ' ' '\n' | grep -qx "$DEV_GATEWAY_NETWORK"; then
    leaky="$leaky $(docker inspect "$cid" --format '{{ index .Config.Labels "dev-gateway.forward.alias" }}')"
  fi
done
if [ -n "$leaky" ]; then
  check fail access.forwarder.network "published forwarders" \
    "attached to the shared HTTP network:$leaky" \
    "a forwarder belongs on the project network and $DEV_GATEWAY_ACCESS_NETWORK only"
else
  check pass access.forwarder.network "published forwarders" \
    "$(printf '%s' "$forwarders" | grep -c . || true) on the access network only" ""
fi

# ---------------------------------------------------------------------------
# Orphans owned by the gateway
# ---------------------------------------------------------------------------

orphans=""
for cid in $(docker ps -aq --filter "label=dev-gateway.managed=true" 2>/dev/null); do
  st=$(dg_container_state "$cid")
  [ "$st" = "exited" ] || [ "$st" = "dead" ] || continue
  orphans="$orphans $(docker inspect "$cid" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')"
done
if [ -n "$orphans" ]; then
  check warn orphans "stopped gateway containers" "$orphans" \
    "dev-gateway up $DEV_GATEWAY_PROFILE  (or remove them explicitly)"
else
  check pass orphans "stopped gateway containers" "none" ""
fi

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

if [ "$AS_JSON" = "1" ]; then
  printf '{\n  "version": "%s",\n  "profile": "%s",\n  "failures": %s,\n  "warnings": %s,\n  "checks": [\n' \
    "$(dg_version)" "$DEV_GATEWAY_PROFILE" "$DG_FAILURES" "$DG_WARNINGS"
  first=1
  while IFS="$(printf '\t')" read -r status id title detail fix; do
    [ -n "${status:-}" ] || continue
    [ "$first" = "1" ] || printf ',\n'
    first=0
    printf '    {"id": "%s", "status": "%s", "title": "%s", "detail": "%s", "fix": "%s"}' \
      "$(dg_json_escape "$id")" "$status" "$(dg_json_escape "$title")" \
      "$(dg_json_escape "$detail")" "$(dg_json_escape "$fix")"
  done < "$DG_RESULTS"
  printf '\n  ]\n}\n'
else
  printf '%s\n\n' "$(dg_bold "Dev Gateway doctor")" >&2
  while IFS="$(printf '\t')" read -r status id title detail fix; do
    [ -n "${status:-}" ] || continue
    case "$status" in
      pass) badge=$(dg_c '32' ' ok ') ;;
      warn) badge=$(dg_c '33' 'warn') ;;
      fail) badge=$(dg_c '31' 'fail') ;;
      *) badge="$status" ;;
    esac
    printf '[%s] %-34s %s\n' "$badge" "$title" "$detail" >&2
    if [ -n "$fix" ] && [ "$status" != "pass" ]; then
      hint "$fix"
    fi
  done < "$DG_RESULTS"

  printf '\n' >&2
  if [ "$DG_FAILURES" -gt 0 ]; then
    err "$DG_FAILURES failure(s), $DG_WARNINGS warning(s)"
  elif [ "$DG_WARNINGS" -gt 0 ]; then
    warn "no failures, $DG_WARNINGS warning(s)"
  else
    ok "all checks passed"
  fi
fi

[ "$DG_FAILURES" -eq 0 ] || exit 1
exit 0
