# Remote development (Ubuntu VPS)

The same gateway, the same commands, one host away. Two modes:

| Profile | Who can reach it | Typical use |
|---|---|---|
| `remote-private` | your tailnet only | the default and the recommendation |
| `remote-public` | the internet | demos, webhooks, external testing (opt-in) |

> **Verification status.** The local profile is exercised end to end by CI on
> every change. The remote profiles are validated by configuration tests (every
> profile renders, the private profile never binds `0.0.0.0`), but the tailnet
> and ACME paths need real credentials and are **not** exercised automatically.
> Treat the checklist at the end of this page as required, not optional.

## Prerequisites

- Ubuntu 22.04 or 24.04, `amd64` or `arm64`
- Docker Engine 24+ and the Compose v2 plugin
- SSH access with a key
- A Tailscale account for `remote-private`
- A domain you control for TLS

## Bootstrapping a host

From your workstation:

```bash
portta remote bootstrap deploy@vps.example.com --profile remote-private
```

It connects, reports the distribution and architecture, checks Docker, clones
or updates the repository, creates `.env` **only if absent**, runs `bootstrap`,
and offers to start the gateway and run `doctor`.

Useful flags: `--dry-run` (change nothing), `--install-docker` (offer to run
Docker's official installer, asking first, because that is remote code
execution as root), `--dir`, `--repo`, `--branch`.

Secrets are never copied from your machine. Set them on the host:

```bash
ssh deploy@vps.example.com
nano ~/portta/.env     # TS_AUTHKEY, ACME_EMAIL, CF_DNS_API_TOKEN
```

Then drive it from anywhere:

```bash
portta remote status deploy@vps.example.com
portta remote doctor deploy@vps.example.com
portta remote urls   deploy@vps.example.com
```

## Private mode

```env
PORTTA_PROFILE=remote-private
TAILSCALE_ENABLED=true
TS_AUTHKEY=tskey-auth-...
PRIVATE_DOMAIN=vpn.dev.example.com
TLS_ENABLED=true
TLS_MODE=acme
ACME_EMAIL=you@example.com
CLOUDFLARE_ENABLED=true
CF_DNS_API_TOKEN=...
CLOUDFLARE_ZONE=example.com
```

```bash
./bin/portta up remote-private
./bin/portta dns setup --apply
./bin/portta doctor
```

Traefik runs **inside the Tailscale container's network namespace**, so it
listens on the node's tailnet address and publishes nothing on the VPS's public
interface. `remote-private` refuses to bind `0.0.0.0` at all.

Details and the alternative host-native setup: [tailscale.md](tailscale.md).

Not using Tailscale? Leave `TAILSCALE_ENABLED=false` and point
`PORTTA_BIND_ADDRESS` at your VPN interface's address. The profile still
refuses `0.0.0.0`.

## Public mode

Off by default. Enabling it is a deliberate act:

```bash
./bin/portta public enable
```

It prints the domain, the interfaces, the ports, the TLS state and the exact
list of URLs that would become reachable, then asks. See
[public-access.md](public-access.md).

## TLS

Wildcard certificates require ACME **DNS-01**, because HTTP-01 cannot issue
them. That also means a private domain works: the ACME server never has to reach your
host, only see the DNS record. See [dns-and-tls.md](dns-and-tls.md).

## Firewall

The gateway never changes firewall rules. See [firewall.md](firewall.md) for the
minimal UFW configuration for each profile.

```bash
./bin/portta network status
```

shows interfaces, the tailnet address, every published port and who owns it.

## Updating

```bash
./bin/portta update
```

Validates the Compose configuration **before** pulling, pulls the pinned images,
asks before recreating, and leaves `state/` untouched, including ACME
certificates and the Tailscale identity.

To take new gateway code as well:

```bash
cd ~/portta && git pull --ff-only && ./bin/portta update
```

## Backing up

Everything worth keeping is in two places:

```bash
tar czf portta-backup.tgz .env state/
```

- `state/traefik/acme/acme.json` holds the issued certificates
- `state/tailscale/` holds the node identity; losing it means re-authenticating
- `.env` holds the configuration and secrets

Consumer project data is not here and never was; it belongs to the projects.

## Smoke checklist

Because the remote paths are not covered by automated tests, verify by hand
after the first deploy:

- [ ] `./bin/portta doctor` passes on the host
- [ ] `./bin/portta network status` shows no unexpected `0.0.0.0` bind
- [ ] `tailscale status` on the host shows the node connected
- [ ] the tailnet address is reachable from your workstation
- [ ] `portta dns check` resolves the wildcard
- [ ] a demo answers over HTTPS with a valid certificate
- [ ] from a machine **outside** the tailnet, the VPS's public IP does not answer on 80/443
- [ ] restarting the gateway leaves applications running
- [ ] rebooting the host brings the gateway back
