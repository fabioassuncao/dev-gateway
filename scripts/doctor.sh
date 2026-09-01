#!/usr/bin/env bash
# ============================================================================
# Portta: doctor
# ============================================================================
# Read-only diagnostics. Reports problems and suggests fixes; never applies
# them, never stops a container, never removes anything.
#
# Exit codes: 0 all checks passed (warnings allowed), 1 at least one failure.
# ============================================================================

set -uo pipefail

PORTTA_SCRIPT_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
. "$PORTTA_SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/docker.sh
. "$PORTTA_SCRIPT_DIR/lib/docker.sh"
# shellcheck source=lib/toolbox.sh
. "$PORTTA_SCRIPT_DIR/lib/toolbox.sh"
# shellcheck source=lib/discovery.sh
. "$PORTTA_SCRIPT_DIR/lib/discovery.sh"

portta_load_env
portta_defaults

AS_JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --json) AS_JSON=1 ;;
    -h|--help)
      cat >&2 <<'PORTTA_HELP'
portta doctor: diagnose the gateway and its host

  --json   Emit machine-readable results on stdout

Read-only: doctor never changes state. Each failed check prints a suggested
fix for you (or an agent) to run deliberately.
PORTTA_HELP
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

PORTTA_RESULTS=$(mktemp -t portta-doctor.XXXXXX) || die "cannot create a temporary file"
trap 'rm -f "$PORTTA_RESULTS"' EXIT INT TERM

PORTTA_FAILURES=0
PORTTA_WARNINGS=0

# check <status> <id> <title> <detail> [hint]
check() {
  local status="$1" id="$2" title="$3" detail="$4" fix="${5:-}"
  printf '%s\t%s\t%s\t%s\t%s\n' "$status" "$id" "$title" "$detail" "$fix" >> "$PORTTA_RESULTS"
  case "$status" in
    fail) PORTTA_FAILURES=$((PORTTA_FAILURES + 1)) ;;
    warn) PORTTA_WARNINGS=$((PORTTA_WARNINGS + 1)) ;;
  esac
}

# ---------------------------------------------------------------------------
# Gateway identity and configuration
# ---------------------------------------------------------------------------

check pass gateway.version "gateway version" "$(portta_version)" ""

if portta_profile_valid "$PORTTA_PROFILE"; then
  check pass config.profile "profile" "$PORTTA_PROFILE" ""
else
  check fail config.profile "profile" "unknown profile '$PORTTA_PROFILE'" \
    "set PORTTA_PROFILE to one of: $PORTTA_PROFILES"
fi

portta_resolve_profile "$PORTTA_PROFILE" >/dev/null 2>&1 || true

if [ -f "$PORTTA_ROOT/.env" ]; then
  check pass config.env ".env" "present" ""
  env_perms=$(ls -l "$PORTTA_ROOT/.env" 2>/dev/null | cut -c1-10)
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

if portta_have docker; then
  if docker info >/dev/null 2>&1; then
    dver=$(portta_docker_server_version)
    dmaj=$(portta_version_major "$dver")
    if [ "${dmaj:-0}" -ge "$PORTTA_MIN_DOCKER_MAJOR" ] 2>/dev/null; then
      check pass runtime.docker "docker engine" "$dver" ""
    else
      check warn runtime.docker "docker engine" "$dver is below the tested minimum $PORTTA_MIN_DOCKER_MAJOR" \
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
  cver=$(portta_compose_version)
  cmaj=$(portta_version_major "$cver")
  if [ "${cmaj:-0}" -ge "$PORTTA_MIN_COMPOSE_MAJOR" ] 2>/dev/null; then
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

if portta_network_exists "$PORTTA_NETWORK"; then
  attached=$(portta_network_endpoints "$PORTTA_NETWORK")
  check pass network.shared "shared network" "$PORTTA_NETWORK ($attached attached)" ""
  if portta_network_is_managed "$PORTTA_NETWORK"; then
    check pass network.shared.owned "shared network ownership" "created by the gateway" ""
  else
    check warn network.shared.owned "shared network ownership" \
      "'$PORTTA_NETWORK' has no portta.managed label" \
      "harmless: the gateway will never remove a network it does not own"
  fi
