# Routing databases by hostname

One host port per protocol, any number of instances behind it, told apart by
the hostname the client asks for:

```text
storefront-postgres.localhost:5432      -> storefront's postgres:5432
checkout-postgres.localhost:5432        -> checkout's postgres:5432
storefront-redis.localhost:6379         -> storefront's redis:6379
```

No project renumbers a port. No container publishes one. Traefik owns `:5432`
and `:6379` on the host and picks the backend from the TLS Server Name
Indication.

This document records what was verified, what was rejected, and why. The
matrix at the top is the short answer.

---

## The matrix

Every cell was verified against Traefik v3.7.12 with real clients, not inferred
from documentation. The lab that produced these results is in
[Reproducing the findings](#reproducing-the-findings).

| Protocol | Port | Same IP and port, told apart by hostname | Strategy | TLS | Local | VPS |
|---|---:|---|---|---|---|---|
| PostgreSQL | 5432 | **Yes** | STARTTLS then SNI, TLS terminated at Traefik | Required, `sslmode=require` | Yes | Yes |
| Redis / Valkey | 6379 | **Yes**, with an explicit `--sni` | TLS-first, SNI, terminated at Traefik | Required, and the client must be told the name | Yes | Yes |
| MySQL | 3306 | **No** | Not possible with Traefik. Falls back to a loopback bridge | n/a | Bridge | Bridge |
| MariaDB | 3306 | **No** | Same as MySQL | n/a | Bridge | Bridge |
| MongoDB | 27017 | Not evaluated | TLS-first, likely feasible | Would be required | - | - |
| Elasticsearch / OpenSearch | 9200 | Not evaluated, and unnecessary | It speaks HTTP, so the existing HTTP router already does this | - | - | - |
| Memcached, AMQP, MQTT, SMTP | various | Not evaluated | Each needs its own answer | - | - | - |

"Not evaluated" means exactly that. Nothing here was marked possible without a
client actually connecting to the right instance.

---

## Why PostgreSQL works

PostgreSQL negotiates TLS with STARTTLS: the client opens a plain connection
and sends an `SSLRequest`, the server answers `S`, and only then does the TLS
handshake begin. Traefik implements this. From the official documentation:

> Traefik supports the Postgres STARTTLS protocol. To do so, Traefik reads the
> first bytes sent by a Postgres client, identifies if they correspond to the
> message of a STARTTLS negotiation, and, if so, acknowledges and signals the
> client that it can start the TLS handshake.

The TLS handshake carries the Server Name Indication, and `HostSNI` matches on
it. libpq sets SNI by default since PostgreSQL 14 (`sslsni`, default `1`), so
no client configuration is needed beyond asking for TLS at all.

Two instances, both listening on 5432 inside their own containers, neither
publishing a host port, both reached through `127.0.0.1:15432`:

```console
$ psql "postgresql://demo@alpha-postgres.dgtest.localhost:15432/demo?sslmode=require" -tAc 'select name from whoami'
ALPHA
$ psql "postgresql://demo@beta-postgres.dgtest.localhost:15432/demo?sslmode=require" -tAc 'select name from whoami'
BETA
```

### The part the documentation does not mention: ALPN

The first attempt failed, on both instances:

```text
psql: error: ... SSL error: tlsv1 alert no application protocol
```

PostgreSQL 17 registered `postgresql` as an ALPN protocol identifier when it
added direct TLS negotiation, and libpq 17 and later offer it on every TLS
connection, STARTTLS included. Traefik's entrypoints advertise `h2`,
`http/1.1` and `acme-tls/1`, none of which the client offers, so the handshake
is rejected before any Postgres traffic happens.

The fix is a TLS option, and it belongs in the dynamic configuration:

```yaml
tls:
  options:
    postgres:
      alpnProtocols:
        - postgresql
```

referenced from the router with `traefik.tcp.routers.<name>.tls.options=postgres@file`.

Clients that send no ALPN at all are unaffected: libpq 16 connects through the
same entrypoint without complaint. So one option serves both.

---

## Why MySQL does not work, and what happens instead

The MySQL connection phase starts with the **server**:

> It starts with the client connect()ing to the server which may send a ERR
> packet and finish the handshake or send a Initial Handshake Packet which the
> client answers with a Handshake Response Packet.

TLS, when used, comes later: server `Protocol::Handshake`, client
`Protocol::SSLRequest`, then the TLS exchange. The client cannot open with a
ClientHello, so there is no SNI to route on at the moment a proxy must choose a
backend. A proxy could only get one by impersonating the server's greeting
first, which means speaking the MySQL protocol. Traefik does not, and should
not.

On the wire, opening a socket to MariaDB and sending nothing at all:

```console
$ nc -w 2 my-a 3306 | od -c | head -2
0000000   Z  \0  \0  \0  \n   1   1   .   4   .   9   -   M   a   r   i
0000020   a   D   B   -   u   b   u   2   4   0   4  \0 003  \0  \0  \0
```

The server has already spoken. Behind a `HostSNI` router the two sides then
wait for each other until the client gives up:

```console
$ mariadb -h alpha-mysql.dgtest.localhost -P 13306 -u root -p --ssl -e 'select 1'
ERROR 2013 (HY000): Lost connection to server at
'handshake: reading initial communication packet', system error: 11
```

The same client against the container directly answers immediately, so this is
the routing layer, not the database.

Rejected rather than worked around:

- **Fake the server greeting inside Traefik.** Would require a MySQL-aware
  handler upstream. Not our call to make, and not something to shim.
- **ProxySQL or MySQL Router in front.** Both do route by user or schema, not
  by hostname, and both add a component with its own configuration, users and
  failure modes to a tool whose entire point is that it stays small.
- **Route by username, `user@project`.** Changes every connection string in
  every project and breaks the moment two projects share a username.
- **A second IP per instance.** Works, and pushes host networking complexity
  onto the user on macOS, where it is worst.

MySQL keeps the mechanism the gateway already has: a loopback bridge on a port
the kernel picks, opened when you need it (`dev-gateway access open`, or the
Access page). That is not a regression. It is what every protocol had before,
and it still works for every protocol.

---

## Redis: it works, with one wart

Redis has no STARTTLS. A TLS client sends a ClientHello as the first bytes,
which is the easy case for SNI routing. Verified with two instances on one
port:

```console
$ redis-cli -h 127.0.0.1 -p 16379 --tls --sni alpha-redis.dgtest.localhost --cacert ca.crt get whoami
"ALPHA"
$ redis-cli -h 127.0.0.1 -p 16379 --tls --sni beta-redis.dgtest.localhost --cacert ca.crt get whoami
"BETA"
```

The wart: `redis-cli` does **not** derive SNI from `-h`. Connecting with
`-h alpha-redis.dgtest.localhost --tls` and no `--sni` sends no SNI and fails.
The flag is mandatory, and the panel prints the whole command rather than
leaving anyone to discover this.

Most libraries do better, because they set SNI from the host they were given:
node-redis and ioredis through `tls.servername`, redis-py through its SSL
context. Verify yours before relying on it.

Backends are untouched: Redis needs no `tls-port`, no certificate and no
configuration change, because Traefik terminates TLS and speaks plain RESP to
the container. A project that never opts in keeps working exactly as it does
today.

---

## Termination, not passthrough

Traefik can forward the encrypted stream untouched (`tls.passthrough=true`) or
terminate TLS itself and speak plaintext to the backend. The gateway
terminates.

Passthrough would mean every project's Postgres and Redis needs its own
certificate, its own `ssl = on`, its own renewal. That is a large, permanent
change to consumer projects, and this gateway's first principle is that a
project adds an overlay of labels and networks and nothing else
([ADR 0001](adr/0001-decoupled-infrastructure.md)).

Terminating gives:

- containers unchanged, no TLS configuration anywhere but the gateway;
- one certificate, the wildcard the gateway already issues;
- plaintext only ever on the Docker network between Traefik and the container,
  which is the same trust boundary the HTTP routers already use.

The cost is honest: the gateway sees the traffic. On a workstation it already
runs everything; on a VPS it is the component that terminates HTTPS anyway.

---

## Naming, and why it is flat

The obvious shape is `{service}.{project}.{domain}`:

```text
postgres.storefront.dev.example.com
```

It does not survive certificate validation. A wildcard certificate covers
exactly one label, so `*.dev.example.com` does not match a name with two labels
in front of it. Verified, with a router in place for that exact name so only
the certificate was in question:

```console
$ psql "postgresql://demo@postgres.alpha.dgtest.localhost:15432/demo?sslmode=require"
ALPHA                                  # routes fine, nothing is verified

$ psql "...postgres.alpha.dgtest.localhost...?sslmode=verify-full&sslrootcert=ca.crt"
psql: error: server certificate for "*.dgtest.localhost" (and 1 other name)
does not match host name "postgres.alpha.dgtest.localhost"
```

Covering it would need a certificate per project, issued and renewed as
projects appear. On a VPS that is ACME traffic per project; locally it is a
local CA that has to be re-run.

So the convention is flat, and it is the one the gateway already uses for HTTP
([ADR 0005](adr/0005-hostname-convention.md)):

```text
<compose-project>-<service>.<domain>

storefront-postgres.localhost
storefront-redis.localhost
checkout-postgres.vpn.example.com
```

One wildcard covers every service of every project, HTTP and TCP alike, and
`dev-gateway tls init` already issues exactly that
(`subjectAltName=DNS:*.$DOMAIN,DNS:$DOMAIN`). Nobody invents a hostname: the
gateway derives it from the labels Compose already sets.

---

## Networks: datastores still do not join the HTTP network

The gateway's shared `dev-gateway` network carries HTTP services. Databases
have never been on it, deliberately, and `tests/unit/templates.test.sh` fails
the build if a template ever attaches one.

TCP routing does not change that. A datastore that opts into hostname routing
joins **`dev-gateway-access`**, the network that already exists for reaching
private TCP services, and Traefik joins it too:

```text
dev-gateway          HTTP services            <- Traefik, web, api
dev-gateway-access   opted-in TCP services    <- Traefik, postgres, redis
dev-gateway-control  the socket proxy         <- Traefik only, internal
<project>_default    everything else          <- Traefik has no route
```

A database that does not opt in is on its project network and nothing else,
exactly as before, reachable only through a bridge.

---

## Exposure

Being visible to the gateway is not being published. Three things have to line
up before a database answers on a host port:

1. `providers.docker.exposedByDefault` stays `false`, so a container is routed
   only when it carries `traefik.enable=true`;
2. the project's overlay has to add the TCP router labels and join the access
   network, which is a deliberate edit in the project's own repository;
3. the gateway has to have the TCP entrypoints enabled at all, which is
   `DEV_GATEWAY_TCP=true` and off by default.

Where the entrypoints listen follows the profile, the same as everything else:

| Profile | Bind | Who can reach a database |
|---|---|---|
| `local` | `127.0.0.1` | this machine |
| `remote-private` with Tailscale | the tailnet address | your tailnet, subject to its ACLs |
| `remote-private` without Tailscale | `DEV_GATEWAY_BIND_ADDRESS` | whoever can reach that interface |
| `remote-public` | **refused** | nobody: the gateway will not start TCP entrypoints on a public profile |

The last row is a hard refusal, not a warning. `public enable` is about HTTP
services that opted in; a database is never part of that, and
`service publish --public` has always been refused for datastores. TCP
entrypoints keep the same rule.

Credentials are unaffected: the gateway routes bytes and never reads a
project's `.env`. Authentication stays PostgreSQL's and Redis's own.

### What a hostname that matches nothing gets

Not a closed connection. A Traefik entrypoint serves HTTP as well as TCP, and
when no TCP router matches the SNI the connection falls through to the HTTP
side, which answers `HTTP/1.1 404 Not Found`. Verified:

```
$ printf 'GET / HTTP/1.0\r\n\r\n' \
    | openssl s_client -connect 127.0.0.1:5432 -servername nobody.localhost -quiet
HTTP/1.0 404 Not Found
```

No database is reached, so this is not a security hole. It is a diagnostic
one: the client reports whatever it makes of an HTTP response rather than
"unknown host", and the message names neither the hostname nor Traefik.

```
$ redis-cli -h 127.0.0.1 -p 6379 --tls --sni typo-redis.localhost get k
Error: Protocol error, got "H" as reply type byte
```

`H` is the first byte of `HTTP`. Read that error as *the hostname matched no
router* — a typo, a project that is not running, or a container whose route
Traefik has not picked up yet. `dev-gateway urls` and the panel's Access page
show the hostnames that do exist.

---

## Local, on macOS with Docker Desktop or OrbStack

Nothing extra is needed, which is the point.

- **DNS.** `*.localhost` resolves to loopback at any depth on macOS, verified
  for `a.localhost`, `a.b.localhost` and
  `storefront-postgres.dgtest.localhost`. No `/etc/hosts`, no dnsmasq, no
  resolver file.
- **Ports.** Traefik publishes `127.0.0.1:5432` and `127.0.0.1:6379`. The VM
  boundary is irrelevant: it is an ordinary published port, the same mechanism
  the gateway already uses for 80 and 443.
- **Certificates.** `dev-gateway tls init` issues a local CA and a wildcard for
  the domain. `sslmode=require` needs no trust at all; `verify-full` needs the
  CA, which `dev-gateway tls trust` explains how to install. `mkcert` is not
  required and would only duplicate what is there.
- **Conflict.** If something already holds 5432 on the host, the entrypoint
  will not bind. `dev-gateway doctor` reports it, and the ports are
  configurable.

```bash
psql "postgresql://demo@storefront-postgres.localhost:5432/demo?sslmode=require"
```

---

## Remote, on Debian or Ubuntu

Same mechanism, different exposure.

- **DNS.** The wildcard record that already points at the host covers these
  names, because they are the same flat namespace as the HTTP ones.
- **Certificates.** The existing ACME DNS-01 wildcard covers them too. HTTP-01
  cannot issue a wildcard, which is why the gateway already uses DNS-01.
- **Tailscale.** With `TAILSCALE_ENABLED=true` Traefik runs inside the Tailscale
  container's network namespace ([ADR 0007](adr/0007-tailscale-sidecar.md)), so
  the TCP entrypoints listen on the tailnet and nowhere else. This is the
  intended way to reach a remote database.
- **Firewall.** Nothing needs opening for the Tailscale path. Without it, the
  bind address is an interface you choose, and Docker's published ports bypass
  UFW ([firewall.md](firewall.md)).
- **Cloudflare.** DNS only. Cloudflare's HTTP proxy does not forward PostgreSQL
  or Redis, and turning the orange cloud on for these records breaks them
  rather than protecting them. Spectrum is a paid product for arbitrary TCP and
  is out of scope here.

---

## When SNI is not there: the fallback

Three cases produce no SNI, and all three fail the same way. Traefik finds no
matching TCP router and hands the connection to its HTTP muxer, which answers
`HTTP/1.1 400 Bad Request`. The client reports that first byte:

```text
psql:      expected authentication request from server, but received H
redis-cli: Protocol error, got "H" as reply type byte
```

| Cause | Fix |
|---|---|
| `sslmode=disable`, or any non-TLS connection | ask for TLS: `sslmode=require` |
| connecting to an IP rather than a name (RFC 6066 forbids SNI for literal IPs) | use the hostname |
| `redis-cli --tls` without `--sni` | pass `--sni <host>` |

And when hostname routing does not apply at all, MySQL above all, the gateway
falls back to what it already does well: a bridge on a free loopback port,
opened on demand and closed when you are done. Both mechanisms coexist. A
project can be reached by hostname and by bridge on the same day.

---

## Impact

Per-connection cost of the extra hop, measured from the same Docker network
with the client's own startup subtracted, 40 connect-and-query cycles, best of
two runs:

| Path | Per connection |
|---|---:|
| straight to the container, plaintext | 1.6 ms |
| through Traefik, TLS terminated, SNI routed | 3.2 ms |

About 1.6 ms, most of it the TLS handshake rather than the proxying. It is paid
on connect, not per query, so a pooled application pays it once per pool
member and never notices; a script that opens a connection per statement will.

Worth knowing before relying on it:

- **Reloads.** Traefik applies configuration changes to new connections.
  Established TCP connections are not cut when an unrelated container starts,
  but a router that disappears takes its connections with it.
- **Pooling.** Nothing here interferes with PgBouncer or a client-side pool.
  A pool in front of the gateway, or behind it, both work.
- **Timeouts.** Traefik's TCP timeouts apply. A long-idle psql session behaves
  the same as it does against a bridge.
- **Observability.** `dev-gateway logs traefik` shows router matching. There is
  no per-query visibility and there should not be.

---

## Adding a protocol

Protocol knowledge lives in one registry rather than scattered through
port-number conditionals, and each entry states what was verified:

```text
postgres    5432   routing: starttls-sni   tls: terminate   alpn: postgresql
redis       6379   routing: tls-sni        tls: terminate   client must send SNI explicitly
mysql       3306   routing: unsupported    fallback: bridge
```

To add one:

1. establish whether the client sends a TLS ClientHello, with SNI, before the
   server sends anything. If the server speaks first, the answer is no unless
   Traefik has explicit support for that protocol's STARTTLS;
2. check whether the client offers an ALPN protocol, and add it to the TLS
   options if so. This is what broke PostgreSQL first;
3. add the entry to the registry with its default port and strategy;
4. add an integration test with **two** instances and distinct data. One
   instance proves nothing: it would pass with the routing removed entirely.

Never assume a TCP service supports SNI because another one does.

---

## Reproducing the findings

The lab is two PostgreSQL and two Redis containers, none publishing a port,
behind one Traefik with a TCP entrypoint per protocol, and a local CA. The
integration test `tests/e2e/tcp-routing.test.sh` is that lab, automated, and it
is what keeps these answers true.

```bash
./tests/run.sh --e2e         # includes the TCP routing suite
```

The questions it answers, in order: two instances on one port told apart by
hostname, distinct data proving the route, TLS required, a connection with no
SNI refused, a container restarted and still reachable, a container removed and
its route gone, and Traefik restarted with both routes back.
