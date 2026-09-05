# A disposable host for legacy gateway scenarios. Its daemon has no host socket
# or host bind mounts; all destructive lifecycle effects stay inside this host.
FROM node:24.20.0-alpine
RUN apk add --no-cache bash docker docker-cli docker-cli-buildx docker-cli-compose git python3 curl openssl jq coreutils util-linux iptables ca-certificates
VOLUME /var/lib/docker
WORKDIR /work
CMD ["dockerd", "--host=unix:///var/run/docker.sock"]
