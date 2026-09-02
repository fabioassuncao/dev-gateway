#!/usr/bin/env bash
# Portta: the applier container.
#
# Traefik reads its static configuration from the environment its container was
# created with (docs/adr/0003-traefik-static-config-via-env.md), so a setting
# saved in the panel takes effect only once the containers are *recreated*.
# Recreating them means Compose, and the panel deliberately cannot reach it
# (docs/adr/0008-web-panel-socket-proxy.md): its Docker permissions stop at
# start, stop, restart and one fixed container shape.
#
# So the host prepares a single-purpose container, stopped, whose command is
# fixed at creation time and reads nothing from the panel. Starting it is a
# permission the panel already has. See
# docs/adr/0026-applying-settings-from-the-panel.md.
#
# Off unless PORTTA_APPLY=true.
#
# This mirrors applyCreateArguments in packages/core/src/apply.ts, the way
# portta_compose_files mirrors composeFiles: the core commands must run without
# Node (ADR 0015). tests/unit/apply.test.sh keeps the two identical.

PORTTA_APPLY_IMAGE="fabioassuncao/portta-apply:0.1.0"
PORTTA_APPLY_CONTAINER="portta-apply"

portta_apply_image_exists() {
  docker image inspect "$PORTTA_APPLY_IMAGE" >/dev/null 2>&1
}

# portta_apply_image_ensure: build the image if it is not present.
portta_apply_image_ensure() {
  portta_apply_image_exists && return 0
  info "building the applier image (first use only)"
  docker build -q -t "$PORTTA_APPLY_IMAGE" "$PORTTA_ROOT/apply" >/dev/null || {
    err "could not build the applier image"
    hint "docker build -t $PORTTA_APPLY_IMAGE apply/"
    return 1
  }
  return 0
}

portta_apply_spec() {
  printf '%s|%s|%s' "$PORTTA_APPLY_IMAGE" "$PORTTA_ROOT" "$(portta_version)"
}

# portta_apply_refusal: why this host must not prepare an applier, or empty.
# Mirrors applyRefusal in packages/core/src/apply.ts.
portta_apply_refusal() {
  # Both overlays add a `build:` stanza whose context is the repository root.
  # The applier has no network and no toolchain, so it would try to build the
  # panel image inside itself and fail after taking the gateway down.
  if portta_is_true "${PORTTA_WEB_BUILD:-false}"; then
    printf 'PORTTA_WEB_BUILD is true: the applier cannot build the panel image'; return 0
  fi
  if portta_is_true "${PORTTA_WEB_DEV:-false}"; then
    printf 'PORTTA_WEB_DEV is true: the applier cannot build the panel image'; return 0
  fi
  # Applying rewrites how the whole host is exposed. Handing that to whoever
  # reaches a public panel is a different decision from handing it to whoever
  # reaches a loopback one, and it is not one this feature makes for you.
  if [ "${PORTTA_WEB_EXPOSE:-local}" = "public" ]; then
    printf 'the panel is exposed publicly: apply on the host instead'; return 0
  fi
  if [ "${PORTTA_PROFILE:-local}" = "remote-public" ]; then
    printf 'the remote-public profile applies on the host only'; return 0
  fi
  printf ''
}

# portta_apply_create: the container, stopped, with its command fixed.
# Every flag here is explained in packages/core/src/apply.ts; keep both in step.
portta_apply_create() {
  docker create \
    --name "$PORTTA_APPLY_CONTAINER" \
    --label portta.managed=true \
    --label portta.component=apply \
    --label "portta.apply.spec=$(portta_apply_spec)" \
    --label traefik.enable=false \
    --restart no \
    --network none \
    --user 0:0 \
    --security-opt no-new-privileges:true \
    --workdir "$PORTTA_ROOT" \
    --env PORTTA_ROOT="$PORTTA_ROOT" \
    --env PORTTA_FORCE_BASH=true \
    --env PORTTA_ASSUME_YES=true \
    --env HOME=/tmp \
    --volume /var/run/docker.sock:/var/run/docker.sock \
    --volume "$PORTTA_ROOT:$PORTTA_ROOT" \
    "$PORTTA_APPLY_IMAGE" \
    bash "$PORTTA_ROOT/bin/portta" up --wait
}

# portta_apply_remove <id>: only ever a container the gateway created, and never
# one that is applying right now.
portta_apply_remove() {
  local id="$1"
  portta_container_is_managed "$id" || {
    warn "a container named $PORTTA_APPLY_CONTAINER exists and is not ours; leaving it alone"
    return 1
  }
  if [ "$(portta_container_state "$id")" = "running" ]; then
    warn "an apply is running; leaving the applier in place"
    return 1
  fi
  docker rm -f "$id" >/dev/null 2>&1
}

# portta_apply_ensure: reconcile the applier with PORTTA_APPLY. Called at the
# end of `up`, and never fatal: a gateway that started must not be reported as
# failed because an optional convenience could not be prepared.
portta_apply_ensure() {
  local id refusal
  id=$(portta_gateway_container apply)

  if ! portta_is_true "${PORTTA_APPLY:-false}"; then
    [ -n "$id" ] || return 0
    portta_apply_remove "$id" && info "applier removed (PORTTA_APPLY is false)"
    return 0
  fi

  refusal=$(portta_apply_refusal)
  if [ -n "$refusal" ]; then
    warn "not preparing the applier: $refusal"
    hint "settings still apply with: portta up"
    [ -n "$id" ] && portta_apply_remove "$id" >/dev/null 2>&1
    return 0
  fi

  if [ -n "$id" ]; then
    [ "$(docker inspect "$id" --format '{{ index .Config.Labels "portta.apply.spec" }}' 2>/dev/null)" \
      = "$(portta_apply_spec)" ] && return 0
    info "the applier is stale; recreating it"
    portta_apply_remove "$id" || return 0
  fi

  portta_apply_image_ensure || { warn "settings still apply with: portta up"; return 0; }
  if portta_apply_create >/dev/null; then
    ok "applier ready; the panel can apply settings without a terminal"
  else
    warn "the applier could not be created; settings still apply with: portta up"
  fi
  return 0
}
