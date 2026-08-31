# ============================================================================
# Dev Gateway toolbox
# ============================================================================
# One small image holding the diagnostic and client tools the gateway needs, so
# a host only ever has to provide Docker, Git and a shell.
#
# Built on demand and cached locally; see `dev-gateway toolbox build`.
# ============================================================================
FROM alpine:3.24.1

# Pinned base, unpinned packages: Alpine's repositories only carry the current
# patch level for a release, so `apk add` inside 3.24.1 is already constrained.
RUN apk add --no-cache \
      bash \
      ca-certificates \
      curl \
      jq \
      bind-tools \
      openssl \
      socat \
      netcat-openbsd \
      openssh-client \
      postgresql-client \
      mysql-client \
      redis \
      iputils \
  && update-ca-certificates

LABEL org.opencontainers.image.title="dev-gateway-toolbox" \
      org.opencontainers.image.description="Diagnostic and client tools for the Dev Gateway" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT []
CMD ["/bin/bash"]