else
  check fail network.shared "shared network" "'$PORTTA_NETWORK' does not exist" \
    "portta bootstrap"
fi

if portta_network_exists "$PORTTA_CONTROL_NETWORK"; then
  internal=$(docker network inspect "$PORTTA_CONTROL_NETWORK" --format '{{ .Internal }}' 2>/dev/null)
  if [ "$internal" = "true" ]; then
    check pass network.control "control network" "$PORTTA_CONTROL_NETWORK (internal)" ""
  else
    check fail network.control "control network" \
      "$PORTTA_CONTROL_NETWORK is not marked internal" \
      "the Docker socket proxy must sit on an internal network; recreate the gateway"
  fi
else
  check warn network.control "control network" "not created yet" \
    "portta up $PORTTA_PROFILE"
fi

# ---------------------------------------------------------------------------
# Gateway components
# ---------------------------------------------------------------------------

traefik_id=$(portta_gateway_container traefik)
if [ -n "$traefik_id" ]; then
  tstate=$(portta_container_state "$traefik_id")
  thealth=$(portta_container_health "$traefik_id")
  if [ "$tstate" = "running" ] && [ "$thealth" = "healthy" ]; then
    check pass traefik.state "traefik" "running and healthy" ""
  elif [ "$tstate" = "running" ]; then
    check warn traefik.state "traefik" "running, health=$thealth" \
      "portta logs traefik"
  else
    check fail traefik.state "traefik" "state=$tstate" \
      "portta up $PORTTA_PROFILE"
  fi

  timg=$(docker inspect "$traefik_id" --format '{{ .Config.Image }}' 2>/dev/null)
  case "$timg" in
    *:latest)
      check warn traefik.image "traefik image" "$timg uses the floating 'latest' tag" \
        "pin a version in docker/compose/compose.yaml; see docs/adr/0004-pinned-versions.md" ;;
    *:*)
      check pass traefik.image "traefik image" "$timg" "" ;;
    *)
      check warn traefik.image "traefik image" "$timg has no tag, which implies :latest" \
        "pin a version in docker/compose/compose.yaml; see docs/adr/0004-pinned-versions.md" ;;
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
    "portta up $PORTTA_PROFILE"
fi

proxy_id=$(portta_gateway_container socket-proxy)
if [ -n "$proxy_id" ]; then
  pstate=$(portta_container_state "$proxy_id")
  if [ "$pstate" = "running" ]; then
    check pass proxy.state "docker socket proxy" "running" ""
  else
    check fail proxy.state "docker socket proxy" "state=$pstate" \
      "portta up $PORTTA_PROFILE"
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
    "portta up $PORTTA_PROFILE"
fi

# The panel-owned database follows the same rules the gateway enforces for a
# project's datastore: no host port and no attachment to the shared HTTP
# network. A volume is intentionally not inspected here; doctor never treats
# persisted data as disposable.
db_id=$(portta_gateway_container db)
if [ -n "$db_id" ]; then
  db_state=$(portta_container_state "$db_id")
  if [ "$db_state" = "running" ]; then
    check pass db.state "panel database" "running" ""
  else
    check warn db.state "panel database" "state=$db_state; the panel runs without persistence" \
      "portta web up"
  fi

  db_published=$(docker inspect "$db_id" \
    --format '{{ range $p, $conf := .NetworkSettings.Ports }}{{ range $conf }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)
  if [ -z "$db_published" ]; then
    check pass db.exposure "panel database exposure" "no host ports published" ""
  else
    check fail db.exposure "panel database exposure" "publishes host ports: $db_published" \
      "remove every ports entry from docker/compose/features/db.yaml and recreate the database container"
  fi

  db_networks=$(docker inspect "$db_id" \
    --format '{{ range $name, $_ := .NetworkSettings.Networks }}{{ $name }} {{ end }}' 2>/dev/null)
  case " $db_networks " in
    *" $PORTTA_NETWORK "*)
      check fail db.network.shared "panel database network" \
        "attached to the shared HTTP network '$PORTTA_NETWORK'" \
        "detach it; the panel database belongs only on '$PORTTA_DB_NETWORK'" ;;
    *)
      check pass db.network.shared "panel database network" "off the shared HTTP network" "" ;;
  esac

  if portta_network_exists "$PORTTA_DB_NETWORK"; then
    db_internal=$(docker network inspect "$PORTTA_DB_NETWORK" --format '{{ .Internal }}' 2>/dev/null)
    if [ "$db_internal" = "true" ]; then
      check pass db.network.internal "panel data network" "$PORTTA_DB_NETWORK (internal)" ""
    else
      check fail db.network.internal "panel data network" "$PORTTA_DB_NETWORK is not internal" \
        "recreate the panel database network from docker/compose/features/db.yaml"
    fi
  else
    check warn db.network.internal "panel data network" "not created yet" "portta web up"
  fi
