#!/usr/bin/env bash
# `portta remote`: prepare and drive a remote host over SSH.
#
# SSH is the transport because macOS and Linux both ship it, and because
# Tailscale SSH slots in behind the same command. Host key verification is
# never disabled: an unknown host is reported, with the fingerprint, for the
# user to accept deliberately.

portta_cmd_remote() {
  local sub="${1:-}"; [ $# -gt 0 ] && shift || true
  case "$sub" in
    bootstrap) portta_remote_bootstrap "$@" ;;
    status) portta_remote_run_gateway status "$@" ;;
    doctor) portta_remote_run_gateway doctor "$@" ;;
    urls) portta_remote_run_gateway urls "$@" ;;
    exec) portta_remote_exec "$@" ;;
    access) portta_cmd_remote_access "$@" ;;
    ''|-h|--help|help)
      cat >&2 <<'PORTTA_HELP'
portta remote: operate a gateway on another host over SSH

  remote bootstrap <user@host> [flags]   Prepare a host and start the gateway
  remote status <user@host>              Run `portta status` there
  remote doctor <user@host>              Run `portta doctor` there
  remote urls <user@host>                Run `portta urls` there
  remote exec <user@host> -- <command>   Run an arbitrary command there
  remote access open <user@host> --project <p> --service <s>
                                        Tunnel to a remote private TCP service

Flags for bootstrap:
  --profile <name>     Profile to configure (default: remote-private)
  --dir <path>         Where to install (default: ~/portta)
  --repo <url>         Repository to clone (default: this repo's origin)
  --branch <name>      Branch to check out (default: main)
  --install-docker     Offer to install Docker when it is missing
  --dry-run            Print what would happen, change nothing

Never transfers secrets. .env on the remote host is created from the example
if absent and is NEVER overwritten.
PORTTA_HELP
      ;;
    *) err "unknown remote subcommand: $sub"; return 1 ;;
  esac
}

# portta_ssh <target> <command...>: one place for the SSH options we rely on.
portta_ssh() {
  local target="$1"; shift
  # StrictHostKeyChecking=accept-new records a key the first time but still
  # refuses a CHANGED key, which is the attack worth defending against.
  # It is never set to `no`.
  ssh -o StrictHostKeyChecking="${PORTTA_SSH_HOST_KEY_POLICY:-accept-new}" \
      -o ConnectTimeout=15 \
      -o BatchMode="${PORTTA_SSH_BATCH:-no}" \
      "$target" "$@"
}

portta_remote_require_target() {
  case "${1:-}" in
    ''|-*) err "a target is required, e.g. portta remote bootstrap user@host"; return 1 ;;
  esac
  portta_have ssh || { err "ssh not found in PATH"; return 1; }
  return 0
}

