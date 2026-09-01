# Installing and updating

```bash
curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash
```

That command installs Portta, and the same command updates it. It does not
clone the repository, does not build anything, and does not expose a single
application. Read [ADR 0020](adr/0020-installer-and-portta-home.md) for why, and
[ADR 0021](adr/0021-panel-access-modes.md) for what "expose" means here.

## What it needs

`curl`, `tar`, a POSIX shell, and Docker Engine 24+ with Compose v2. On Linux
it will offer to install Docker from `get.docker.com` if it is missing and you
are root; it never does that on macOS, and never without asking.

Node is **not** required. `npx portta` gives you the full CLI when you have
Node 22.12+, and `portta` on its own works without it.

## What it asks

Three questions, and only the ones it cannot answer itself. Pressing Enter
takes the default every time.

```
Where should Portta keep its data and configuration?
  directory [/opt/portta]:

How do you want to reach the Portta panel?
  1. Public    — this server's address and a port  [default]
  2. Tailscale — only over the VPN
  3. Local     — localhost only, reached over an SSH tunnel
  choose [1]:

  panel user [admin]:
  panel password (empty to generate a strong one):
```

Everything else — your OS, architecture, hostname, local and public IP, whether
Docker is running, whether the port is free, whether Tailscale is connected — it
detects. It will not ask you for something the machine can tell it.

## Where things go

One directory. It defaults to `/opt/portta` for root and `~/.portta` otherwise.

```
<PORTTA_HOME>/
├── VERSION                  what is installed
├── .env                     configuration, 0600
├── install-manifest.json    version, ref, registry, access mode, when
├── bin/portta               the CLI
├── scripts/                 what it sources
├── docker/compose/          the compose overlays
├── config/
│   ├── traefik/dynamic/     routing, and the generated BasicAuth middleware
│   └── tls/                 local certificate material
└── state/
    ├── traefik/acme/        certificates
    ├── tailscale/           node identity
    ├── git/                 collected repository metadata
    └── github/              the GitHub App key, if you use one
```

Backing up a host is `tar -czf portta.tgz "$PORTTA_HOME"` plus
`portta db dump`. The panel's PostgreSQL data lives in the named volume
`portta-db` rather than in this tree, on purpose — the reasoning is in
[ADR 0020](adr/0020-installer-and-portta-home.md).

Removing Portta is `install.sh --uninstall`, which stops its containers and
deletes `PORTTA_HOME`. It keeps the database volume and the shared network,
because other projects may still be attached to the latter.

## Panel access

This is the one decision with security consequences, so it is worth being clear
about what each option means. **None of them exposes an application.** Panel
access and application exposure are separate settings, and they stay separate.

### Public — the default

The panel answers on every interface, on port 8081, behind a BasicAuth
middleware enforced by Traefik before the request reaches the panel container.
The panel publishes no host port of its own in this mode, so there is no way in
that skips the credential. The installer verifies this by asking for
`/api/health` with no credentials and requiring a 401 before it reports success.

```
http://203.0.113.10:8081
```

It is plain HTTP. No public certificate authority issues certificates for bare
IP addresses, so your credentials are protected by authentication but the
connection is not encrypted. Set a domain and `TLS_ENABLED=true` for a real
certificate.

### Tailscale

The panel binds your node's tailnet address and nothing else. Nothing is
published on the public interface, and your Tailscale ACLs are the boundary.

```
http://100.101.102.103:8081
```

The installer detects whether Tailscale is installed and connected. It never
runs `tailscale up`, never authenticates a node, and never touches an existing
configuration — if it is not connected, that option is simply reported as
unavailable and the installation continues.

### Local

The panel binds `127.0.0.1` only. Reach it with an SSH tunnel:

```bash
ssh -L 8081:127.0.0.1:8081 user@server
```

then open <http://localhost:8081>.

### Changing your mind

The choice is not permanent:

```bash
portta config set panel.access public
portta config set panel.access tailscale
portta config set panel.access local
```

Each of these writes `.env`, renders the middleware, and recreates what needs
recreating. Moving to `public` without a credential is refused; run
`portta web auth set` first, which generates a password and shows it once.

## Updating

Run the installer again.

```bash
curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash
```

It finds the existing installation, keeps every answer already recorded, pulls
the new images, and recreates. It never regenerates the panel database
password, the panel credential, the ACME material or the Tailscale identity,
and it never overwrites `.env`, `state/`, `config/tls/`, or a file that already
exists in `config/traefik/dynamic/`.

To see what would change without changing it:

```bash
curl -fsSL .../install.sh | bash -s -- --pull-only
```

## Non-interactive

For automation, and for re-provisioning a host from a script:

```bash
curl -fsSL .../install.sh | bash -s -- \
  --non-interactive \
  --install-dir /opt/portta \
  --panel-access public \
  --panel-port 8081 \
  --panel-user admin
```

| Flag | Meaning |
|---|---|
| `--install-dir <path>` | where Portta keeps its data |
| `--panel-access <mode>` | `public`, `tailscale` or `local` |
| `--panel-port <port>` | host port for the panel |
| `--panel-user <name>` | panel username |
| `--domain <domain>` | base domain, recorded but not activated |
| `--version <ref>` | tag, branch or commit to install |
| `--registry <ns>` | image namespace |
| `--skip-deps` | never offer to install Docker |
| `--pull-only` | pull images and change nothing else |
| `--uninstall` | stop Portta and remove `PORTTA_HOME` |
| `-y, --yes` | assume yes; still takes defaults for unset values |
| `--non-interactive` | never prompt at all |

There is deliberately **no `--panel-password`**: it would end up in your shell
history and in `ps` output. Use the environment instead, or let the installer
generate one:

```bash
PORTTA_PANEL_PASSWORD='…' curl -fsSL .../install.sh | bash -s -- --non-interactive
```

`PORTTA_HOME`, `PORTTA_REF` and `PORTTA_REGISTRY` are also read from the
environment, matching `--install-dir`, `--version` and `--registry`.

## After installing

```bash
portta status          # what is running
portta doctor          # deep diagnostics, including the host's own tooling
portta urls            # the hostnames being served
npx portta doctor      # the same, from anywhere, with Node 22.12+
```

`npx portta` finds an installation without being told where it is: it checks
`PORTTA_HOME`, then `/opt/portta`, `~/.portta` and `/var/lib/portta`, after
walking up from the working directory.

`doctor` also reports the host's development environment — Git and its global
identity, GitHub CLI and whether it is authenticated, Node, npm, npx, Tailscale
— and which AI agent CLIs are present. That part is diagnostic only. Portta
never installs, authenticates or reconfigures any of them.

## Installing a specific version

```bash
curl -fsSL .../install.sh | bash -s -- --version v0.2.0
```

Any tag, branch or commit works. The panel image tag follows the `VERSION` file
in that ref, so the configuration and the image always match.

## Troubleshooting

**The image cannot be pulled.** The GHCR package is private until somebody
makes it public once, in the repository's package settings. The installer says
so and stops rather than falling back to building on the host.

**The port is already in use.** The installer checks before it starts and
offers another port. Pass `--panel-port` in non-interactive runs.

**The panel answers 401 and you have lost the password.** Only the hash is
stored, so it cannot be recovered. `portta web auth set` generates a new one
and shows it once.

**Something is unhealthy.** `portta doctor` names the check that failed and the
command that addresses it. `portta logs web` and `portta logs traefik` are the
next step.