elif portta_is_true "${PORTTA_WEB:-false}"; then
  check warn db.state "panel database" "container not created; the panel runs without persistence" \
    "portta web up"
fi

# ---------------------------------------------------------------------------
# Exposure
# ---------------------------------------------------------------------------

if [ -n "$traefik_id" ] && [ "$(portta_container_state "$traefik_id")" = "running" ]; then
  binds=$(docker inspect "$traefik_id" \
    --format '{{ range $p, $conf := .NetworkSettings.Ports }}{{ range $conf }}{{ $p }}={{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)
  check pass exposure.binds "published ports" "${binds:-none}" ""

  case "$PORTTA_PROFILE" in
    local)
      case "$binds" in
        *0.0.0.0:*|*::*)
          check fail exposure.local "local profile exposure" \
            "the gateway is bound to a non-loopback address in the local profile" \
            "set PORTTA_BIND_ADDRESS=127.0.0.1 and run 'portta up local'" ;;
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
for cid in $(docker ps -q --filter "label=portta.managed=true" 2>/dev/null); do
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

attachment=$(portta_attachment "$PORTTA_PROFILE")
check pass config.attachment "traefik attachment" "$attachment" ""

if [ "$attachment" = "tailscale" ]; then
  ts_id=$(portta_gateway_container tailscale)
  if [ -n "$ts_id" ]; then
    ts_state=$(portta_container_state "$ts_id")
    ts_health=$(portta_container_health "$ts_id")
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
        "portta logs tailscale"
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
            "portta up $PORTTA_PROFILE" ;;
      esac
    fi

    # State has to survive a restart or the node identity churns.
    if [ -d "$PORTTA_STATE_DIR/tailscale" ]; then
      check pass tailscale.state.dir "tailscale state" "persisted under state/tailscale" ""
    else
      check warn tailscale.state.dir "tailscale state" "state directory missing" \
        "portta bootstrap"
    fi
  else
    check warn tailscale.state "tailscale" "container not created" \
      "portta up $PORTTA_PROFILE"
  fi

  if [ -z "${TS_AUTHKEY:-}" ] && [ ! -f "$PORTTA_STATE_DIR/tailscale/tailscaled.state" ]; then
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

if portta_is_true "$PORTTA_DASHBOARD"; then
  case "$PORTTA_DASHBOARD_BIND_ADDRESS" in
    127.0.0.1|localhost|::1)
      check pass dashboard "traefik dashboard" \
        "enabled on $PORTTA_DASHBOARD_BIND_ADDRESS:$PORTTA_DASHBOARD_PORT (loopback)" "" ;;
    *)
      check fail dashboard "traefik dashboard" \
        "enabled and bound to $PORTTA_DASHBOARD_BIND_ADDRESS, which exposes routing internals" \
        "set PORTTA_DASHBOARD_BIND_ADDRESS=127.0.0.1 or PORTTA_DASHBOARD=false" ;;
  esac
else
  check pass dashboard "traefik dashboard" "disabled" ""
fi

# ---------------------------------------------------------------------------
# The web panel's own front door
# ---------------------------------------------------------------------------
# A routed panel can start, stop and remove every container on the host, and
# since ADR 0010 it also says what is being worked on. This fails rather than
# warns, matching the non-loopback dashboard above.