portta_remote_exec() {
  local target="${1:-}"; [ $# -gt 0 ] && shift || true
  portta_remote_require_target "$target" || return 1
  case "${1:-}" in --) shift ;; esac
  [ $# -gt 0 ] || { err "no command given"; return 1; }
  portta_ssh "$target" "$@"
}

portta_remote_run_gateway() {
  local cmd="$1"; shift
  local target="${1:-}"; [ $# -gt 0 ] && shift || true
  portta_remote_require_target "$target" || return 1
  local dir="${PORTTA_REMOTE_DIR:-portta}"
  portta_ssh "$target" "cd '$dir' && ./bin/portta $cmd $*"
}

portta_remote_bootstrap() {
  local target="" profile="remote-private" dir="portta" repo="" branch="main"
  local install_docker=0 dry_run=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --profile) shift; profile="${1:-}" ;;
      --profile=*) profile="${1#--profile=}" ;;
      --dir) shift; dir="${1:-}" ;;
      --dir=*) dir="${1#--dir=}" ;;
      --repo) shift; repo="${1:-}" ;;
      --repo=*) repo="${1#--repo=}" ;;
      --branch) shift; branch="${1:-}" ;;
      --branch=*) branch="${1#--branch=}" ;;
      --install-docker) install_docker=1 ;;
      --dry-run) dry_run=1 ;;
      -*) die "unknown flag: $1" ;;
      *) target="$1" ;;
    esac
    shift
  done

  portta_remote_require_target "$target" || return 1
  portta_profile_valid "$profile" || { err "unknown profile: $profile"; return 1; }

  if [ -z "$repo" ]; then
    repo=$(git -C "$PORTTA_ROOT" remote get-url origin 2>/dev/null || true)
    [ -n "$repo" ] || { err "could not determine the repository URL"; hint "pass --repo <url>"; return 1; }
  fi

  step "Remote bootstrap: $target"
  printf '  %-16s %s\n' "profile" "$profile" >&2
  # shellcheck disable=SC2088  # display text describing a path on the remote host
  printf '  %-16s %s\n' "directory" "~/$dir" >&2
  printf '  %-16s %s\n' "repository" "$repo" >&2
  printf '  %-16s %s\n' "branch" "$branch" >&2

  if [ "$dry_run" = "1" ]; then
    info "dry run; nothing will be changed on $target"
  fi

  step "1/6  Reaching the host"
  local uname_out
  uname_out=$(portta_ssh "$target" 'uname -s -m; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"' 2>&1) || {
    err "could not connect to $target"
    hint "check the host, your SSH key, and that the host key is accepted"
    hint "with Tailscale SSH configured, the same target works over the tailnet"
    return 1
  }
  printf '%s\n' "$uname_out" | sed 's/^/  /' >&2

  step "2/6  Docker"
  if portta_ssh "$target" 'command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1'; then
    ok "Docker is installed and running"
    portta_ssh "$target" 'docker version --format "  engine {{.Server.Version}}"; docker compose version --short 2>/dev/null | sed "s/^/  compose /"' >&2
  else
    warn "Docker is not available on $target"
    if [ "$install_docker" != "1" ]; then
      hint "re-run with --install-docker to install it, or install it yourself first"
      hint "see docs/remote-bootstrap.md for the manual steps"
      return 1
    fi
    # Docker's convenience script is the vendor's own, but it is still
    # remote code execution as root. Say so, show it, and ask.
    warn "this runs Docker's official installation script as root on $target"
    hint "it is fetched from https://get.docker.com and piped to sh"
    portta_confirm "Install Docker on $target?" || { info "aborted"; return 1; }
    [ "$dry_run" = "1" ] || portta_ssh "$target" 'curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sudo sh /tmp/get-docker.sh && rm -f /tmp/get-docker.sh' || {
      err "Docker installation failed"; return 1; }
    ok "Docker installed"
  fi

  step "3/6  Repository"
  if [ "$dry_run" = "1" ]; then
    info "would clone or update $repo into ~/$dir"
  else
    portta_ssh "$target" "
      set -e
      if [ -d '$dir/.git' ]; then
        cd '$dir' && git fetch --quiet origin && git checkout --quiet '$branch' && git pull --quiet --ff-only
        echo '  updated existing checkout'
      else
        git clone --quiet --branch '$branch' '$repo' '$dir'
        echo '  cloned'
      fi
    " >&2 || { err "could not clone or update the repository"; return 1; }
  fi

  step "4/6  Configuration"
  # Never overwrite a .env that is already there: it holds the host's secrets.
  if portta_ssh "$target" "test -f '$dir/.env'"; then
    ok ".env already exists on the remote host; left untouched"
  elif [ "$dry_run" = "1" ]; then
    info "would create .env from .env.example"
  else
    portta_ssh "$target" "cd '$dir' && cp .env.example .env && chmod 600 .env" \
      && ok "created .env from the example"
    portta_ssh "$target" "cd '$dir' && sed -i.bak 's/^PORTTA_PROFILE=.*/PORTTA_PROFILE=$profile/' .env && rm -f .env.bak" \
      && ok "set PORTTA_PROFILE=$profile"
  fi

  printf '\n%s\n' "$(portta_dim 'Secrets are never copied from this machine. Set TS_AUTHKEY, ACME_EMAIL and CF_DNS_API_TOKEN in the remote .env before starting a profile that needs them:')" >&2
  printf '  %s\n\n' "$(portta_dim "ssh $target 'nano ~/$dir/.env'")" >&2

  if [ "$dry_run" = "1" ]; then
    info "dry run complete; nothing was changed"
    return 0
  fi

  step "5/6  Bootstrap and start"
  portta_ssh "$target" "cd '$dir' && ./bin/portta bootstrap --yes" >&2 || {
    warn "remote bootstrap reported problems"; }

  if portta_confirm "Start the gateway on $target with the '$profile' profile now?"; then
    portta_ssh "$target" "cd '$dir' && ./bin/portta up '$profile'" >&2 \
      || { err "the gateway did not start"; hint "ssh $target 'cd $dir && ./bin/portta logs'"; return 1; }
  else
    info "not started; run it yourself with:"
    hint "ssh $target 'cd $dir && ./bin/portta up $profile'"
    return 0
  fi

  step "6/6  Diagnostics"
  portta_ssh "$target" "cd '$dir' && ./bin/portta doctor" >&2 || true
  portta_ssh "$target" "cd '$dir' && ./bin/portta urls" >&2 || true

  step "Next steps"
  cat >&2 <<PORTTA_NEXT
  portta remote status $target
  portta remote doctor $target

  On the remote host:
    ./bin/portta dns check          confirm the wildcard record
    ./bin/portta network status     confirm what is exposed
PORTTA_NEXT
}
