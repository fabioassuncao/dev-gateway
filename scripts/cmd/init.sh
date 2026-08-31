#!/usr/bin/env bash
# `dev-gateway init <path>`: generate a project's integration overlay.
#
# The only command in the gateway that writes into a project, and it is
# deliberately timid: it creates one new file, never edits an existing one,
# shows the full contents first, and asks. It never touches compose.yaml,
# volumes, databases, or anything that is running.

dg_cmd_init() {
  local path="" dry_run=0 force=0 out="compose.dev-gateway.yaml"
  local svc_overrides=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry_run=1 ;;
      --force) force=1 ;;
      --output) shift; out="${1:-}" ;;
      --output=*) out="${1#--output=}" ;;
      --service) shift; svc_overrides="$svc_overrides ${1:-}" ;;
      --service=*) svc_overrides="$svc_overrides ${1#--service=}" ;;
      -h|--help)
        cat >&2 <<'DG_HELP'
dev-gateway init <path>: write the gateway integration overlay for a project

  --dry-run              Print the file that would be written, change nothing
  --service <name>:<port>  Attach this service on this port (repeatable).
                         Without it, services are chosen by `analyze`.
  --output <file>        Filename to write (default compose.dev-gateway.yaml)
  --force                Overwrite an existing overlay (a backup is kept)

Creates ONE new file. It never edits compose.yaml, never touches volumes or
databases, and never starts anything. You are shown the file and asked before
anything is written.
DG_HELP
        return 0 ;;
      -*) die "unknown flag: $1" ;;
      *) path="$1" ;;
    esac
    shift
  done

  [ -n "$path" ] || { err "a project path is required"; hint "dev-gateway init /path/to/project"; return 1; }
  [ -d "$path" ] || { err "not a directory: $path"; return 1; }

  dg_require_docker || return 1
  dg_resolve_profile "$DEV_GATEWAY_PROFILE" >/dev/null 2>&1 || true

  local dir target
  dir=$(cd "$path" && pwd)
  target="$dir/$out"

  local compose_file
  compose_file=$(dg_analyze_find_compose "$dir")
  [ -n "$compose_file" ] || { err "no Compose file found in $dir"; return 1; }

  local json
  json=$(dg_analyze_render "$dir" "$compose_file") || return 1

  # Which services to attach, and on which port.
  local services=""
  if [ -n "$svc_overrides" ]; then
    local spec name port
    for spec in $svc_overrides; do
      name=${spec%%:*}; port=${spec#*:}
      if [ "$name" = "$port" ] || [ -z "$port" ]; then
        err "--service expects <name>:<port>, got '$spec'"
        return 1
      fi
      if ! printf '%s' "$json" | dg_jq -e --arg n "$name" '.services | has($n)' >/dev/null 2>&1; then
        err "no service named '$name' in $compose_file"
        hint "dev-gateway analyze $dir"
        return 1
      fi
      services="$services$name$DG_FS$port
"
    done
  else
    services=$(dg_analyze_http_services "$json")
    [ -n "$services" ] || {
      err "could not identify an HTTP service to attach"
      hint "name them explicitly: dev-gateway init $dir --service web:3000 --service api:8000"
      return 1
    }
  fi

  local pname psource
  IFS="$DG_FS" read -r pname psource <<EOF
$(dg_analyze_project_name "$dir")
EOF

  local content
  content=$(dg_init_render_overlay "$pname" "$services")

  printf '%s\n' "$(dg_bold "Overlay for $(basename "$dir")")"
  printf '  %-18s %s\n' "file" "$target"
  printf '  %-18s %s\n' "namespace" "$pname ($psource)"
  printf '  %-18s %s\n' "compose file" "$compose_file"
  printf '\n'
  printf '%s\n' "$content" | sed 's/^/  | /'
  printf '\n'

  # Show the real diff when there is something to compare against.
  if [ -f "$target" ]; then
    printf '%s\n' "$(dg_bold 'Difference from the existing file')"
    if diff -u "$target" - <<EOF | sed 's/^/  /'
$content
EOF
    then
      printf '  %s\n' "$(dg_c 32 'identical, nothing to do')"
      return 0
    fi
    printf '\n'
  fi

  if [ "$dry_run" = "1" ]; then
    info "dry run; nothing was written"
    return 0
  fi

  if [ -f "$target" ] && [ "$force" != "1" ]; then
    err "$out already exists"
    hint "review the diff above, then re-run with --force (a backup is kept)"
    hint "or use --dry-run to inspect without writing"
    return 1
  fi

  dg_confirm "Write $target?" || { info "aborted; nothing was written"; return 1; }

  if [ -f "$target" ]; then
    local backup
    backup="$target.bak.$(date +%Y%m%d%H%M%S)"
    cp "$target" "$backup"
    ok "backed up the previous file to $(basename "$backup")"
  fi

  printf '%s\n' "$content" > "$target"
  ok "wrote $target"

  # Namespace is the one thing the overlay cannot supply for itself.
  if [ "$psource" != ".env" ]; then
    printf '\n%s\n' "$(dg_bold 'One more step')"
    printf '  %s\n' "COMPOSE_PROJECT_NAME is not set for this project, so Compose"
    printf '  %s\n' "falls back to the directory name. Pin it so worktrees stay apart:"
    printf '\n    echo "COMPOSE_PROJECT_NAME=%s" >> %s/.env\n' "$pname" "$dir"
  fi

  printf '\n%s\n' "$(dg_bold 'Then')"
  printf '    cd %s\n' "$dir"
  printf '    docker compose -f %s -f %s up -d\n' "$compose_file" "$out"
  printf '    dev-gateway urls --project %s\n' "$pname"
  printf '\n  %s\n' "$(dg_dim 'Nothing else in the project was modified. Remove the file to undo.')"
}