if portta_is_true "$PORTTA_WEB"; then
  if [ "$PORTTA_WEB_EXPOSE" = "local" ]; then
    check pass web.auth "panel authentication" \
      "not routed: loopback only on $PORTTA_WEB_BIND_ADDRESS:$PORTTA_WEB_PORT" ""
  elif [ "$PORTTA_WEB_AUTH" != "basic" ] \
       || [ -z "$PORTTA_WEB_AUTH_USER" ] || [ -z "$PORTTA_WEB_AUTH_HASH" ]; then
    check fail web.auth "panel authentication" \
      "the panel is routed (expose: $PORTTA_WEB_EXPOSE) with nothing in front of it" \
      "portta web auth set"
  else
    check pass web.auth "panel authentication" \
      "traefik basicauth as $PORTTA_WEB_AUTH_USER" ""

    # A middleware Traefik cannot resolve makes the router fail closed, so a
    # missing file locks the user out rather than opening the panel.
    web_auth_file="$PORTTA_ROOT/config/traefik/dynamic/portta-panel.yaml"
    if [ -f "$web_auth_file" ] && grep -q "portta-web-auth:" "$web_auth_file" 2>/dev/null; then
      check pass web.auth.file "panel middleware" "rendered in config/traefik/dynamic" ""
    else
      check fail web.auth.file "panel middleware" \
        "the router names portta-web-auth@file and no such middleware is rendered" \
        "portta web auth apply"
    fi
  fi

  if [ "$PORTTA_WEB_EXPOSE" != "local" ] && ! portta_is_true "$PORTTA_WEB_READ_ONLY"; then
    check warn web.readonly "panel write access" \
      "routed and writable: whoever gets past the credential can stop containers" \
      "portta web up --read-only"
  fi
fi

# ---------------------------------------------------------------------------
# The GitHub App
# ---------------------------------------------------------------------------
# Off by default, and silent when off. Enabled without an id, or with a key
# file that is missing, unreadable, or readable by more than its owner, is a
# failure: the panel would authenticate as nobody, or hold a key anyone on the
# host can copy.

if portta_is_true "${GITHUB_APP_ENABLED:-false}"; then
  if [ -z "${GITHUB_APP_ID:-}" ]; then
    check fail github.app "github app" "enabled with no GITHUB_APP_ID" \
      "set GITHUB_APP_ID from the App's settings page; see docs/github.md"
  else
    github_key="${GITHUB_APP_PRIVATE_KEY_FILE:-$PORTTA_ROOT/state/github/app.pem}"
    case "$github_key" in
      /app/state/github/*) github_key="$PORTTA_ROOT/state/github/${github_key##*/}" ;;
    esac

    if [ ! -f "$github_key" ]; then
      check fail github.key "github app key" "no private key at $github_key" \
        "download the .pem from the App's settings page into state/github/ and chmod 600 it"
    elif [ ! -r "$github_key" ]; then
      check fail github.key "github app key" "$github_key cannot be read" \
        "chown it to the user the panel runs as"
    else
      github_mode="$(portta_file_mode "$github_key")"
      case "$github_mode" in
        600|400)
          check pass github.key "github app key" "app $GITHUB_APP_ID, key at mode $github_mode" "" ;;
        *)
          check fail github.key "github app key" \
            "$github_key is mode ${github_mode:-unknown}: readable by more than its owner" \
            "chmod 600 $github_key" ;;
      esac
    fi
  fi

  case "${GITHUB_API_URL:-https://api.github.com}" in
    https://*) check pass github.api "github api" "${GITHUB_API_URL:-https://api.github.com}" "" ;;
    *) check fail github.api "github api" "GITHUB_API_URL is not https" "use an https:// API root" ;;
  esac
fi

# ---------------------------------------------------------------------------
# Databases by hostname
# ---------------------------------------------------------------------------

