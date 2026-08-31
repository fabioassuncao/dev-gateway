#!/usr/bin/env bash
# `dev-gateway remote access`: reach a VPS's private TCP services from here.
#
#   your Mac  ->  SSH (over Tailscale, or plain)  ->  VPS loopback bridge
#             ->  the project's private network   ->  postgres / redis
#
# The bridge on the VPS binds loopback there, exactly as it does locally. It is
# never turned into a public port; the tunnel is what carries it to you.

DG_TUNNEL_DIR_REL="state/access/tunnels"

dg_cmd_remote_access() {
  local sub="${1:-list}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    open) dg_remote_access_open "$@" ;;
    list|ls) dg_remote_access_list "$@" ;;
    close) dg_remote_access_close "$@" ;;
    -h|--help|help)
      cat >&2 <<'DG_HELP'
dev-gateway remote access: reach a remote project's private TCP services

  remote access open <user@host> --project <p> --service <s> [--port N] [--local-port N]
  remote access list
  remote access close <id> | --all

Opens a bridge on the remote host (bound to its loopback, never published) and
an SSH tunnel from here to it, then prints a local address for TablePlus,
DBeaver, psql or redis-cli.

Host key verification stays on. Works over Tailscale SSH with the same syntax.
DG_HELP
      ;;
    *) err "unknown remote access subcommand: $sub"; return 1 ;;
  esac
}

dg_tunnel_dir() { printf '%s/%s' "$DG_ROOT" "$DG_TUNNEL_DIR_REL"; }

dg_remote_access_open() {
  local target="" project="" service="" port="" local_port="" dir="dev-gateway"

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
      --dir) shift; dir="${1:-}" ;;
      --dir=*) dir="${1#--dir=}" ;;
      -*) die "unknown flag: $1" ;;
      *) target="$1" ;;
    esac
    shift
  done

  [ -n "$target" ] || { err "a target is required, e.g. dev-gateway remote access open user@vps ..."; return 1; }
  [ -n "$project" ] || { err "--project is required"; return 1; }
  [ -n "$service" ] || { err "--service is required"; return 1; }
  dg_have ssh || { err "ssh not found in PATH"; return 1; }

  step "Opening the bridge on $target"
  local remote_cmd remote_out
  remote_cmd="cd '$dir' && ./bin/dev-gateway access open --project '$project' --service '$service'"
  [ -z "$port" ] || remote_cmd="$remote_cmd --port '$port'"
  remote_cmd="$remote_cmd --quiet >/dev/null 2>&1; cd '$dir' && ./bin/dev-gateway access list --json"

  remote_out=$(dg_ssh "$target" "$remote_cmd" 2>&1) || {
    err "could not open a bridge on $target"
    printf '%s\n' "$remote_out" | tail -5 | sed 's/^/  /' >&2
    return 1
  }

  local remote_port
  remote_port=$(printf '%s' "$remote_out" | dg_jq -r \
    --arg p "$project" --arg s "$service" \
    '.bridges[] | select(.project == $p and .service == $s) | .local_port' 2>/dev/null | head -1)

  if [ -z "$remote_port" ]; then
    err "the remote bridge did not report a port"
    hint "ssh $target 'cd $dir && ./bin/dev-gateway access list'"
    return 1
  fi
  ok "remote bridge on 127.0.0.1:$remote_port"

  # --- local port -------------------------------------------------------
  if [ -z "$local_port" ]; then
    local_port=$(dg_free_local_port) || { err "could not find a free local port"; return 1; }
  fi

  step "Opening the tunnel"
  mkdir -p "$(dg_tunnel_dir)"
  local id meta
  id=$(dg_access_id)
  meta="$(dg_tunnel_dir)/$id"

  # -N: no remote command. ExitOnForwardFailure: fail loudly instead of leaving
  # a tunnel that silently forwards nothing.
  ssh -o StrictHostKeyChecking="${DG_SSH_HOST_KEY_POLICY:-accept-new}" \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=30 \
      -N -L "127.0.0.1:$local_port:127.0.0.1:$remote_port" \
      "$target" &
  local pid=$!

  # Give ssh a moment to fail on a bad forward before claiming success.
  sleep 2
  if ! kill -0 "$pid" 2>/dev/null; then
    err "the SSH tunnel exited immediately"
    hint "check that $target is reachable and the port is free locally"
    return 1
  fi

  cat > "$meta" <<META
id=$id
pid=$pid
target=$target
project=$project
service=$service
remote_port=$remote_port
local_port=$local_port
started=$(date +%s)
META

  ok "tunnel open"
  printf '\n'
  printf '  %-12s %s\n' "id" "$id"
  printf '  %-12s %s/%s:%s\n' "remote" "$project" "$service" "${port:-auto}"
  printf '  %-12s %s\n' "via" "$target"
  printf '  %-12s %s\n' "local" "$(dg_bold "127.0.0.1:$local_port")"
  printf '\n'
  printf '  %s\n' "$(dg_dim 'point TablePlus / DBeaver / psql at that address; credentials are the project')"
  printf '  %s\n' "$(dg_dim "close with: dev-gateway remote access close $id")"
}

# dg_free_local_port: a port nothing is listening on. Racy in principle;
# ExitOnForwardFailure turns a lost race into a clear error rather than a
# tunnel that quietly does nothing.
dg_free_local_port() {
  local p i=0
  while [ "$i" -lt 50 ]; do
    p=$(( 49152 + (RANDOM % 16000) ))
    if dg_have lsof; then
      lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 || { printf '%s' "$p"; return 0; }
    elif dg_have ss; then
      ss -ltnH "sport = :$p" 2>/dev/null | grep -q . || { printf '%s' "$p"; return 0; }
    else
      printf '%s' "$p"; return 0
    fi
    i=$((i + 1))
  done
  return 1
}

dg_remote_access_list() {
  local d
  d=$(dg_tunnel_dir)
  [ -d "$d" ] || { info "no tunnels are open"; return 0; }

  local any=0 f
  for f in "$d"/*; do
    [ -f "$f" ] || continue
    # shellcheck disable=SC1090
    ( . "$f"
      if kill -0 "$pid" 2>/dev/null; then
        [ "$any" = "1" ] || printf '%-8s %-22s %-22s %-14s %s\n' "ID" "TARGET" "PROJECT" "SERVICE" "LOCAL"
        printf '%-8s %-22s %-22s %-14s %s\n' "$id" "$target" "$project" "$service" "127.0.0.1:$local_port"
      fi )
    any=1
  done
  [ "$any" = "1" ] || info "no tunnels are open"
}

dg_remote_access_close() {
  local id="" all=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --all) all=1 ;;
      -*) die "unknown flag: $1" ;;
      *) id="$1" ;;
    esac
    shift
  done

  local d n=0 f
  d=$(dg_tunnel_dir)
  [ -d "$d" ] || { info "nothing to close"; return 0; }

  for f in "$d"/*; do
    [ -f "$f" ] || continue
    [ "$all" = "1" ] || [ "$(basename "$f")" = "$id" ] || continue
    # shellcheck disable=SC1090
    . "$f"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && n=$((n + 1))
    fi
    rm -f "$f"
    # The remote bridge is the remote host's to keep or drop; closing it here
    # would be surprising if another tunnel is using it, so say what to run.
    info "the bridge on $target is still open; close it there if you are done:"
    hint "dev-gateway remote exec $target -- 'cd dev-gateway && ./bin/dev-gateway access close --project $project'"
  done

  ok "closed $n tunnel(s)"
}
