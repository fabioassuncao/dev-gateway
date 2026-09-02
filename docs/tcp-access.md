# Reaching TCP services

HTTP is easy: Traefik reads the `Host` header and routes by hostname, so any
number of web services share port 443.

Databases are not. This page explains why, and what the gateway does instead.


> **There is now a second way.** With `PORTTA_TCP=true` the gateway can
> tell databases apart by hostname on a single shared port, so a project's
> Postgres is reachable at `<project>-postgres.<domain>:5432` without a bridge
> at all. It works for PostgreSQL and Redis, not for MySQL, and it requires
> TLS. See [tcp-routing.md](tcp-routing.md). Everything below still works, and
> is still the answer for protocols that cannot do it. The panel lists every
> address a datastore has on this host, and fills a connection string from
> the container environment when it can do so honestly.

## Why hostnames do not work for PostgreSQL

Routing many services onto one port needs the connection to say which service
it wants, *before* anything is proxied. HTTP does that in the request line.
TLS does it in the SNI extension of the ClientHello.

The PostgreSQL, MySQL and Redis wire protocols do neither. A client connects
and starts speaking the protocol; nothing in the opening bytes names a
destination. A proxy holding 5432 has no way to tell "the demo-a database" from
"the demo-b database".

Concretely:

| | Carries a name a proxy can route on |
|---|---|
| HTTP | yes, in the `Host` header |
| HTTPS / TLS | yes, in SNI, before decryption |
| PostgreSQL | no (`sslmode=require` may add SNI, but not reliably, and not for a proxy that must not terminate TLS) |
| MySQL | no |
| Redis | no |
| MongoDB | no |
| SMTP | no |

**Traefik TCP routers** exist and are useful, but they route on `HostSNI`,
which means TLS. `HostSNI(\`*\`)` matches everything, so one entrypoint can
carry exactly one backend. That is a fine tool for a single persistent service
on a dedicated port; it is not a way to share 5432 between four databases.

So sharing one port between raw TCP services requires one of:

- a **distinct port** per service,
- a **distinct IP** per service (a Tailscale Service VIP, for instance),
- a **tunnel** the client opens deliberately, or
- a **protocol-aware proxy** that speaks PostgreSQL and can route on the
  startup packet's database name. That is a real thing (pgbouncer, pgcat), but
  a database-specific component, not general TCP.

The gateway takes the distinct-port route for sessions, and offers distinct
identities for the persistent case.

## The four levels of access

### A. Application to service

Unchanged, and the gateway is not involved.

```
api  ->  postgres:5432        on the project's own private network
```

Keep it that way. Nothing is published, and nothing else on the host can reach
it.

### B. A human on this machine

```bash
portta access open --project base-empresarial --service postgres
```

```
  id           a3f19c
  project      base-empresarial
  service      postgres
  target       postgres:5432
  local        127.0.0.1:33077

  postgresql://<user>@127.0.0.1:33077/<database>
```

A small `socat` container joins the project's private network, forwards to
`postgres:5432`, and publishes **127.0.0.1 on a port the kernel picks**. Open
one per database and they never collide, because the port that would collide,
5432, is never published by anybody.

It touches nothing that belongs to the project: no volumes, no container
changes, no Compose edits. Closing it leaves no trace.

```bash
portta access list
portta access inspect a3f19c
portta access close a3f19c
portta access close --project base-empresarial
portta access gc            # bridges whose target is gone
```

`--ttl 2h` expires a bridge; there is deliberately no default TTL, because a
GUI client left open overnight is a normal thing to do.

### C. An agent, or a quick query

Do not open a bridge. Run the client inside the project's own network:

```bash
portta db psql   --project base-empresarial -- -c 'select count(*) from users'
portta redis cli --project base-empresarial -- keys 'session:*'
```

No port is published, the container is removed on exit, and credentials are
read from the target container's own environment and passed straight to the
client. They are never printed.

Equivalent, with no gateway at all:

```bash
docker compose exec postgres psql -U app -d app
```

