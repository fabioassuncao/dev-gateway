#!/usr/bin/env bash
# Authentication preparation shared by the zero-Node lifecycle commands.

portta_auth_prepare() { # portta_auth_prepare <profile>
  local profile="${1:-$PORTTA_PROFILE}"
  mkdir -p "$PORTTA_ROOT/state/auth" "$PORTTA_ROOT/config/traefik/dynamic"
  chmod 700 "$PORTTA_ROOT/state/auth"
  if [ -z "${PORTTA_AUTH_SECRET:-}" ]; then
    PORTTA_AUTH_SECRET=$(portta_random_hex 32)
    export PORTTA_AUTH_SECRET
    portta_env_set PORTTA_AUTH_SECRET "$PORTTA_AUTH_SECRET"
  fi

  # A separate disposable service gets the two write mounts the long-running
  # service deliberately does not. Existing BasicAuth files remain untouched
  # until their owning surface deliberately switches. A checkout builds the
  # image first; an installed PORTTA_HOME already pulled it.
  if [ -f "$PORTTA_ROOT/apps/web/Dockerfile" ] && [ -d "$PORTTA_ROOT/apps/auth" ]; then
    portta_compose "$profile" run --rm --no-deps --build --user "$(id -u):$(id -g)" \
      portta-auth-migrate >/dev/null
  else
    portta_compose "$profile" run --rm --no-deps --user "$(id -u):$(id -g)" \
      portta-auth-migrate >/dev/null
  fi
}