if portta_is_true "$PORTTA_TCP"; then
  if [ "$PORTTA_PROFILE" = "remote-public" ]; then
    check fail tcp.profile "tcp entrypoints" \
      "enabled on the remote-public profile, where Traefik binds every interface" \
      "set PORTTA_TCP=false; reach databases over the VPN or a loopback bridge"
  else
    check pass tcp.profile "tcp entrypoints" \
      "postgres :$PORTTA_TCP_POSTGRES_PORT, redis :$PORTTA_TCP_REDIS_PORT on $PORTTA_BIND_ADDRESS" ""
  fi

  # The hostname travels inside the TLS handshake, so a client that does not
  # ask for TLS cannot be routed at all. Without a configured certificate
  # Traefik serves a self-signed one, which `sslmode=require` accepts and
  # `verify-full` does not.
  if portta_is_true "$TLS_ENABLED"; then
    check pass tcp.tls "tcp tls" "certificates configured ($TLS_MODE)" ""
  else
    check warn tcp.tls "tcp tls" \
      "no certificate configured; Traefik will serve a self-signed one" \
      "sslmode=require works; for verify-full run: portta tls init"
  fi

  # A routed datastore belongs on the access network. On the shared one it
  # would be reachable by every HTTP service on the host.
  tcp_on_shared=""
  tcp_routed=0
  for cid in $(docker ps -q 2>/dev/null); do
    portta_container_tcp_routed "$cid" || continue
    tcp_routed=$((tcp_routed + 1))
    docker inspect "$cid" --format '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}' 2>/dev/null \
      | tr ' ' '\n' | grep -qx "$PORTTA_NETWORK" || continue
    tcp_on_shared="$tcp_on_shared $(docker inspect "$cid" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')"
  done
  if [ -n "$tcp_on_shared" ]; then
    check fail tcp.network "routed datastores" \
      "on the shared HTTP network:$tcp_on_shared" \
      "attach them to $PORTTA_ACCESS_NETWORK instead; see docs/tcp-routing.md"
  else
    check pass tcp.network "routed datastores" \
      "$tcp_routed routed, none on the shared network" ""
  fi
else
  check pass tcp.profile "tcp entrypoints" "disabled" ""
fi

# ---------------------------------------------------------------------------
# Web panel
# ---------------------------------------------------------------------------
# The panel can start, stop and remove containers, so where it listens matters
# more than for anything else the gateway runs.

if portta_is_true "$PORTTA_WEB"; then
  case "$PORTTA_WEB_BIND_ADDRESS" in
    127.0.0.1|localhost|::1)
      check pass web.bind "web panel" \
        "enabled on $PORTTA_WEB_BIND_ADDRESS:$PORTTA_WEB_PORT (loopback)" "" ;;
    *)
      check fail web.bind "web panel" \
        "enabled and bound to $PORTTA_WEB_BIND_ADDRESS; it has no authentication" \
        "set PORTTA_WEB_BIND_ADDRESS=127.0.0.1, and reach it over the VPN or an SSH tunnel" ;;
  esac

  if [ "$PORTTA_WEB_EXPOSE" = "vpn" ] && [ "$PORTTA_PROFILE" = "remote-public" ]; then
    check fail web.expose "web panel routing" \
      "routed by Traefik on a profile that answers the internet" \
      "set PORTTA_WEB_EXPOSE=local"
  fi

  web_id=$(portta_gateway_container web)
  if [ -z "$web_id" ]; then
    check warn web.state "web panel container" "not running" "portta web up"
  else
    web_state=$(portta_container_state "$web_id")
    if [ "$web_state" = "running" ]; then
      check pass web.state "web panel container" "$web_state ($(portta_container_health "$web_id"))" ""
    else
      check warn web.state "web panel container" "$web_state" "portta web up"
    fi
  fi

  web_proxy_id=$(portta_gateway_container web-socket-proxy)
  if [ -n "$web_proxy_id" ]; then
    web_proxy_ports=$(docker inspect "$web_proxy_id" --format \
      '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)
    if [ -n "$web_proxy_ports" ]; then
      check fail web.proxy "web panel socket proxy" \
        "published on the host: $web_proxy_ports" \
        "it must be reachable only from the panel; do not add a ports: entry to docker/compose/features/web.yaml"
    else
      check pass web.proxy "web panel socket proxy" "unpublished, reachable only from the panel" ""
    fi
  fi
else
  check pass web.bind "web panel" "disabled" ""
fi

# ---------------------------------------------------------------------------
# DNS and TLS
# ---------------------------------------------------------------------------

case "$PORTTA_DOMAIN" in
  localhost|*.localhost)
    # RFC 6761 reserves `localhost`; resolvers must map it to loopback.
    if portta_have ping && ping -c1 -W1 "portta-probe.localhost" >/dev/null 2>&1; then
      check pass dns.local "local DNS" "*.localhost resolves to loopback" ""
    else
      check warn dns.local "local DNS" "could not confirm *.localhost resolution" \
        "see docs/local-development.md if hostnames do not resolve"
    fi
    ;;
  *)
    check pass dns.domain "domain" "$PORTTA_DOMAIN" ""
    # A name that can only match the wildcard, so a stray apex A record cannot
    # make a broken wildcard look healthy.
    probe_host="portta-probe.$PORTTA_DOMAIN"
    resolved=$(portta_dig +short "$probe_host" A 2>/dev/null | grep -E '^[0-9]+\.' | head -1)
    if [ -n "$resolved" ]; then
      check pass dns.wildcard "wildcard DNS" "*.$PORTTA_DOMAIN -> $resolved" ""
    else
      check fail dns.wildcard "wildcard DNS" "*.$PORTTA_DOMAIN does not resolve" \
        "portta dns setup"
    fi
    ;;