### D. A service on a VPS

The bridge on the VPS binds *its* loopback, exactly as it does locally, and an
SSH tunnel carries it to you:

```bash
portta remote access open deploy@vps --project base-empresarial --service postgres
```

```
  remote    base-empresarial/postgres:5432
  via       deploy@vps
  local     127.0.0.1:55432
```

```
your Mac -> SSH (over Tailscale, or plain) -> VPS 127.0.0.1:<bridge>
         -> the project's private network  -> postgres
```

The remote port is never published publicly. Host key verification stays on,
and `ExitOnForwardFailure` means a lost port race is an error rather than a
tunnel that silently forwards nothing.

```bash
portta remote access list
portta remote access close <id>
```

## A persistent private address

For the database you connect to daily, a session bridge is friction. Publish it
instead:

```bash
portta service publish --private --project base-empresarial --service postgres
```

This creates a **dedicated forwarder** for that one service, on that project's
private network **and** the gateway's access network, with a stable alias.

```
project-a_default              project-b_default
     postgres                       postgres
        |                               |
  forwarder-a-db                  forwarder-b-db
        |                               |
        +------- portta-access ----+
                        |
                    Tailscale
```

The shape is the point. Each forwarder bridges exactly one service. Project
networks are never merged with each other, and the Tailscale container is never
attached to a project's network; it only ever sees the access network. Two
databases can then keep port 5432 and be told apart by identity rather than by
port.

`portta doctor` fails if a forwarder ever ends up on the shared HTTP
network.

The tailnet side, meaning the Tailscale Service and the grants, is configured
on your tailnet, deliberately: the gateway never edits your Tailscale policy.
It prints exactly what to apply. See [tailscale-services.md](tailscale-services.md).

## What is never published

Refused, in every profile, regardless of flags:

- PostgreSQL, MySQL, MariaDB, Redis, MongoDB, Memcached
- OpenSearch and Elasticsearch
- RabbitMQ and other brokers
- the Docker API and the socket proxy

`portta service publish --public` on any of those is an error, not a
warning. Bridges bind `127.0.0.1`; binding elsewhere requires `--bind` and
prints a warning first, and `doctor` fails on a bridge bound beyond loopback.

## UDP

Not supported. The bridge forwards TCP only.

The pieces exist (Docker publishes UDP, Traefik has UDP entrypoints, Tailscale
carries UDP over the tailnet), but nothing here is implemented or tested for
it, so it is listed as absent rather than as a caveat. If you need a UDP
service reachable, publish it from the project itself with an explicit
`ports:` entry and bind it to loopback.

## Credentials

The gateway never reads a project's `.env` to fill in a password, and never
prints one. Connection strings it shows are templates:

```
postgresql://<user>@127.0.0.1:33077/<database>
```

The credentials are the project's, and stay there. The one exception is
`db psql`, which reads them from the target container's environment and hands
them to the client process directly. They are not printed, logged, or written
anywhere.

## GUI clients

TablePlus, DBeaver, DataGrip and friends all want a host and a port:

| | |
|---|---|
| Host | `127.0.0.1` |
| Port | whatever `access open` printed |
| User / password / database | the project's own |

Remote is identical: `remote access open` gives you a local address too, so
the client never needs to know the VPS exists.

Note that the port changes each time you open a bridge, because the kernel
picks a free one. Use `--local-port 55432` if you want a saved connection to
keep working:

```bash
portta access open --project base-empresarial --service postgres --local-port 55432
```

## Troubleshooting

**"cannot tell which port to forward"** means the container exposes several
ports and its image is not a recognised datastore. Name it: `--port 5432`.

**"is on several networks; choose one"** means the service is on more than one
private network. Pick it with `--network <name>`.

**The bridge exits immediately.** The target is not reachable from that
network on that port. `portta access inspect <id>` shows socat's own log.

**The port changed.** It is meant to. Pin it with `--local-port`.

**A bridge points nowhere after a `docker compose down`.** Run
`portta access gc`.