# dg_init_render_overlay <project-name> <services>
dg_init_render_overlay() {
  local pname="$1" services="$2" name port

  cat <<HEADER
# ============================================================================
# Dev Gateway integration
# ============================================================================
# Generated by \`dev-gateway init\`. This file is yours: edit it freely.
#
#   docker compose -f compose.yaml -f compose.dev-gateway.yaml up -d
#
# It adds nothing but networks and labels, so the project still runs on its own
# without the gateway.
#
# Hostnames are derived from the labels Compose already injects:
#   <COMPOSE_PROJECT_NAME>-<service>.${DEV_GATEWAY_DOMAIN}
#
# Two details worth keeping:
#
# 1. Traefik service names share ONE namespace across every project on this
#    host, so they carry \${COMPOSE_PROJECT_NAME}. Two projects declaring a bare
#    \`web\` would silently load-balance into each other.
#
# 2. Labels are in LIST form. Compose interpolates \${VAR} inside a list entry
#    but NOT inside a mapping key, so the map form would leave the literal
#    \${COMPOSE_PROJECT_NAME} in the service name and every worktree of this
#    project would collapse onto one Traefik service.
#
# Databases and caches are deliberately absent: they stay on the project's
# private network. Reach them with \`dev-gateway access open\`.
# ============================================================================

services:
HEADER

  while IFS="$DG_FS" read -r name port; do
    [ -n "${name:-}" ] || continue
    cat <<SERVICE
  $name:
    networks:
      - default        # keep reaching this project's own services privately
      - dev-gateway    # and accept traffic from the gateway
    labels:
      - "traefik.enable=true"
      # This container is on two networks; tell Traefik which one to dial.
      - "traefik.docker.network=\${DEV_GATEWAY_NETWORK:-$DEV_GATEWAY_NETWORK}"
      # The port the application listens on inside the container.
      - "traefik.http.services.\${COMPOSE_PROJECT_NAME:-$pname}-$name.loadbalancer.server.port=$port"

SERVICE
  done <<EOF
$services
EOF

  cat <<FOOTER
networks:
  dev-gateway:
    external: true
    name: \${DEV_GATEWAY_NETWORK:-$DEV_GATEWAY_NETWORK}
FOOTER
}