esac

if portta_is_true "$TLS_ENABLED"; then
  case "$TLS_MODE" in
    acme)
      if [ -z "${ACME_EMAIL:-}" ]; then
        check fail tls.acme "ACME configuration" "ACME_EMAIL is not set" \
          "set ACME_EMAIL in .env"
      else
        check pass tls.acme "ACME configuration" "$ACME_EMAIL via $ACME_DNS_PROVIDER" ""
      fi
      if [ -f "$PORTTA_STATE_DIR/traefik/acme/acme.json" ]; then
        perms=$(ls -l "$PORTTA_STATE_DIR/traefik/acme/acme.json" | cut -c1-10)
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

routes=$(portta_discover_http)
route_count=$(printf '%s' "$routes" | grep -c . || true)
check pass routes.count "routed services" "$route_count" ""

# Two Compose projects whose names differ only in punctuation collapse to the
# same hostname once normalised. That silently steals traffic, so surface it.
collisions=$(portta_discover_http | awk -F'\t' '{print $4}' | sort | uniq -d)
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
if portta_network_exists "$PORTTA_NETWORK"; then
  risky=""
  for cid in $(docker network inspect "$PORTTA_NETWORK" --format '{{ range $k, $v := .Containers }}{{ $k }} {{ end }}' 2>/dev/null); do
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

bridges=$(docker ps -q --filter "label=portta.component=access-bridge" 2>/dev/null)
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
      bad_binds="$bad_binds $(portta_access_label "$cid" id)" ;;
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
  bproj=$(portta_access_label "$cid" project)
  bsvc=$(portta_access_label "$cid" service)
  [ -n "$(portta_find_container "$bproj" "$bsvc")" ] || stale="$stale $(portta_access_label "$cid" id)"
done
if [ -n "$stale" ]; then
  check warn access.stale "stale access bridges" "target gone:$stale" \
    "portta access gc"
else
  check pass access.stale "stale access bridges" "none" ""
fi

# A forwarder on the shared HTTP network would make a database reachable by
# every project on the host, which is exactly what the access network avoids.
forwarders=$(docker ps -q --filter "label=portta.component=access-forwarder" 2>/dev/null)
leaky=""
for cid in $forwarders; do
  if docker inspect "$cid" --format '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}' 2>/dev/null \
     | tr ' ' '\n' | grep -qx "$PORTTA_NETWORK"; then
    leaky="$leaky $(docker inspect "$cid" --format '{{ index .Config.Labels "portta.forward.alias" }}')"
  fi
done
if [ -n "$leaky" ]; then
  check fail access.forwarder.network "published forwarders" \
    "attached to the shared HTTP network:$leaky" \
    "a forwarder belongs on the project network and $PORTTA_ACCESS_NETWORK only"
else
  check pass access.forwarder.network "published forwarders" \
    "$(printf '%s' "$forwarders" | grep -c . || true) on the access network only" ""
fi

# ---------------------------------------------------------------------------
# Orphans owned by the gateway
# ---------------------------------------------------------------------------

orphans=""
for cid in $(docker ps -aq --filter "label=portta.managed=true" 2>/dev/null); do
  st=$(portta_container_state "$cid")
  [ "$st" = "exited" ] || [ "$st" = "dead" ] || continue
  orphans="$orphans $(docker inspect "$cid" --format '{{ .Name }}' 2>/dev/null | sed 's#^/##')"
