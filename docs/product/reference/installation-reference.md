# Installation reference

## Non-interactive

For automation, and for re-provisioning a host from a script:

```bash
curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash -s -- \
  --non-interactive \
  --install-dir /opt/portta \
  --panel-access public \
  --panel-port 8081 \
  --panel-auth required
```

| Flag | Meaning |
|---|---|
| `--install-dir <path>` | where Portta keeps its data |
| `--panel-access <mode>` | `public`, `tailscale` or `local` |
| `--panel-port <port>` | host port for the panel |
| `--panel-auth <mode>` | `required` or `disabled`; `disabled` only on loopback |
| `--domain <domain>` | base domain, recorded but not activated |
| `--domain-mode <mode>` | project hostnames: `local`, `auto` or `custom` |
| `--version <ref>` | tag, branch or commit to install |
| `--registry <ns>` | image namespace |
| `--skip-deps` | never offer to install Docker |
| `--pull-only` | pull images and change nothing else |
| `--uninstall` | stop Portta and remove `PORTTA_HOME` |
| `-y, --yes` | assume yes; still takes defaults for unset values |
| `--non-interactive` | never prompt at all |

There is deliberately **no panel password here**. The panel signs people in
itself, and its first account is created once — in a browser at `/setup`, or
from the host with no browser at all:

```bash
portta auth bootstrap --email you@example.com
```

Sign-up closes the moment that account exists; it creates everyone else. The
installer prints the address at the end. `--panel-user` is refused rather than
ignored, so a script that still passes one is told what replaced it.

`PORTTA_HOME`, `PORTTA_REF` and `PORTTA_REGISTRY` are also read from the
environment, matching `--install-dir`, `--version` and `--registry`.

## Installing a specific version

```bash
curl -fsSL https://raw.githubusercontent.com/fabioassuncao/portta/main/install.sh | bash -s -- --version v0.8.0
```

Any tag, branch or commit works. The panel image tag follows the `VERSION` file
in that ref, so the configuration and the image always match.