done
if [ -n "$orphans" ]; then
  check warn orphans "stopped gateway containers" "$orphans" \
    "portta up $PORTTA_PROFILE  (or remove them explicitly)"
else
  check pass orphans "stopped gateway containers" "none" ""
fi

# ---------------------------------------------------------------------------
# Panel access
# ---------------------------------------------------------------------------
# How the panel is reached is a security decision, so it is checked rather than
# merely reported. See docs/adr/0021-panel-access-modes.md.

if portta_is_true "$PORTTA_WEB"; then
  case "$PORTTA_WEB_EXPOSE" in
    local|tailscale|public|vpn)
      check pass panel.access "panel access" "$PORTTA_WEB_EXPOSE (bind $PORTTA_WEB_BIND_ADDRESS:$PORTTA_WEB_PORT)" "" ;;
    *)
      check fail panel.access "panel access" "unknown mode '$PORTTA_WEB_EXPOSE'" \
        "portta config set panel.access public|tailscale|local" ;;
  esac

  panel_auth_ok=0
  if [ "$PORTTA_WEB_AUTH" = "basic" ] \
     && [ -n "$PORTTA_WEB_AUTH_USER" ] && [ -n "$PORTTA_WEB_AUTH_HASH" ]; then
    panel_auth_ok=1
  fi

  case "$PORTTA_WEB_EXPOSE" in
    public|vpn)
      if [ "$panel_auth_ok" = "1" ]; then
        check pass panel.auth "panel authentication" "basic, user $PORTTA_WEB_AUTH_USER" ""
      else
        check fail panel.auth "panel authentication" \
          "the panel is reachable beyond this host with no credential" \
          "portta web auth set"
      fi
      # A middleware Traefik cannot resolve fails the router closed, which is
      # the right direction, but it is still a broken panel nobody asked for.
      if [ -f "$PORTTA_ROOT/config/traefik/dynamic/portta-panel.yaml" ] \
         && grep -q 'portta-web-auth' "$PORTTA_ROOT/config/traefik/dynamic/portta-panel.yaml" 2>/dev/null; then
        check pass panel.middleware "panel auth middleware" "rendered" ""
      else
        check fail panel.middleware "panel auth middleware" "missing or empty" \
          "portta web auth apply"
      fi
      ;;
    *)
      check pass panel.auth "panel authentication" \
        "$([ "$panel_auth_ok" = "1" ] && printf 'basic' || printf 'none (not required on %s)' "$PORTTA_WEB_EXPOSE")" ""
      ;;
  esac

  # The panel is a control plane over every container on this host. Bound to
  # 0.0.0.0 without the proxy in front of it, it is an open one.
  if [ "$PORTTA_WEB_BIND_ADDRESS" = "0.0.0.0" ] && [ "$PORTTA_WEB_EXPOSE" != "public" ]; then
    check fail panel.bind "panel bind address" \
      "0.0.0.0 without the authenticating entrypoint" \
      "portta config set panel.access public   (or bind an address that is not 0.0.0.0)"
  else
    check pass panel.bind "panel bind address" "$PORTTA_WEB_BIND_ADDRESS" ""
  fi
fi

# ---------------------------------------------------------------------------
# Development environment
# ---------------------------------------------------------------------------
# Reported, never changed. Nothing below can fail the run: Portta needs Docker
# and a shell, and everything here is a convenience on top of that.

portta_tool_report() { # portta_tool_report <id> <title> <command> [version-args...]
  local id="$1" title="$2" cmd="$3"; shift 3
  local value
  if portta_have "$cmd"; then
    value=$("$cmd" "$@" 2>/dev/null | head -n1)
    check pass "$id" "$title" "${value:-installed}" ""
  else
    check warn "$id" "$title" "not found" "optional; install it if you want it"
  fi
}

portta_tool_report tools.git       "git"           git --version
portta_tool_report tools.node      "node"          node --version
portta_tool_report tools.npm       "npm"           npm --version
portta_tool_report tools.gh        "github cli"    gh --version
portta_tool_report tools.tailscale "tailscale"     tailscale version

if portta_have npx; then
  check pass tools.npx "npx" "available" ""
else
  check warn tools.npx "npx" "not found" "npx ships with npm; the full CLI needs Node 22.12+"
fi

if portta_have git; then
  git_user=$(git config --global user.name 2>/dev/null || true)
  git_mail=$(git config --global user.email 2>/dev/null || true)
  if [ -n "$git_user" ] && [ -n "$git_mail" ]; then
    check pass git.identity "git identity" "$git_user <$git_mail>" ""
  else
    check warn git.identity "git identity" "not configured globally" \
      "git config --global user.name / user.email"
  fi
fi

if portta_have gh; then
  if gh auth status >/dev/null 2>&1; then
    check pass github.auth "github cli auth" "authenticated" ""
  else
    check warn github.auth "github cli auth" "not authenticated" "gh auth login"
  fi
fi

if portta_have tailscale; then
  ts_addr=$(tailscale ip -4 2>/dev/null | head -n1 || true)
  if [ -n "$ts_addr" ]; then
    check pass vpn.tailscale "tailscale" "connected ($ts_addr)" ""
  else
    check warn vpn.tailscale "tailscale" "installed but not connected" \
      "tailscale up   (run it yourself; Portta never authenticates it for you)"
  fi
else
  check warn vpn.tailscale "tailscale" "not found" \
    "optional; the panel can also be reached publicly or over an SSH tunnel"
fi

# ---------------------------------------------------------------------------
# AI development agents
# ---------------------------------------------------------------------------
# Diagnostic only. Portta never installs, authenticates or reconfigures these.

portta_agent_report() { # portta_agent_report <id> <title> <command>
  local id="$1" title="$2" cmd="$3" value
  if portta_have "$cmd"; then
    value=$("$cmd" --version 2>/dev/null | head -n1)
    check pass "$id" "$title" "${value:-installed}" ""
  else
    check warn "$id" "$title" "not found" ""
  fi
}

portta_agent_report agents.claude    "claude code"   claude
portta_agent_report agents.codex     "codex cli"     codex
portta_agent_report agents.cursor    "cursor agent"  cursor-agent
portta_agent_report agents.gemini    "gemini cli"    gemini
portta_agent_report agents.antigravity "antigravity" antigravity

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

if [ "$AS_JSON" = "1" ]; then
  printf '{\n  "version": "%s",\n  "profile": "%s",\n  "failures": %s,\n  "warnings": %s,\n  "checks": [\n' \
    "$(portta_version)" "$PORTTA_PROFILE" "$PORTTA_FAILURES" "$PORTTA_WARNINGS"
  first=1
  while IFS="$(printf '\t')" read -r status id title detail fix; do
    [ -n "${status:-}" ] || continue
    [ "$first" = "1" ] || printf ',\n'
    first=0
    printf '    {"id": "%s", "status": "%s", "title": "%s", "detail": "%s", "fix": "%s"}' \
      "$(portta_json_escape "$id")" "$status" "$(portta_json_escape "$title")" \
      "$(portta_json_escape "$detail")" "$(portta_json_escape "$fix")"
  done < "$PORTTA_RESULTS"
  printf '\n  ]\n}\n'
else
  printf '%s\n\n' "$(portta_bold "Portta doctor")" >&2
  while IFS="$(printf '\t')" read -r status id title detail fix; do
    [ -n "${status:-}" ] || continue
    case "$status" in
      pass) badge=$(portta_c '32' ' ok ') ;;
      warn) badge=$(portta_c '33' 'warn') ;;
      fail) badge=$(portta_c '31' 'fail') ;;
      *) badge="$status" ;;
    esac
    printf '[%s] %-34s %s\n' "$badge" "$title" "$detail" >&2
    if [ -n "$fix" ] && [ "$status" != "pass" ]; then
      hint "$fix"
    fi
  done < "$PORTTA_RESULTS"

  printf '\n' >&2
  if [ "$PORTTA_FAILURES" -gt 0 ]; then
    err "$PORTTA_FAILURES failure(s), $PORTTA_WARNINGS warning(s)"
  elif [ "$PORTTA_WARNINGS" -gt 0 ]; then
    warn "no failures, $PORTTA_WARNINGS warning(s)"
  else
    ok "all checks passed"
  fi
fi

[ "$PORTTA_FAILURES" -eq 0 ] || exit 1
exit 0
